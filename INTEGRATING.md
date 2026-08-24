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

A user can hold several keys: a personal key, per-site keys, and group keys. `status` lists the keys authorized for **your origin** only.

```js
const status = await send2end('status')
// {
//   source: 'extension',
//   allowed: true,
//   origin: 'https://your.example',
//   hasKey: true,
//   keyId: '…',              // first authorized key (compat)
//   fingerprint: '…',
//   keys: [{ keyId, label, kind: 'personal'|'group', scope, origins, publicKeySpki, fingerprint, algorithm }],
//   proof: { version: 1, algorithms: ['rsa-pss-sha256', 'rsa-oaep-sha256'], ops: ['list_keys', 'prove'] }
// }
```

Advertise that the site accepts public-key possession proofs when `proof` is present.

### Generate (adds a key; does not replace others)

```js
const personal = await send2end('generate', { scope: 'global', kind: 'personal', label: 'Personal' })
const siteKey = await send2end('generate', { kind: 'personal', label: 'This site' }) // scoped to this origin
const group = await send2end('generate', { scope: 'global', kind: 'group', label: 'Friends' })
```

Returned fields (public only): `keyId`, `label`, `kind`, `scope`, `origins`, `algorithm`, `publicKeySpki`, `fingerprint`.

Publish personal/site public keys on the signed-in user. For a **friends group**, one member generates a group key, exports a backup, and the others import that backup. Encrypt **once** to the group `publicKeySpki`. The site stores a single ciphertext; anyone with that group private key can decrypt.

### Prove the user holds a key

Do not trust a pasted public key alone. Ask the extension to sign a nonce with each advertised key:

```js
const nonce = crypto.randomUUID()
const { proofs } = await send2end('prove', {
  nonce,
  keyIds: status.keys.map((key) => key.keyId), // optional; default = all keys for this origin
})

for (const proof of proofs) {
  const publicKey = await crypto.subtle.importKey(
    'spki',
    Uint8Array.from(atob(status.keys.find((key) => key.keyId === proof.keyId).publicKeySpki), (c) => c.charCodeAt(0)),
    { name: 'RSA-PSS', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const message = new TextEncoder().encode(`SEND2END-PROOF-v1\n${location.origin}\n${proof.keyId}\n${nonce}`)
  const ok = await crypto.subtle.verify(
    { name: 'RSA-PSS', saltLength: 32 },
    publicKey,
    Uint8Array.from(atob(proof.signature), (c) => c.charCodeAt(0)),
    message,
  )
  if (!ok) throw new Error('Proof failed')
}
```

Optional extra: encrypt the nonce with RSA-OAEP to that public key and send `wrappedChallenges: [{ keyId, wrappedChallenge }]`. The proof then also returns `challenge` (base64 of the decrypted nonce).

### Backup

```js
const backup = await send2end('export', { passphrase, keyId })
await send2end('import', { backup, passphrase, kind: 'group', scope: 'global' })
await send2end('clear', { keyId }) // removes one key
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

Look up the wrap for one of the current user’s authorized `keyId`s (or the group key), then:

```js
await send2end(
  'deliver',
  {
    ciphertext,              // base64
    iv,                      // base64
    wrappedDek: wrap.wrapped_dek,
    keyId: wrap.recipient_key_id, // optional
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

## 6. Render encrypted content inline

The extension can replace a placeholder with decrypted text, an image, or a PDF in the same layout position. Other MIME types become a download button. Decrypted bytes stay in the extension content-script world and are rendered inside a **closed shadow root**. No localhost server, disk copy, or plaintext response to page JavaScript is involved.

Serve the AES-GCM ciphertext as raw `application/octet-stream`, then add:

### Image

```html
<img
  data-send2end-image
  data-send2end-src="/api/images/42/ciphertext"
  data-send2end-iv="BASE64_12_BYTE_IV"
  data-send2end-wrapped-dek="BASE64_WRAP_FOR_CURRENT_USER_OR_GROUP_KEY"
  data-send2end-key-id="OPTIONAL_KEY_ID"
  data-send2end-content-type="image/png"
  alt="Encrypted profile image"
  width="640"
  height="360"
/>
```

### Plain text

```html
<div
  data-send2end-inline
  data-send2end-src="/api/messages/42/ciphertext"
  data-send2end-iv="BASE64_12_BYTE_IV"
  data-send2end-wrapped-dek="BASE64_WRAP"
  data-send2end-key-id="OPTIONAL_KEY_ID"
  data-send2end-content-type="text/plain"
  aria-label="Encrypted message"
></div>
```

Text is decoded as UTF-8 and rendered in a `<pre>` inside the closed shadow root, so whitespace and line breaks are preserved.

### PDF

```html
<div
  data-send2end-inline
  data-send2end-src="/api/documents/42/ciphertext"
  data-send2end-iv="BASE64_12_BYTE_IV"
  data-send2end-wrapped-dek="BASE64_WRAP"
  data-send2end-content-type="application/pdf"
  data-send2end-filename="document.pdf"
  style="width: 100%; height: 700px"
></div>
```

PDFs use the browser’s PDF viewer in a closed-shadow iframe.

### Other files

Use the same `data-send2end-inline` markup with the real MIME type and `data-send2end-filename`. Unknown/binary types render a **Download filename** button. Set `data-send2end-mode="download"` to force a download button for text, images, or PDFs too.

`data-send2end-ciphertext-url` is an alias for `data-send2end-src`. For small payloads, the site may provide base64 directly with `data-send2end-ciphertext` instead of a URL.

Requirements:

- The ciphertext URL must be on the **same origin** as the page.
- Fetches include the site’s cookies, use `cache: no-store`, and accept raw binary.
- The URL response body is the raw AES-GCM ciphertext, including its authentication tag—not JSON or base64.
- `data-send2end-wrapped-dek` must be the wrap for a key stored in this browser (personal, site, or group).
- `data-send2end-key-id` is optional; omit it to try every key authorized for this origin.
- `data-send2end-content-type` controls rendering (`text/*`, `image/*`, `application/pdf`, or download).
- Inline payloads are limited to 25 MiB.
- The site must already be connected to sEnd2End.

The original `<img>` is retained but hidden; the extension inserts the closed-shadow renderer next to it. This keeps the decrypted `blob:` URL and image node out of ordinary page DOM access. As with any displayed content, this cannot prevent screenshots or a compromised browser from capturing pixels.

For images, do not put the encrypted endpoint in `src`; use `data-send2end-src` so Chrome does not make a duplicate image request or show a broken-image indicator before decryption.

## 7. Add a recipient later (`wrap`)

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
