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

const fp = document.getElementById('fp')
const msg = document.getElementById('msg')
const sitesEl = document.getElementById('sites')
const copyBtn = document.getElementById('copyFp')

let toastTimer = 0

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

async function refreshSites() {
  const { sites } = await send('list_sites')
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
          await refreshSites()
        } catch (err) {
          toast(err.message, 'error')
        }
      })
    })
    row.append(code, remove)
    sitesEl.appendChild(row)
  }
}

async function refresh() {
  const status = await send('status', {})
  fp.textContent = status.fingerprint || 'none'
  copyBtn.disabled = !status.fingerprint
  await refreshSites()
}

copyBtn.addEventListener('click', async () => {
  const value = fp.textContent
  if (!value || value === 'none') return
  try {
    await navigator.clipboard.writeText(value)
    toast('Fingerprint copied.', 'ok')
  } catch {
    toast('Copy failed. Select the text manually.', 'error')
  }
})

document.getElementById('generate').addEventListener('click', (event) => {
  void withBusy(event.currentTarget, async () => {
    try {
      const record = await send('generate')
      toast(`Generated ${record.keyId}. Publish the public key from your connected site, then download a backup.`, 'ok')
      await refresh()
    } catch (err) {
      toast(err.message, 'error')
    }
  })
})

document.getElementById('clear').addEventListener('click', (event) => {
  if (!window.confirm('Remove the private key from this device? Without a backup, existing ciphertext becomes unreadable.')) {
    return
  }
  void withBusy(event.currentTarget, async () => {
    try {
      await send('clear')
      toast('Local key removed.', 'ok')
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

document.getElementById('import').addEventListener('submit', (event) => {
  event.preventDefault()
  const submit = event.currentTarget.querySelector('button[type="submit"]')
  void withBusy(submit, async () => {
    try {
      const file = document.getElementById('backup').files[0]
      const backup = JSON.parse(await file.text())
      await send('import', {
        backup,
        passphrase: document.getElementById('importPass').value,
      })
      document.getElementById('importPass').value = ''
      toast('Backup imported.', 'ok')
      await refresh()
    } catch (err) {
      toast(err.message, 'error')
    }
  })
})

void refresh().catch((err) => {
  toast(err.message, 'error')
})
