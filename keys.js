import { generateUserKeyPair, importBackup } from './crypto.js'

export const KEYS_STORAGE = 'send2endKeys'
const LEGACY_KEY = 'send2endKey'

export function publicKeyView(record) {
  return {
    keyId: record.keyId,
    label: record.label || 'Key',
    kind: record.kind || 'personal',
    scope: record.scope || 'global',
    origins: record.origins,
    algorithm: record.algorithm,
    publicKeySpki: record.publicKeySpki,
    fingerprint: record.fingerprint,
    createdAt: record.createdAt || null,
  }
}

function normalizeRecord(record, fallback = {}) {
  if (!record?.keyId || !record.privateKeyPkcs8 || !record.publicKeySpki) return null
  const origins = Array.isArray(record.origins)
    ? record.origins.filter(Boolean)
    : fallback.origins || []
  return {
    keyId: record.keyId,
    label: record.label || fallback.label || (record.kind === 'group' ? 'Group key' : 'Personal key'),
    kind: record.kind === 'group' ? 'group' : 'personal',
    scope: origins.length > 0 ? 'site' : record.scope === 'site' ? 'site' : 'global',
    origins,
    algorithm: record.algorithm || 'rsa-oaep-sha256',
    publicKeySpki: record.publicKeySpki,
    fingerprint: record.fingerprint,
    privateKeyPkcs8: record.privateKeyPkcs8,
    createdAt: record.createdAt || fallback.createdAt || new Date().toISOString(),
  }
}

export async function loadVault() {
  const data = await chrome.storage.local.get([KEYS_STORAGE, LEGACY_KEY, 'send2endSites'])
  let keys = Array.isArray(data[KEYS_STORAGE]) ? data[KEYS_STORAGE].map((item) => normalizeRecord(item)).filter(Boolean) : []
  if (keys.length === 0 && data[LEGACY_KEY]) {
    const migrated = normalizeRecord(data[LEGACY_KEY], {
      label: 'Default key',
      kind: 'personal',
      origins: Array.isArray(data.send2endSites) ? data.send2endSites : [],
    })
    if (migrated) {
      keys = [migrated]
      await chrome.storage.local.set({ [KEYS_STORAGE]: keys })
      await chrome.storage.local.remove(LEGACY_KEY)
    }
  }
  return keys
}

export async function saveVault(keys) {
  await chrome.storage.local.set({ [KEYS_STORAGE]: keys })
  return keys
}

export function keyAllowedForOrigin(record, origin) {
  if (!origin) return true
  return record.origins.includes(origin)
}

export function keysForOrigin(keys, origin) {
  return keys.filter((record) => keyAllowedForOrigin(record, origin))
}

export function findKey(keys, keyId) {
  return keys.find((record) => record.keyId === keyId) || null
}

export async function addGeneratedKey({ label, kind = 'personal', origin = null } = {}) {
  const keys = await loadVault()
  const generated = await generateUserKeyPair()
  const record = normalizeRecord({
    ...generated,
    label: label || (kind === 'group' ? 'Group key' : origin ? `Key for ${origin}` : 'Personal key'),
    kind: kind === 'group' ? 'group' : 'personal',
    scope: origin ? 'site' : 'global',
    origins: origin ? [origin] : [],
    createdAt: new Date().toISOString(),
  })
  keys.push(record)
  await saveVault(keys)
  return { keys, created: record }
}

export async function authorizeKey(keyId, origin) {
  if (!origin) throw new Error('Missing origin')
  const keys = await loadVault()
  const record = findKey(keys, keyId)
  if (!record) throw new Error('Key not found')
  if (record.scope === 'site' && record.origins.length > 0 && !record.origins.includes(origin)) {
    throw new Error('This key is restricted to another site')
  }
  if (!record.origins.includes(origin)) record.origins.push(origin)
  record.origins.sort()
  await saveVault(keys)
  return record
}

export async function revokeKeyOrigin(keyId, origin) {
  const keys = await loadVault()
  const record = findKey(keys, keyId)
  if (!record) throw new Error('Key not found')
  record.origins = record.origins.filter((item) => item !== origin)
  await saveVault(keys)
  return record
}

export async function deleteKey(keyId) {
  const keys = (await loadVault()).filter((record) => record.keyId !== keyId)
  await saveVault(keys)
  return keys
}

function resolveKind(kind, fallback = 'personal') {
  if (kind === 'group' || kind === 'personal') return kind
  return fallback === 'group' ? 'group' : 'personal'
}

export async function setKeyKind(keyId, kind) {
  const keys = await loadVault()
  const record = findKey(keys, keyId)
  if (!record) throw new Error('Key not found')
  record.kind = resolveKind(kind)
  await saveVault(keys)
  return record
}

export async function importKeyRecord(backup, passphrase, { label, kind, origin } = {}) {
  const imported = await importBackup(backup, passphrase)
  const keys = await loadVault()
  const nextKind = resolveKind(kind, backup.kind)
  const existing = findKey(keys, imported.keyId)
  if (existing) {
    if (kind === 'group' || kind === 'personal') {
      existing.kind = nextKind
      await saveVault(keys)
    }
    if (origin && !keyAllowedForOrigin(existing, origin)) {
      return authorizeKey(imported.keyId, origin)
    }
    return existing
  }
  const record = normalizeRecord({
    ...imported,
    label: label || backup.label || (nextKind === 'group' ? 'Group key' : 'Imported key'),
    kind: nextKind,
    origins: origin ? [origin] : [],
    createdAt: new Date().toISOString(),
  })
  keys.push(record)
  await saveVault(keys)
  return record
}
