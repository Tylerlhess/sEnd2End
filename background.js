import {
  decryptFileWithKeys,
  encryptFile,
  exportBackup,
  proofMessageBytes,
  signProof,
  decryptProofChallenge,
  wrapDekForRecipient,
} from './crypto.js'
import {
  addGeneratedKey,
  authorizeKey,
  deleteKey,
  findKey,
  importKeyRecord,
  keysForOrigin,
  loadVault,
  publicKeyView,
  revokeKeyOrigin,
} from './keys.js'
import {
  addSite,
  ensureSeedSites,
  isSiteAllowed,
  listSites,
  patternsForOrigin,
  removeSite,
} from './sites.js'

const CHANNEL = 'send2end'

function senderOrigin(payload, sender) {
  if (typeof payload?.origin === 'string' && payload.origin.startsWith('http')) return payload.origin
  if (sender?.url) {
    try {
      const origin = new URL(sender.url).origin
      if (origin.startsWith('chrome-extension:')) return null
      return origin
    } catch {
      return null
    }
  }
  return null
}

function wrapCandidates(payload) {
  if (Array.isArray(payload?.wraps) && payload.wraps.length > 0) {
    return payload.wraps.map((item) => ({
      keyId: item.recipient_key_id || item.keyId || null,
      wrappedDek: item.wrapped_dek || item.wrappedDek,
    }))
  }
  if (payload?.wrappedDek) {
    return [{ keyId: payload.keyId || null, wrappedDek: payload.wrappedDek }]
  }
  return []
}

async function loadSeed() {
  try {
    const url = chrome.runtime.getURL('seed-sites.json')
    const res = await fetch(url)
    if (!res.ok) return { origins: [] }
    return res.json()
  } catch {
    return { origins: [] }
  }
}

async function attachKeysToOrigin(origin, payload = {}) {
  if (payload.keyMode === 'reuse') {
    const vault = await loadVault()
    const keys = payload.keyIds?.length
      ? vault.filter((record) => payload.keyIds.includes(record.keyId))
      : vault.filter((record) => record.scope === 'global')
    for (const record of keys) await authorizeKey(record.keyId, origin)
    if (keys.length === 0) {
      await addGeneratedKey({ origin, kind: 'personal', label: `Key for ${origin}` })
    }
    return
  }
  await addGeneratedKey({
    origin,
    kind: payload.kind === 'group' ? 'group' : 'personal',
    label: payload.label || `Key for ${origin}`,
  })
}

async function connectOrigin(origin, payload = {}) {
  if (!origin || origin === 'null') throw new Error('Invalid origin')
  const origins = patternsForOrigin(origin)
  const granted = await chrome.permissions.request({ origins })
  if (!granted) throw new Error('Permission was not granted for this site')
  await addSite(origin)
  await attachKeysToOrigin(origin, payload)
  const keys = keysForOrigin(await loadVault(), origin).map(publicKeyView)
  return { origin, allowed: true, sites: await listSites(), keys }
}

async function connectActiveTab(payload = {}) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const tab = tabs[0]
  if (!tab?.id || !tab.url) throw new Error('No active tab')
  let origin
  try {
    const url = new URL(tab.url)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Open an http(s) site, then connect')
    }
    origin = url.origin
  } catch (err) {
    throw err instanceof Error ? err : new Error('Cannot connect this page')
  }
  const result = await connectOrigin(origin, payload)
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    })
  } catch {
    /* already injected or restricted */
  }
  return result
}

async function requireOriginKeys(origin) {
  if (!origin) throw new Error('Missing origin')
  if (!(await isSiteAllowed(origin))) throw new Error('Site is not connected to sEnd2End')
  const keys = keysForOrigin(await loadVault(), origin)
  if (keys.length === 0) throw new Error('No key is authorized for this site')
  return keys
}

async function pickKey(origin, keyId) {
  const keys = await requireOriginKeys(origin)
  if (keyId) {
    const match = findKey(keys, keyId)
    if (!match) throw new Error('That key is not authorized for this site')
    return match
  }
  return keys[0]
}

