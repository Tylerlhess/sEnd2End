# Enable sEnd2End on your site

sEnd2End is a Chrome / Edge extension that holds each user’s RSA private key on their device. Your site stores **ciphertext and public keys only**. Users connect your origin once; you do not need a hardcoded allowlist in the extension.

This guide is for site operators who want end-to-end encryption in their own product.

## What you are enabling

| Stays on the user’s device | Safe to store on your servers |
|----------------------------|-------------------------------|
| RSA-OAEP 4096-bit **private** key | Public key (`publicKeySpki`), `keyId`, fingerprint |
| AES-256-GCM data keys (unwrapped) | Ciphertext, IV, per-recipient wrapped data keys |
| Preferred decrypt overlay (plaintext never enters page JS) | Filenames, content types, hashes, recipient lists |

Crypto: AES-256-GCM for payloads; each recipient gets the data key wrapped with their RSA public key.

**Preferred decrypt path:** call `deliver`, not `decrypt`. `deliver` decrypts inside the extension and shows or downloads the file. `decrypt` returns plaintext base64 to your page and should be a last resort.

## Operator checklist

1. Ship `sdk/send2end-connect.js` from this repo on your origin (or a CDN you control).
2. Add a **Connect sEnd2End** control so users can Allow your origin.
3. Add key UI: generate, publish public key to your backend, passphrase backup.
4. Persist recipient public keys (who can open a payload).
5. Encrypt in the browser via the extension; upload only ciphertext + wraps.
6. Open files with `deliver` so plaintext stays out of page JavaScript.
7. Tell users to install the extension (Chrome Web Store, or a sideload zip you host).

## User flow

1. User installs sEnd2End (Chrome Web Store, or Load unpacked from a zip you host).
2. On your site they click **Connect sEnd2End**.
3. If the content script can reach the page, they see **Allow this site** and Chrome’s host-permission prompt.
4. If the extension is missing, the button opens the Web Store (and optionally your zip).
5. Fallback: extension toolbar → **Connect this site**, then reload the tab.
6. User generates a key (extension options or your UI) and downloads a passphrase backup.
7. Your site publishes their **public** key to your user directory.
8. Encrypt / deliver from then on.

Until the origin is on that user’s connected-sites list, crypto ops fail with *Site is not connected to sEnd2End*.

## 1. Embed Connect

```html
<button type="button" data-send2end-connect>Connect sEnd2End</button>
<script src="/path/to/send2end-connect.js"></script>
<script>
  Send2EndConnect.mount({
    storeUrl: 'https://chrome.google.com/webstore/detail/YOUR_ID',
    zipUrl: '/downloads/send2end.zip', // optional sideload
    onConnected: () => location.reload(),
  })
</script>
```

Or call the SDK without the button:

```js
const state = await Send2EndConnect.probe()
// { installed, allowed, reason, status? }

if (state.installed && !state.allowed) {
  await Send2EndConnect.connect()
}
```

Copy `sdk/send2end-connect.js` into your app. Serve it from **your** origin. Do not load it from a third-party host you do not control.

Set `window.SEND2END_STORE_URL` before `mount` if you prefer not to pass `storeUrl`.

## 2. Talk to the extension

After connect, use `window.postMessage` on the page origin. Every request needs a unique `id`. Replies are `SEND2END_REPLY` with the same `id`.

| Type | Role |
|------|------|
| `SEND2END_PING` | Discovery + `{ allowed, hasKey, keyId, fingerprint, … }` |
| `SEND2END_CONNECT` | Prompt Allow for this origin (waits until the user chooses) |
| `SEND2END_REQUEST` | `{ id, op, payload }` |
| `SEND2END_REPLY` | `{ id, ok, payload?, error? }` |

Use `window.location.origin` as the postMessage target (not `*`).

### Request helper

```js
function send2end(op, payload, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage)
      reject(new Error('sEnd2End did not respond'))
    }, timeoutMs)
    function onMessage(event) {
      if (event.source !== window) return
      const data = event.data
      if (!data || data.type !== 'SEND2END_REPLY' || data.id !== id) return
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      if (!data.ok) reject(new Error(data.error || 'Request failed'))
      else resolve(data.payload)
    }
    window.addEventListener('message', onMessage)
    window.postMessage({ type: 'SEND2END_REQUEST', id, op, payload }, window.location.origin)
  })
}

function bytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i])
  return btoa(binary)
}

function base64ToBytes(value) {
  const binary = atob(String(value).replace(/\s+/g, ''))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}
```

Give `deliver` a long timeout (for example 120 seconds). Connect via the SDK already uses up to 120 seconds for the Allow prompt.

## 3. Keys

### Status

```js
const status = await send2end('status')
// {
//   source: 'extension',
//   hasKey: true,
//   keyId: '…',
//   fingerprint: 'hex sha-256 of SPKI',
//   origin: 'https://your.example',
//   allowed: true
// }
```

`status` is gated like other crypto ops: the origin must be connected.

### Generate

```js
const record = await send2end('generate')
```

Returned fields:

