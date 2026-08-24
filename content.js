const PING = 'SEND2END_PING'
const REQUEST = 'SEND2END_REQUEST'
const CONNECT = 'SEND2END_CONNECT'
const REPLY = 'SEND2END_REPLY'
const CHANNEL = 'send2end'

let overlayHost = null
let overlayUrl = null
let connectHost = null
const inlineImages = new Map()
const inlineImagePending = new WeakSet()
const MAX_INLINE_BYTES = 25 * 1024 * 1024

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

function bytesToB64(bytes) {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
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
  allowBtn.textContent = 'Allow + new site key'
  const reuseBtn = document.createElement('button')
  reuseBtn.type = 'button'
  reuseBtn.textContent = 'Allow + reuse keys'
  const cancelBtn = document.createElement('button')
  cancelBtn.type = 'button'
  cancelBtn.textContent = 'Not now'
  cancelBtn.addEventListener('click', () => {
    closeConnectPrompt()
    if (replyId) replyToPage(replyId, origin, { ok: false, error: 'User declined connect' })
  })
  function connectWithKeyMode(keyMode) {
    void runtimeSend('add_site', { origin, keyMode })
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
  }
  allowBtn.addEventListener('click', () => connectWithKeyMode('ask'))
  reuseBtn.addEventListener('click', () => connectWithKeyMode('reuse'))
  actions.append(allowBtn, reuseBtn, cancelBtn)
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

function inlineImageStyle(source) {
  const computed = getComputedStyle(source)
  const rect = source.getBoundingClientRect()
  const width = source.style.width || (rect.width > 0 ? `${rect.width}px` : source.getAttribute('width'))
  const height = source.style.height || (rect.height > 0 ? `${rect.height}px` : source.getAttribute('height'))
  return {
    display: computed.display === 'inline' ? 'inline-block' : computed.display,
    width: width && width !== 'auto' ? width : 'auto',
    height: height && height !== 'auto' ? height : 'auto',
    maxWidth: computed.maxWidth,
    maxHeight: computed.maxHeight,
    objectFit: computed.objectFit,
    objectPosition: computed.objectPosition,
    borderRadius: computed.borderRadius,
  }
}

function createInlineContentHost(source) {
  const styleValues = inlineImageStyle(source)
  const originalDisplay = source.style.getPropertyValue('display')
  const originalDisplayPriority = source.style.getPropertyPriority('display')
  const host = document.createElement('span')
  const label =
    source instanceof HTMLImageElement
      ? source.alt
      : source.getAttribute('aria-label') || source.dataset.send2endFilename
  host.setAttribute('role', 'group')
  host.setAttribute('aria-label', label || 'Encrypted content')
  host.style.setProperty('display', styleValues.display || 'inline-block', 'important')
  host.style.setProperty('width', styleValues.width, 'important')
  host.style.setProperty('height', styleValues.height, 'important')
  host.style.setProperty('max-width', styleValues.maxWidth || '100%', 'important')
  if (styleValues.maxHeight && styleValues.maxHeight !== 'none') {
    host.style.setProperty('max-height', styleValues.maxHeight, 'important')
  }
  host.style.setProperty('vertical-align', 'middle', 'important')

  const shadow = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = `
    :host { contain: content; }
    .frame { box-sizing: border-box; width: 100%; height: 100%; min-width: 48px; min-height: 48px;
      display: grid; place-items: center; overflow: hidden; border-radius: ${styleValues.borderRadius || '8px'};
      background: linear-gradient(110deg, #101827 30%, #17263a 45%, #101827 60%);
      background-size: 220% 100%; animation: shimmer 1.4s linear infinite;
      color: #a9b7ca; font: 12px/1.4 system-ui, sans-serif; }
    img { display: block; width: 100%; height: 100%; max-width: 100%; object-fit: ${styleValues.objectFit || 'contain'};
      object-position: ${styleValues.objectPosition || '50% 50%'}; border-radius: inherit; }
    iframe { display: block; width: 100%; height: 100%; min-width: 320px; min-height: 480px;
      border: 0; border-radius: inherit; background: #fff; }
    pre { box-sizing: border-box; width: 100%; max-height: 70vh; margin: 0; padding: 12px;
      overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; text-align: left;
      color: #e8eefb; background: #0b1220; font: 13px/1.55 ui-monospace, Consolas, monospace; }
    button { padding: 9px 14px; border: 1px solid rgba(45,212,191,.5); border-radius: 9px;
      background: #14a99a; color: #04211f; font: 600 13px/1 system-ui, sans-serif; cursor: pointer; }
    button:hover { filter: brightness(1.08); }
    .error { padding: 10px; text-align: center; color: #fca5a5; }
    @keyframes shimmer { to { background-position-x: -220%; } }
    @media (prefers-reduced-motion: reduce) { .frame { animation: none; } }
  `
  const frame = document.createElement('span')
  frame.className = 'frame'
  frame.textContent = 'Decrypting…'
  shadow.append(style, frame)

  source.before(host)
  source.style.setProperty('display', 'none', 'important')
  return { host, frame, originalDisplay, originalDisplayPriority }
}

async function loadInlineCiphertext(source) {
  const inline = source.dataset.send2endCiphertext
  if (inline) return inline.replace(/\s+/g, '')

  const sourceUrl =
    source.dataset.send2endCiphertextUrl || source.dataset.send2endSrc
  if (!sourceUrl) throw new Error('Missing encrypted content URL')
  const url = new URL(sourceUrl, window.location.href)
  if (url.origin !== window.location.origin) {
    throw new Error('Encrypted content URL must use the page origin')
  }
  const response = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/octet-stream' },
  })
  if (!response.ok) throw new Error(`Encrypted content request failed (${response.status})`)
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > MAX_INLINE_BYTES) throw new Error('Encrypted content is too large')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_INLINE_BYTES) throw new Error('Encrypted content is too large')
  return bytesToB64(bytes)
}