async function handle(op, payload, sender) {
  const origin = senderOrigin(payload, sender)

  if (op === 'status') {
    const allowed = origin ? await isSiteAllowed(origin) : false
    const keys = origin ? keysForOrigin(await loadVault(), origin) : await loadVault()
    const views = keys.map(publicKeyView)
    return {
      source: 'extension',
      allowed,
      origin,
      hasKey: views.length > 0,
      keyId: views[0]?.keyId,
      fingerprint: views[0]?.fingerprint,
      keys: views,
      proof: {
        version: 1,
        algorithms: ['rsa-pss-sha256', 'rsa-oaep-sha256'],
        ops: ['list_keys', 'prove'],
      },
    }
  }
  if (op === 'list_keys') {
    const keys = origin ? keysForOrigin(await loadVault(), origin) : await loadVault()
    return { keys: keys.map(publicKeyView) }
  }
  if (op === 'list_sites') return { sites: await listSites() }
  if (op === 'add_site') return connectOrigin(payload.origin, payload)
  if (op === 'remove_site') {
    const target = payload.origin
    const patterns = patternsForOrigin(target)
    try {
      await chrome.permissions.remove({ origins: patterns })
    } catch {
      /* optional */
    }
    const vault = await loadVault()
    for (const record of vault) {
      if (!record.origins.includes(target)) continue
      if (record.scope === 'site' && record.origins.length === 1) {
        await deleteKey(record.keyId)
      } else {
        await revokeKeyOrigin(record.keyId, target)
      }
    }
    return { sites: await removeSite(target) }
  }
  if (op === 'connect_active_tab') return connectActiveTab(payload)
  if (op === 'is_allowed') {
    return { allowed: await isSiteAllowed(payload.origin) }
  }
  if (op === 'generate') {
    const kind = payload?.kind === 'group' ? 'group' : 'personal'
    const siteOrigin = payload?.scope === 'global' ? null : origin || payload?.origin || null
    const { created } = await addGeneratedKey({
      label: payload?.label,
      kind,
      origin: siteOrigin,
    })
    return publicKeyView(created)
  }
  if (op === 'authorize_key') {
    const target = payload.origin
    if (!target) throw new Error('Missing origin')
    if (!(await isSiteAllowed(target))) throw new Error('Connect that site first')
    const record = await authorizeKey(payload.keyId, target)
    return publicKeyView(record)
  }
  if (op === 'revoke_key_origin') {
    const record = await revokeKeyOrigin(payload.keyId, payload.origin || origin)
    return publicKeyView(record)
  }
  if (op === 'import') {
    const record = await importKeyRecord(payload.backup, payload.passphrase, {
      label: payload.label,
      kind: payload.kind,
      origin: payload.scope === 'global' ? null : origin || payload.origin,
    })
    return publicKeyView(record)
  }
  if (op === 'export') {
    const keys = origin ? keysForOrigin(await loadVault(), origin) : await loadVault()
    const record = payload?.keyId ? findKey(keys, payload.keyId) : keys[0]
    if (!record) throw new Error('No key in the extension')
    const backup = await exportBackup(record, payload.passphrase)
    return { ...backup, label: record.label, kind: record.kind }
  }
  if (op === 'clear') {
    if (payload?.keyId) {
      await deleteKey(payload.keyId)
      return { ok: true, keys: (await loadVault()).map(publicKeyView) }
    }
    if (origin) {
      const keys = keysForOrigin(await loadVault(), origin)
      for (const record of keys) {
        if (record.scope === 'site' && record.origins.length === 1 && record.origins[0] === origin) {
          await deleteKey(record.keyId)
        } else {
          await revokeKeyOrigin(record.keyId, origin)
        }
      }
      return { ok: true }
    }
    throw new Error('Pass keyId to remove a key')
  }
  if (op === 'prove') {
    const keys = await requireOriginKeys(origin)
    const requested = Array.isArray(payload?.keyIds) && payload.keyIds.length > 0
      ? keys.filter((record) => payload.keyIds.includes(record.keyId))
      : keys
    if (requested.length === 0) throw new Error('No matching keys to prove')
    const nonce = String(payload?.nonce || '')
    if (!nonce) throw new Error('Missing nonce')
    const proofs = []
    for (const record of requested) {
      const message = proofMessageBytes(origin, record.keyId, nonce)
      const signature = await signProof(record.privateKeyPkcs8, message)
      const proof = {
        keyId: record.keyId,
        fingerprint: record.fingerprint,
        kind: record.kind,
        label: record.label,
        algorithm: 'rsa-pss-sha256',
        signature,
      }
      const wrapped = Array.isArray(payload?.wrappedChallenges)
        ? payload.wrappedChallenges.find((item) => item.keyId === record.keyId)
        : null
      if (wrapped?.wrappedChallenge) {
        proof.challenge = await decryptProofChallenge(record.privateKeyPkcs8, wrapped.wrappedChallenge)
      }
      proofs.push(proof)
    }
    return { origin, nonce, proofs }
  }
  if (op === 'encrypt') {
    await requireOriginKeys(origin)
    const plaintext = Uint8Array.from(atob(payload.plaintext), (c) => c.charCodeAt(0))
    return encryptFile(plaintext, payload.recipients)
  }
  if (op === 'decrypt') {
    const keys = await requireOriginKeys(origin)
    const result = await decryptFileWithKeys(
      payload.ciphertext,
      payload.iv,
      wrapCandidates(payload),
      payload.keyId ? [await pickKey(origin, payload.keyId)] : keys,
    )
    return result.plaintext
  }
  if (op === 'deliver') {
    const keys = await requireOriginKeys(origin)
    const result = await decryptFileWithKeys(
      payload.ciphertext,
      payload.iv,
      wrapCandidates(payload),
      payload.keyId ? [await pickKey(origin, payload.keyId)] : keys,
    )
    return {
      plaintext: result.plaintext,
      keyId: result.keyId,
      filename: payload.filename,
      contentType: payload.contentType,
      mode: payload.mode,
    }
  }
  if (op === 'wrap') {
    const record = await pickKey(origin, payload.keyId)
    return wrapDekForRecipient(payload.wrappedDek, record.privateKeyPkcs8, payload.recipient)
  }
  throw new Error(`Unknown op ${op}`)
}

chrome.runtime.onInstalled.addListener(() => {
  void loadSeed().then((seed) => ensureSeedSites(seed.origins || []))
})

void loadSeed().then((seed) => ensureSeedSites(seed.origins || []))

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.channel !== CHANNEL) return false
  handle(message.op, message.payload, sender)
    .then((result) => sendResponse({ ok: true, payload: result }))
    .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }))
  return true
})