| Field | Send to your server? |
|-------|----------------------|
| `keyId` | Yes |
| `algorithm` (`rsa-oaep-sha256`) | Yes |
| `publicKeySpki` (base64 SPKI) | Yes |
| `fingerprint` (hex) | Yes (display / verify) |
| `privateKeyPkcs8` | **Never.** Drop it. The extension already stored it. |

Publish the public material under the signed-in user so others can encrypt **to** them.

### Backup (operators should treat this as required)

```js
const backup = await send2end('export', { passphrase })
// JSON: v, keyId, algorithm, publicKeySpki, fingerprint, kdf, iter, salt, iv, ciphertext
await send2end('import', { backup, passphrase })
await send2end('clear') // wipes the local private key only
```

Users can also generate / export / import from the extension **options** page. Your product should still prompt for a backup after generate.

## 4. Encrypt for recipients

Build a recipient list from public keys you stored:

```js
const recipients = [
  {
    userId: 42,           // your user id (number or string; echoed in wraps)
    keyId: 'uuid',
    publicKeySpki: '…',   // base64 SPKI
  },
]

const file = /* File or Uint8Array */
const result = await send2end('encrypt', {
  plaintext: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
  recipients,
})
```

`result`:

```js
{
  ciphertext: '<base64 AES-GCM>',
  iv: '<base64 12-byte IV>',
  plaintextSha256: '<hex>',
  wraps: [
    {
      recipient_user_id: 42,
      recipient_key_id: 'uuid',
      wrapped_dek: '<base64 RSA-OAEP wrap of the AES key>',
    },
  ],
}
```

Persist `ciphertext`, `iv`, `wraps`, original filename, and content type. You may store `plaintextSha256` for integrity checks. Do not store plaintext.

Include **every** person who must open the payload, including the sender if they should read it later.

## 5. Open ciphertext (`deliver`)

Look up the wrap for the current user’s `keyId`, then:

```js
await send2end(
  'deliver',
  {
    ciphertext,              // base64
    iv,                      // base64
    wrappedDek: wrap.wrapped_dek,
    filename: 'report.pdf',
    contentType: 'application/pdf',
    mode: 'view',            // or 'download'
  },
  120_000,
)
// { delivered: true, kind: 'pdf' | 'image' | 'text' | 'file' | 'download' }
```

- `mode: 'view'` — overlay in a closed shadow root (images, PDFs, text). Other types get a download button.
- `mode: 'download'` — saves the decrypted file without an overlay.

Avoid `decrypt` unless you have a reason to handle bytes in page JS. It returns plaintext **base64** to the caller.

## 6. Add a recipient later (`wrap`)

If you already have a wrap for the current user, you can re-wrap the same data key for someone new **without** the plaintext:

```js
const newWrap = await send2end('wrap', {
  wrappedDek: existingWrap.wrapped_dek,
  recipient: { userId: 99, keyId: '…', publicKeySpki: '…' },
})
// { recipient_user_id, recipient_key_id, wrapped_dek }
```

Append `newWrap` to the stored wrap list. The caller must be able to unwrap the existing DEK (their private key).

## What your backend must provide

Minimum:

1. **User public-key directory** — one or more keys per user (`keyId`, `publicKeySpki`, fingerprint).
2. **Encrypted blob store** — ciphertext, IV, metadata (name, type, hash).
3. **Wrap table** — `blob_id`, `recipient_user_id`, `recipient_key_id`, `wrapped_dek`.
4. **Auth** — only list wraps the caller is allowed to use; encryption does not replace access control.

The extension does not authenticate users to your site. A connected origin can ask the extension to encrypt or decrypt **for the key on that device**. Only connect origins you operate, and treat Connect as granting that origin crypto access for this user.

## Permissions model

- Manifest uses **optional** host permissions for `http(s)://*/*`.
- Content scripts run on a page after the user grants that origin (Chrome permission prompt on Allow).
- Lab / site zips may pre-seed `127.0.0.1`. The Chrome Web Store pack does not; every origin uses Connect.
- Users can remove a site in extension options.

HTTPS is required in production. `http://127.0.0.1` is supported for local development.

## Troubleshooting

| Symptom | What to try |
|---------|-------------|
| Connect says not installed | Extension not loaded, or this origin not granted yet. Install, then Connect or popup → **Connect this site**. Reload. |
| Crypto: *Site is not connected* | Origin not on the allowlist. Connect again. Origins are exact (`https://app.example.com` ≠ `https://www.example.com`). |
| Ping times out after Allow | Reload the tab so the content script injects. |
| *No key in the extension* | Generate or import a backup (options page or your UI). |
| Decrypt / deliver fails | Wrong wrap for this `keyId`, truncated ciphertext, or a different key than the one used to wrap. |
| User switched browsers / machines | Import the passphrase backup; public `keyId` stays the same. |

## Security notes

- Only connect origins you control.
- Never persist `privateKeyPkcs8` or `decrypt` plaintext on the server.
- A hostile page on an allowed origin can request encrypt/decrypt for the local key. Connect is a trust decision.
- Install plus key backup is operator procedure, not a substitute for trusted app deploys.
- Users can remove a site anytime in the extension options.