function finishInlineFrame(frame) {
  frame.style.animation = 'none'
  frame.style.background = 'transparent'
}

async function decryptInlineContent(source) {
  if (!(source instanceof HTMLElement)) return
  if (inlineImagePending.has(source)) return
  if (
    !source.hasAttribute('data-send2end-inline') &&
    !(source instanceof HTMLImageElement && source.hasAttribute('data-send2end-image'))
  ) {
    return
  }
  if (!source.dataset.send2endIv || !source.dataset.send2endWrappedDek) return
  if (
    !source.dataset.send2endCiphertext &&
    !source.dataset.send2endCiphertextUrl &&
    !source.dataset.send2endSrc
  ) {
    return
  }

  const signature = [
    source.dataset.send2endCiphertext || '',
    source.dataset.send2endCiphertextUrl || '',
    source.dataset.send2endSrc || '',
    source.dataset.send2endIv || '',
    source.dataset.send2endWrappedDek || '',
    source.dataset.send2endKeyId || '',
    source.dataset.send2endContentType || '',
    source.dataset.send2endFilename || '',
    source.dataset.send2endMode || '',
  ].join('\u0000')
  const existing = inlineImages.get(source)
  if (existing?.signature === signature) return
  if (existing) {
    if (existing.url) URL.revokeObjectURL(existing.url)
    existing.host.remove()
    source.style.setProperty('display', existing.originalDisplay, existing.originalDisplayPriority)
    inlineImages.delete(source)
  }

  inlineImagePending.add(source)
  const view = createInlineContentHost(source)
  inlineImages.set(source, {
    host: view.host,
    url: null,
    signature,
    originalDisplay: view.originalDisplay,
    originalDisplayPriority: view.originalDisplayPriority,
  })
  try {
    const gate = await runtimeSend('is_allowed', { origin: window.location.origin })
    if (!gate.allowed) throw new Error('Connect this site to sEnd2End')
    const ciphertext = await loadInlineCiphertext(source)
    const plaintext = await runtimeSend('decrypt', {
      ciphertext,
      iv: source.dataset.send2endIv,
      wrappedDek: source.dataset.send2endWrappedDek,
      keyId: source.dataset.send2endKeyId || undefined,
    })
    if (!source.isConnected) throw new Error('Content was removed')
    const contentType =
      source.dataset.send2endContentType ||
      (source instanceof HTMLImageElement ? 'image/png' : 'application/octet-stream')
    const filename = source.dataset.send2endFilename || source.getAttribute('download') || 'decrypted-file'
    const bytes = bytesFromB64(plaintext)
    const kind = guessKind(filename, contentType)
    const record = inlineImages.get(source)
    if (!record) return

    if (kind === 'text' && source.dataset.send2endMode !== 'download') {
      const pre = document.createElement('pre')
      pre.textContent = new TextDecoder().decode(bytes)
      view.frame.replaceChildren(pre)
      finishInlineFrame(view.frame)
      return
    }

    const blob = new Blob([bytes], { type: contentType })
    const url = URL.createObjectURL(blob)
    record.url = url

    if (kind === 'image' && source.dataset.send2endMode !== 'download') {
      const image = document.createElement('img')
      image.alt =
        source instanceof HTMLImageElement
          ? source.alt || ''
          : source.getAttribute('aria-label') || source.dataset.send2endFilename || ''
      image.addEventListener('load', () => {
        view.frame.replaceChildren(image)
        finishInlineFrame(view.frame)
      }, { once: true })
      image.addEventListener('error', () => {
        URL.revokeObjectURL(url)
        record.url = null
        view.frame.className = 'frame error'
        view.frame.textContent = 'Decrypted image could not be displayed.'
      }, { once: true })
      image.src = url
      return
    }

    if (kind === 'pdf' && source.dataset.send2endMode !== 'download') {
      const frame = document.createElement('iframe')
      frame.title = filename
      frame.src = url
      view.frame.replaceChildren(frame)
      finishInlineFrame(view.frame)
      return
    }

    const download = document.createElement('button')
    download.type = 'button'
    download.textContent = `Download ${safeFilename(filename)}`
    download.addEventListener('click', () => {
      const link = document.createElement('a')
      link.href = url
      link.download = safeFilename(filename)
      link.click()
    })
    view.frame.replaceChildren(download)
    finishInlineFrame(view.frame)
  } catch (err) {
    view.frame.className = 'frame error'
    view.frame.textContent = err instanceof Error ? err.message : 'Could not decrypt content'
  } finally {
    inlineImagePending.delete(source)
  }
}

