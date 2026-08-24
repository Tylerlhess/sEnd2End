import {
  decryptFile,
  encryptFile,
  exportBackup,
  generateUserKeyPair,
  importBackup,
  wrapDekForRecipient,
} from './crypto.js'
import {
  addSite,
  ensureSeedSites,
  isSiteAllowed,
  listSites,
  patternsForOrigin,
  removeSite,
} from './sites.js'

const KEY = 'send2endKey'
const CHANNEL = 'send2end'

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

async function loadKey() {
  const data = await chrome.storage.local.get(KEY)
  return data[KEY] || null
}

async function saveKey(record) {
  await chrome.storage.local.set({ [KEY]: record })
}

async function connectOrigin(origin) {
  if (!origin || origin === 'null') throw new Error('Invalid origin')
  const origins = patternsForOrigin(origin)
  const granted = await chrome.permissions.request({ origins })
  if (!granted) throw new Error('Permission was not granted for this site')
  await addSite(origin)
  return { origin, allowed: true, sites: await listSites() }
}

async function connectActiveTab() {
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
  const result = await connectOrigin(origin)
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    })
  } catch {
    /* content script may already be present or page restricted */
  }
  return result
}

async function handle(op, payload, sender) {
  if (op === 'status') {
    const record = await loadKey()
    let pageOrigin = typeof payload?.origin === 'string' ? payload.origin : null
    if (!pageOrigin && sender?.url) {
      try {
        pageOrigin = new URL(sender.url).origin
      } catch {
        pageOrigin = null
      }
    }
    const allowed = pageOrigin ? await isSiteAllowed(pageOrigin) : false
    return {
      source: 'extension',
      hasKey: Boolean(record),
      keyId: record?.keyId,
      fingerprint: record?.fingerprint,
      origin: pageOrigin,
      allowed,
    }
  }
  if (op === 'list_sites') return { sites: await listSites() }
  if (op === 'add_site') return connectOrigin(payload.origin)
  if (op === 'remove_site') {
    const origin = payload.origin
    const patterns = patternsForOrigin(origin)
    try {
      await chrome.permissions.remove({ origins: patterns })
    } catch {
      /* optional */
    }
    return { sites: await removeSite(origin) }
  }
  if (op === 'connect_active_tab') return connectActiveTab()
  if (op === 'is_allowed') {
    return { allowed: await isSiteAllowed(payload.origin) }
  }
  if (op === 'generate') {
    const record = await generateUserKeyPair()
    await saveKey(record)
    return record
  }
  if (op === 'import') {
    const record = await importBackup(payload.backup, payload.passphrase)
    await saveKey(record)
    return record
  }
  if (op === 'export') {
    const record = await loadKey()
    if (!record) throw new Error('No key in the extension')
    return exportBackup(record, payload.passphrase)
  }
  if (op === 'clear') {
    await chrome.storage.local.remove(KEY)
    return { ok: true }
  }
  if (op === 'encrypt') {
    const plaintext = Uint8Array.from(atob(payload.plaintext), (c) => c.charCodeAt(0))
    return encryptFile(plaintext, payload.recipients)
  }
  if (op === 'decrypt') {
    const record = await loadKey()
    if (!record) throw new Error('No key in the extension')
    return decryptFile(payload.ciphertext, payload.iv, payload.wrappedDek, record.privateKeyPkcs8)
  }
  if (op === 'deliver') {
    const record = await loadKey()
    if (!record) throw new Error('No key in the extension')
    const plaintext = await decryptFile(
      payload.ciphertext,
      payload.iv,
      payload.wrappedDek,
      record.privateKeyPkcs8,
    )
    return {
      plaintext,
      filename: payload.filename,
      contentType: payload.contentType,
      mode: payload.mode,
    }
  }
  if (op === 'wrap') {
    const record = await loadKey()
    if (!record) throw new Error('No key in the extension')
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
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }))
  return true
})
