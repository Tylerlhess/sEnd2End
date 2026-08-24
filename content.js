const PING = 'SEND2END_PING'
const REQUEST = 'SEND2END_REQUEST'
const CONNECT = 'SEND2END_CONNECT'
const REPLY = 'SEND2END_REPLY'
const CHANNEL = 'send2end'

let overlayHost = null
let overlayUrl = null
let connectHost = null

function replyToPage(id, origin, extra) {
  window.postMessage({ type: REPLY, id, ...extra }, origin)
}

function runtimeSend(op, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ channel: CHANNEL, op, payload }, (response) => {
      const err = chrome.runtime.lastError
      if (err) {
        reject(new Error(err.message))
        return
      }
      if (!response?.ok) {
        reject(new Error(response?.error || 'No response'))
        return
      }
      resolve(response.payload)
    })
  })
}

function bytesFromB64(value) {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

function safeFilename(name) {
  const base = (name || 'evidence.bin').split(/[/\\]/).pop() || 'evidence.bin'
  return base.replace(/[<>:"|?*]/g, '_')
}

function guessKind(filename, contentType) {
  const type = (contentType || '').toLowerCase()
  const name = (filename || '').toLowerCase()
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name)) return 'image'
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (type.startsWith('text/') || /\.(txt|md|csv|json|xml|log)$/i.test(name)) return 'text'
  if (type.includes('zip') || /\.zipx?$/i.test(name)) return 'zip'
  return 'file'
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = safeFilename(filename)
  a.click()
  URL.revokeObjectURL(url)
}

function closeOverlay() {
  if (overlayUrl) {
    URL.revokeObjectURL(overlayUrl)
    overlayUrl = null
  }
  if (overlayHost) {
    overlayHost.remove()
    overlayHost = null
  }
}

function closeConnectPrompt() {
  if (connectHost) {
    connectHost.remove()
    connectHost = null
  }
}

const BRAND_MARK = `
  <svg viewBox="0 0 128 128" width="30" height="30" aria-hidden="true">
    <defs>
      <linearGradient id="s2e-tile" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#2dd4bf" />
        <stop offset="1" stop-color="#0d6c64" />
      </linearGradient>
      <mask id="s2e-cut">
        <rect width="128" height="128" fill="#000" />
        <path d="M34 71a13 13 0 0 1 13-13h34a13 13 0 0 1 13 13v22a13 13 0 0 1-13 13H47a13 13 0 0 1-13-13z" fill="#fff" />
        <path d="M64 32a24 24 0 0 1 24 24v8h-9v-8a15 15 0 0 0-30 0v8h-9v-8a24 24 0 0 1 24-24z" fill="#fff" />
        <circle cx="64" cy="78" r="7.5" fill="#000" />
        <path d="M61 78h6l3.5 18h-13z" fill="#000" />
      </mask>
    </defs>
    <rect x="3" y="3" width="122" height="122" rx="30" fill="url(#s2e-tile)" />
    <rect width="128" height="128" fill="#f8fafc" mask="url(#s2e-cut)" />
  </svg>
`

const PANEL_CSS = `
  :host { all: initial; }
  .backdrop { position: fixed; inset: 0; z-index: 2147483000; padding: 24px;
    display: flex; align-items: center; justify-content: center;
    background: rgba(4, 9, 20, 0.62); backdrop-filter: blur(3px);
    animation: fade .18s cubic-bezier(.2,.8,.3,1) both; }
  .panel { box-sizing: border-box; color: #e8eefb;
    background: linear-gradient(180deg, #141f33 0%, #0d1523 100%);
    border: 1px solid rgba(148,163,184,.22); border-radius: 16px;
    box-shadow: 0 24px 60px rgba(2,6,18,.6); padding: 18px;
    font: 13.5px/1.55 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    animation: rise .2s cubic-bezier(.2,.8,.3,1) both; }
  .head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .head svg { flex: none; border-radius: 8px; }
  h1 { font: 640 15px/1.2 system-ui, sans-serif; margin: 0; letter-spacing: -.01em; }
  .sub { font-size: 11.5px; color: #93a4bd; margin-top: 2px; }
  p { margin: 0 0 12px; color: #c7d3e6; }
  code { font-family: ui-monospace, Consolas, monospace; font-size: 12px; word-break: break-all;
    display: block; margin-top: 8px; padding: 8px 10px; border-radius: 8px; color: #e8eefb;
    background: rgba(2,6,18,.55); border: 1px solid rgba(148,163,184,.18); }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  button { box-sizing: border-box; font: 560 13.5px/1 system-ui, sans-serif; cursor: pointer;
    padding: 10px 14px; min-height: 36px; border-radius: 11px; color: #e8eefb;
    border: 1px solid rgba(148,163,184,.32); background: rgba(255,255,255,.04);
    transition: transform .12s cubic-bezier(.2,.8,.3,1), filter .16s, box-shadow .2s, border-color .2s; }
  button:hover { transform: translateY(-1px); filter: brightness(1.08); border-color: #2dd4bf;
    box-shadow: 0 8px 22px rgba(2,6,18,.5); }
  button:active { transform: translateY(1px) scale(.995); filter: brightness(.96); box-shadow: none; }
  button:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(45,212,191,.32); }
  button.primary { font-weight: 640; color: #04211f; border-color: transparent;
    background: linear-gradient(180deg, #2dd4bf 0%, #14a99a 100%);
    box-shadow: 0 10px 24px rgba(20,169,154,.28); }
  button.primary:hover { border-color: transparent; box-shadow: 0 14px 30px rgba(20,169,154,.38); }
  @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
  @keyframes rise { from { opacity: 0; transform: translateY(8px) scale(.985) } to { opacity: 1; transform: none } }
  @media (prefers-reduced-motion: reduce) {
    .backdrop, .panel { animation-duration: .001ms }
    button { transition-duration: .001ms }
  }
`

function showConnectPrompt(origin, replyId) {
  closeConnectPrompt()
  connectHost = document.createElement('div')
  const shadow = connectHost.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = `
    ${PANEL_CSS}
    .panel { max-width: min(92vw, 420px); }
  `
  const backdrop = document.createElement('div')
  backdrop.className = 'backdrop'
  const panel = document.createElement('div')
  panel.className = 'panel'
  const head = document.createElement('div')
  head.className = 'head'
  head.innerHTML = `${BRAND_MARK}<div><h1>Connect sEnd2End?</h1><div class="sub">Keys stay on this device</div></div>`
  const body = document.createElement('p')
  body.textContent = 'Allow this site to use your on-device keys for end-to-end encryption.'
  const originEl = document.createElement('code')
  originEl.textContent = origin
  body.appendChild(originEl)
  const actions = document.createElement('div')
  actions.className = 'actions'
  const allowBtn = document.createElement('button')
  allowBtn.type = 'button'
  allowBtn.className = 'primary'
  allowBtn.textContent = 'Allow this site'
  const cancelBtn = document.createElement('button')
  cancelBtn.type = 'button'
  cancelBtn.textContent = 'Not now'
  cancelBtn.addEventListener('click', () => {
    closeConnectPrompt()
    if (replyId) replyToPage(replyId, origin, { ok: false, error: 'User declined connect' })
  })
  allowBtn.addEventListener('click', () => {
    void runtimeSend('add_site', { origin })
      .then((payload) => {
        closeConnectPrompt()
        if (replyId) replyToPage(replyId, origin, { ok: true, payload })
        else window.postMessage({ type: REPLY, connected: true, payload }, origin)
      })
      .catch((err) => {
        if (replyId) {
          replyToPage(replyId, origin, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      })
  })
  actions.append(allowBtn, cancelBtn)
  panel.append(head, body, actions)
  backdrop.appendChild(panel)
  shadow.append(style, backdrop)
  document.documentElement.appendChild(connectHost)
}

function showOverlay({ kind, blob, filename, text }) {
  closeOverlay()
  overlayHost = document.createElement('div')
  const shadow = overlayHost.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = `
    ${PANEL_CSS}
    .panel { max-width: min(96vw, 1100px); max-height: 92vh; overflow: auto; }
    .bar { display: flex; justify-content: space-between; gap: 12px; align-items: center;
      margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid rgba(148,163,184,.18); }
    .bar .title { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .bar svg { flex: none; border-radius: 8px; }
    h1 { font: 640 14px/1.25 system-ui, sans-serif; margin: 0; overflow-wrap: anywhere; }
    .sub { font-size: 11.5px; color: #93a4bd; margin-top: 2px; }
    img, iframe { display: block; max-width: 100%; max-height: 78vh; border: 0; border-radius: 10px;
      background: #020617; }
    iframe { width: 900px; height: 700px; }
    pre { white-space: pre-wrap; word-break: break-word; margin: 0; padding: 12px;
      border-radius: 10px; background: rgba(2,6,18,.55); border: 1px solid rgba(148,163,184,.18);
      font: 12.5px/1.5 ui-monospace, Consolas, monospace; max-height: 76vh; overflow: auto; }
  `
  const backdrop = document.createElement('div')
  backdrop.className = 'backdrop'
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeOverlay()
  })
  const panel = document.createElement('div')
  panel.className = 'panel'
  const bar = document.createElement('div')
  bar.className = 'bar'
  const titleWrap = document.createElement('div')
  titleWrap.className = 'title'
  const heading = document.createElement('div')
  const title = document.createElement('h1')
  title.textContent = filename || 'Decrypted file'
  const sub = document.createElement('div')
  sub.className = 'sub'
  sub.textContent = 'Decrypted in sEnd2End — not visible to this page'
  heading.append(title, sub)
  titleWrap.innerHTML = BRAND_MARK
  titleWrap.appendChild(heading)
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.textContent = 'Close'
  closeBtn.addEventListener('click', closeOverlay)
  bar.append(titleWrap, closeBtn)
  panel.appendChild(bar)

  if (kind === 'image' && blob) {
    overlayUrl = URL.createObjectURL(blob)
    const img = document.createElement('img')
    img.alt = filename || 'Decrypted evidence'
    img.src = overlayUrl
    panel.appendChild(img)
  } else if (kind === 'pdf' && blob) {
    overlayUrl = URL.createObjectURL(blob)
    const frame = document.createElement('iframe')
    frame.title = filename || 'Decrypted PDF'
    frame.src = overlayUrl
    frame.width = 900
    frame.height = 700
    panel.appendChild(frame)
  } else if (kind === 'text') {
    const pre = document.createElement('pre')
    pre.textContent = text || ''
    panel.appendChild(pre)
  } else {
    const p = document.createElement('p')
    p.textContent = 'Decrypted in the plugin.'
    const save = document.createElement('button')
    save.type = 'button'
    save.className = 'primary'
    save.textContent = 'Download decrypted file'
    save.addEventListener('click', () => triggerDownload(blob, filename))
    panel.append(p, save)
  }

  backdrop.appendChild(panel)
  shadow.append(style, backdrop)
  document.documentElement.appendChild(overlayHost)
}

function deliver(payload) {
  const bytes = bytesFromB64(payload.plaintext)
  const filename = payload.filename || 'evidence.bin'
  const contentType = payload.contentType || 'application/octet-stream'
  const blob = new Blob([bytes], { type: contentType })
  if (payload.mode === 'download') {
    triggerDownload(blob, filename)
    return 'download'
  }
  const kind = guessKind(filename, contentType)
  if (kind === 'image' || kind === 'pdf') {
    showOverlay({ kind, blob, filename })
    return kind
  }
  if (kind === 'text') {
    showOverlay({ kind: 'text', filename, text: new TextDecoder().decode(bytes) })
    return 'text'
  }
  showOverlay({ kind: 'file', blob, filename })
  return kind
}

const CRYPTO_OPS = new Set(['generate', 'import', 'export', 'clear', 'encrypt', 'decrypt', 'deliver', 'wrap', 'status'])

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeOverlay()
    closeConnectPrompt()
  }
})

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const data = event.data
  if (!data || typeof data !== 'object') return
  const origin = event.origin

  if (data.type === PING) {
    void runtimeSend('status', { origin })
      .then((payload) => {
        replyToPage(data.id, origin, {
          ok: true,
          payload: { source: 'extension', allowed: Boolean(payload.allowed), ...payload },
        })
      })
      .catch((err) => {
        replyToPage(data.id, origin, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    return
  }

  if (data.type === CONNECT) {
    void runtimeSend('is_allowed', { origin })
      .then((payload) => {
        if (payload.allowed) {
          replyToPage(data.id, origin, { ok: true, payload: { origin, allowed: true } })
          return
        }
        showConnectPrompt(origin, data.id)
      })
      .catch((err) => {
        replyToPage(data.id, origin, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    return
  }

  if (data.type !== REQUEST) return

  void runtimeSend('is_allowed', { origin })
    .then((gate) => {
      if (!gate.allowed && CRYPTO_OPS.has(data.op)) {
        replyToPage(data.id, origin, {
          ok: false,
          error: 'Site is not connected to sEnd2End. Click Connect sEnd2End first.',
        })
        return
      }
      const payload =
        data.op === 'status' ? { ...(data.payload || {}), origin } : data.payload
      return runtimeSend(data.op, payload).then((responsePayload) => {
        if (data.op === 'deliver') {
          try {
            const kind = deliver(responsePayload)
            replyToPage(data.id, origin, { ok: true, payload: { delivered: true, kind } })
          } catch (fail) {
            replyToPage(data.id, origin, {
              ok: false,
              error: fail instanceof Error ? fail.message : String(fail),
            })
          }
          return
        }
        replyToPage(data.id, origin, { ok: true, payload: responsePayload })
      })
    })
    .catch((err) => {
      replyToPage(data.id, origin, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    })
})
