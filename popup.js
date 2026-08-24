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
const keyModeWrap = document.getElementById('keyModeWrap')
const keyModeEl = document.getElementById('keyMode')

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

async function refreshKeyState(origin) {
  try {
    const status = await send('status', origin ? { origin } : {})
    const count = status.keys?.length || 0
    if (count === 0) {
      keyEl.textContent = 'none yet'
      keyEl.title = ''
      return
    }
    const first = status.keys[0]
    const extra = count > 1 ? ` +${count - 1}` : ''
    keyEl.textContent = `${shortFingerprint(first.fingerprint) || first.label}${extra}`
    keyEl.title = status.keys.map((key) => `${key.label}: ${key.fingerprint}`).join('\n')
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
    keyModeWrap.hidden = true
    await refreshKeyState(null)
    return
  }
  siteEl.textContent = origin
  const status = await send('is_allowed', { origin })
  if (status.allowed) {
    setPill('Connected', 'on')
    connectBtn.textContent = 'Already connected'
    connectBtn.disabled = true
    keyModeWrap.hidden = true
  } else {
    setPill('Not connected', 'off')
    connectBtn.textContent = 'Connect this site'
    connectBtn.disabled = false
    keyModeWrap.hidden = false
  }
  await refreshKeyState(origin)
}

connectBtn.addEventListener('click', async () => {
  toast('')
  setBusy(connectBtn, true)
  try {
    const result = await send('connect_active_tab', { keyMode: keyModeEl.value })
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