function scanInlineContent(root) {
  if (root instanceof HTMLElement) void decryptInlineContent(root)
  if (root instanceof Element || root instanceof Document) {
    root.querySelectorAll('[data-send2end-inline], img[data-send2end-image]').forEach((element) => {
      void decryptInlineContent(element)
    })
  }
}

function cleanupInlineImages() {
  for (const [source, record] of inlineImages) {
    if (source.isConnected) continue
    if (record.url) URL.revokeObjectURL(record.url)
    record.host.remove()
    inlineImages.delete(source)
  }
}

const inlineImageObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === 'attributes') {
      scanInlineContent(mutation.target)
      continue
    }
    mutation.addedNodes.forEach(scanInlineContent)
  }
  cleanupInlineImages()
})

inlineImageObserver.observe(document, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: [
    'data-send2end-image',
    'data-send2end-inline',
    'data-send2end-src',
    'data-send2end-ciphertext-url',
    'data-send2end-ciphertext',
    'data-send2end-iv',
    'data-send2end-wrapped-dek',
    'data-send2end-key-id',
    'data-send2end-content-type',
    'data-send2end-filename',
    'data-send2end-mode',
  ],
})
scanInlineContent(document)

const CRYPTO_OPS = new Set([
  'generate',
  'import',
  'export',
  'clear',
  'encrypt',
  'decrypt',
  'deliver',
  'wrap',
  'status',
  'list_keys',
  'prove',
  'authorize_key',
])

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
      const payload = CRYPTO_OPS.has(data.op)
        ? { ...(data.payload || {}), origin }
        : data.payload
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
