/**
 * Embeddable sEnd2End connect helper for any https site.
 *
 * Usage:
 *   <script src="https://your-cdn/send2end-connect.js"></script>
 *   <button type="button" data-send2end-connect>Connect sEnd2End</button>
 *   <script>
 *     Send2EndConnect.mount({ storeUrl: 'https://chrome.google.com/webstore/detail/...', zipUrl: '/downloads/send2end.zip' })
 *   </script>
 *
 * Or call the API directly:
 *   const state = await Send2EndConnect.probe()
 *   await Send2EndConnect.connect()
 */
;(() => {
  const PING = 'SEND2END_PING'
  const CONNECT = 'SEND2END_CONNECT'
  const REPLY = 'SEND2END_REPLY'

  function request(type, timeoutMs = 800) {
    return new Promise((resolve) => {
      const id = crypto.randomUUID()
      const timer = window.setTimeout(() => {
        window.removeEventListener('message', onMessage)
        resolve(null)
      }, timeoutMs)
      function onMessage(event) {
        if (event.source !== window) return
        const data = event.data
        if (!data || data.type !== REPLY || data.id !== id) return
        window.clearTimeout(timer)
        window.removeEventListener('message', onMessage)
        resolve(data)
      }
      window.addEventListener('message', onMessage)
      window.postMessage({ type, id }, window.location.origin)
    })
  }

  async function probe() {
    const reply = await request(PING, 500)
    if (!reply?.ok) {
      return { installed: false, allowed: false, reason: 'missing_or_blocked' }
    }
    const allowed = Boolean(reply.payload?.allowed)
    return {
      installed: true,
      allowed,
      reason: allowed ? 'connected' : 'needs_connect',
      status: reply.payload,
    }
  }

  async function connect() {
    const first = await probe()
    if (!first.installed) {
      return { ok: false, ...first }
    }
    if (first.allowed) {
      return { ok: true, ...first }
    }
    const reply = await request(CONNECT, 120000)
    if (!reply) {
      return { ok: false, installed: true, allowed: false, reason: 'connect_timeout' }
    }
    if (!reply.ok) {
      return {
        ok: false,
        installed: true,
        allowed: false,
        reason: 'connect_denied',
        error: reply.error,
      }
    }
    return { ok: true, installed: true, allowed: true, reason: 'connected', payload: reply.payload }
  }

  function defaultStoreUrl() {
    return (
      window.SEND2END_STORE_URL ||
      'https://chrome.google.com/webstore/search/sEnd2End'
    )
  }

  function ensureStatusEl(root) {
    let el = root.querySelector('[data-send2end-status]')
    if (!el) {
      el = document.createElement('p')
      el.setAttribute('data-send2end-status', '')
      el.style.margin = '0.5rem 0 0'
      el.style.fontSize = '0.9rem'
      root.appendChild(el)
    }
    return el
  }

  function mount(options = {}) {
    const storeUrl = options.storeUrl || defaultStoreUrl()
    const zipUrl = options.zipUrl || ''
    const selector = options.selector || '[data-send2end-connect]'
    const buttons = document.querySelectorAll(selector)

    buttons.forEach((button) => {
      const root = button.parentElement || button
      const status = ensureStatusEl(root)

      async function refresh() {
        const state = await probe()
        if (!state.installed) {
          status.textContent =
            'sEnd2End is not installed (or this site is not allowed yet). Install from the Chrome Web Store, then click Connect.'
          button.textContent = options.installLabel || 'Install sEnd2End'
          button.dataset.send2endMode = 'install'
          return state
        }
        if (state.allowed) {
          status.textContent = 'sEnd2End is connected on this site.'
          button.textContent = options.connectedLabel || 'sEnd2End connected'
          button.disabled = true
          button.dataset.send2endMode = 'connected'
          return state
        }
        status.textContent =
          'sEnd2End is installed. Click Connect and choose Allow this site. Or open the extension popup → Connect this site.'
        button.textContent = options.connectLabel || 'Connect sEnd2End'
        button.disabled = false
        button.dataset.send2endMode = 'connect'
        return state
      }

      button.addEventListener('click', async () => {
        const mode = button.dataset.send2endMode || 'connect'
        if (mode === 'install') {
          window.open(storeUrl, '_blank', 'noopener,noreferrer')
          if (zipUrl) {
            status.innerHTML = `Opened the store. Sideload zip also available: <a href="${zipUrl}">download</a>. After install, return here and click Connect.`
          }
          return
        }
        if (mode === 'connected') return
        status.textContent = 'Waiting for Allow in the sEnd2End prompt…'
        const result = await connect()
        if (result.ok) {
          await refresh()
          if (typeof options.onConnected === 'function') options.onConnected(result)
          return
        }
        if (!result.installed) {
          button.dataset.send2endMode = 'install'
          button.textContent = options.installLabel || 'Install sEnd2End'
          status.textContent =
            'Extension not detected. Install sEnd2End, then use the extension icon → Connect this site, and reload.'
          window.open(storeUrl, '_blank', 'noopener,noreferrer')
          return
        }
        status.textContent =
          result.error ||
          'Connect cancelled. You can also click the sEnd2End toolbar icon → Connect this site.'
      })

      void refresh()
    })
  }

  window.Send2EndConnect = { probe, connect, mount, PING, CONNECT, REPLY }
})()
