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

const msg = document.getElementById('msg')
const sitesEl = document.getElementById('sites')
const keysEl = document.getElementById('keys')

let toastTimer = 0
let connectedSites = []
let selectedKeyId = null

function toast(text, state) {
  window.clearTimeout(toastTimer)
  msg.textContent = text || ''
  msg.className = `toast${text ? ' is-shown' : ''}${state ? ` is-${state}` : ''}`
  if (text) {
    toastTimer = window.setTimeout(() => {
      msg.className = 'toast'
    }, 6000)
  }
}

async function withBusy(button, task) {
  button.classList.add('is-busy')
  button.disabled = true
  try {
    return await task()
  } finally {
    button.classList.remove('is-busy')
    button.disabled = false
  }
}

function shortFp(value) {
  if (!value) return 'none'
  return `${value.slice(0, 12)}…${value.slice(-8)}`
}

async function refreshSites() {
  const { sites } = await send('list_sites')
  connectedSites = sites
  sitesEl.replaceChildren()
  if (sites.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'empty'
    empty.textContent = 'No sites connected yet.'
    sitesEl.appendChild(empty)
    return
  }
  for (const origin of sites) {
    const row = document.createElement('div')
    row.className = 'site-row'
    const code = document.createElement('code')
    code.textContent = origin
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'btn btn-quiet btn-danger'
    remove.textContent = 'Remove'
    remove.addEventListener('click', () => {
      void withBusy(remove, async () => {
        try {
          await send('remove_site', { origin })
          toast(`Removed ${origin}`, 'ok')
          await refresh()
        } catch (err) {
          toast(err.message, 'error')
        }
      })
    })
    row.append(code, remove)
    sitesEl.appendChild(row)
  }
}

function renderKeys(keys) {
  keysEl.replaceChildren()
  if (!keys.length) {
    const empty = document.createElement('p')
    empty.className = 'empty'
    empty.textContent = 'No keys yet. Generate a personal key or a group key to get started.'
    keysEl.appendChild(empty)
    selectedKeyId = null
    return
  }
  if (!selectedKeyId || !keys.some((key) => key.keyId === selectedKeyId)) {
    selectedKeyId = keys[0].keyId
  }
  for (const key of keys) {
    const row = document.createElement('div')
    row.className = 'site-row'
    row.style.flexWrap = 'wrap'
    const body = document.createElement('div')
    body.style.flex = '1'
    body.style.minWidth = '0'
    const title = document.createElement('strong')
    title.textContent = `${key.label}${key.scope === 'site' ? ' · site' : ''}`
    const fp = document.createElement('code')
    fp.className = 'origin'
    fp.style.marginTop = '6px'
    fp.textContent = shortFp(key.fingerprint)
    fp.title = key.fingerprint
    const meta = document.createElement('p')
    meta.className = 'hint'
    meta.style.marginTop = '4px'
    meta.textContent =
      key.origins.length > 0
        ? `Sites: ${key.origins.join(', ')}`
        : key.scope === 'site'
          ? 'Site key is not currently attached'
          : 'Reusable key; not authorized on a site yet'
    body.append(title, fp, meta)
    const kindEl = document.createElement('select')
    kindEl.title = 'Key type'
    kindEl.append(
      new Option('Personal', 'personal', false, key.kind !== 'group'),
      new Option('Group', 'group', false, key.kind === 'group'),
    )
    kindEl.addEventListener('change', () => {
      const next = kindEl.value
      selectedKeyId = key.keyId
      void withBusy(kindEl, async () => {
        try {
          await send('set_key_kind', { keyId: key.keyId, kind: next })
          toast(`Marked as ${next}.`, 'ok')
          await refresh()
        } catch (err) {
          kindEl.value = key.kind
          toast(err.message, 'error')
        }
      })
    })
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'btn btn-quiet'
    copy.textContent = 'Copy'
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(key.fingerprint)
        selectedKeyId = key.keyId
        toast('Fingerprint copied.', 'ok')
      } catch {
        toast('Copy failed. Select the fingerprint manually.', 'error')
      }
    })
    const authorize = document.createElement('button')
    authorize.type = 'button'
    authorize.className = 'btn btn-quiet'
    authorize.textContent = 'Add to site'
    authorize.disabled =
      connectedSites.length === 0 || (key.scope === 'site' && key.origins.length > 0)
    authorize.addEventListener('click', () => {
      const origin = window.prompt('Authorize this key for which origin?', connectedSites[0] || 'https://')
      if (!origin) return
      void withBusy(authorize, async () => {
        try {
          await send('authorize_key', { keyId: key.keyId, origin: origin.replace(/\/$/, '') })
          toast(`Authorized on ${origin}`, 'ok')
          await refresh()
        } catch (err) {
          toast(err.message, 'error')
        }
      })
    })
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'btn btn-quiet btn-danger'
    remove.textContent = 'Remove'
    remove.addEventListener('click', () => {
      if (!window.confirm(`Remove “${key.label}”? Ciphertext wrapped only to this key becomes unreadable without a backup.`)) {
        return
      }
      void withBusy(remove, async () => {
        try {
          await send('clear', { keyId: key.keyId })
          toast('Key removed.', 'ok')
          await refresh()
        } catch (err) {
          toast(err.message, 'error')
        }
      })
    })
    row.append(body, kindEl, copy, authorize, remove)
    row.addEventListener('click', () => {
      selectedKeyId = key.keyId
    })
    keysEl.appendChild(row)
  }
}

