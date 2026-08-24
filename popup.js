function send(op, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ channel: 'send2end', op, payload }, (response) => {
      const err = chrome.runtime.lastError
      if (err) {
        reject(new Error(err.message))
        return
      }
      if (!response?.ok) {
        reject(new Error(response?.error || 'Request failed'))
        return
      }
      resolve(response.payload)
    })
  })
}

const siteEl = document.getElementById('site')
const pillEl = document.getElementById('pill')
const keyEl = document.getElementById('keyState')
const msg = document.getElementById('msg')
const connectBtn = document.getElementById('connect')

function setPill(text, state) {
  pillEl.textContent = text
  pillEl.className = state ? `pill is-${state}` : 'pill'
}

function toast(text, state) {
  msg.textContent = text || ''
  msg.className = `toast${text ? ' is-shown' : ''}${state ? ` is-${state}` : ''}`
}

function setBusy(button, busy) {
  button.classList.toggle('is-busy', busy)
  button.disabled = busy
}

function shortFingerprint(value) {
  if (!value) return null
  return `${value.slice(0, 8)}…${value.slice(-4)}`
}

async function currentOrigin() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const tab = tabs[0]
  if (!tab?.url) return null
  try {
    const url = new URL(tab.url)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

async function refreshKeyState() {
  try {
    const status = await send('status', {})
    const short = shortFingerprint(status.fingerprint)
    keyEl.textContent = short || 'not created yet'
    keyEl.title = status.fingerprint || ''
  } catch {
    keyEl.textContent = 'unavailable'
  }
}

async function refresh() {
  const origin = await currentOrigin()
  if (!origin) {
    setPill('Unsupported', 'off')
    siteEl.textContent = 'Open an http(s) page to connect it.'
    connectBtn.disabled = true
    connectBtn.textContent = 'Connect this site'
    await refreshKeyState()
    return
  }
  siteEl.textContent = origin
  const status = await send('is_allowed', { origin })
  if (status.allowed) {
    setPill('Connected', 'on')
    connectBtn.textContent = 'Already connected'
    connectBtn.disabled = true
  } else {
    setPill('Not connected', 'off')
    connectBtn.textContent = 'Connect this site'
    connectBtn.disabled = false
  }
  await refreshKeyState()
}

connectBtn.addEventListener('click', async () => {
  toast('')
  setBusy(connectBtn, true)
  try {
    const result = await send('connect_active_tab')
    toast(`Connected ${result.origin}. Reload the page if it still shows offline.`, 'ok')
  } catch (err) {
    toast(err.message, 'error')
  } finally {
    connectBtn.classList.remove('is-busy')
  }
  await refresh()
})

document.getElementById('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage()
})

void refresh().catch((err) => {
  setPill('Error', 'error')
  siteEl.textContent = err.message
})