async function refresh() {
  const status = await send('status', {})
  renderKeys(status.keys)
  await refreshSites()
}

document.getElementById('generate').addEventListener('click', (event) => {
  void withBusy(event.currentTarget, async () => {
    try {
      const record = await send('generate', { scope: 'global', kind: 'personal', label: 'Personal key' })
      selectedKeyId = record.keyId
      toast('Created a personal key. Publish its public key to sites you connect.', 'ok')
      await refresh()
    } catch (err) {
      toast(err.message, 'error')
    }
  })
})

document.getElementById('generateGroup').addEventListener('click', (event) => {
  void withBusy(event.currentTarget, async () => {
    try {
      const record = await send('generate', { scope: 'global', kind: 'group', label: 'Friends group' })
      selectedKeyId = record.keyId
      toast('Created a group key. Export a backup and share it only with people who should decrypt the same ciphertext.', 'ok')
      await refresh()
    } catch (err) {
      toast(err.message, 'error')
    }
  })
})

document.getElementById('export').addEventListener('submit', (event) => {
  event.preventDefault()
  const submit = event.currentTarget.querySelector('button[type="submit"]')
  void withBusy(submit, async () => {
    try {
      const backup = await send('export', {
        passphrase: document.getElementById('exportPass').value,
        keyId: selectedKeyId,
      })
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `send2end-key-${backup.keyId}.json`
      a.click()
      URL.revokeObjectURL(url)
      document.getElementById('exportPass').value = ''
      toast('Backup downloaded. Store it offline.', 'ok')
    } catch (err) {
      toast(err.message, 'error')
    }
  })
})

document.getElementById('backup').addEventListener('change', async (event) => {
  const file = event.currentTarget.files[0]
  if (!file) return
  try {
    const backup = JSON.parse(await file.text())
    if (backup.kind === 'group' || backup.kind === 'personal') {
      document.getElementById('importKind').value = backup.kind
    }
  } catch {
    // submit will report a bad file
  }
})

document.getElementById('import').addEventListener('submit', (event) => {
  event.preventDefault()
  const submit = event.currentTarget.querySelector('button[type="submit"]')
  void withBusy(submit, async () => {
    try {
      const file = document.getElementById('backup').files[0]
      const backup = JSON.parse(await file.text())
      const imported = await send('import', {
        backup,
        passphrase: document.getElementById('importPass').value,
        kind: document.getElementById('importKind').value,
        scope: 'global',
      })
      document.getElementById('importPass').value = ''
      selectedKeyId = imported.keyId
      toast('Backup imported. Authorize it on each site that should use it.', 'ok')
      await refresh()
    } catch (err) {
      toast(err.message, 'error')
    }
  })
})

void refresh().catch((err) => {
  toast(err.message, 'error')
})
