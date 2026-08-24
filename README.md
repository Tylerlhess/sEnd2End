# sEnd2End

[![License: PolyForm Perimeter](https://img.shields.io/badge/License-PolyForm%20Perimeter-teal.svg)](LICENSE)

**sEnd2End** — on-device **end-to-end** encryption for the web.  
Chrome / Edge (Chromium) Manifest V3 extension.

Keys stay on the device. Connected sites store ciphertext and public keys only. Use it for encrypted files, messages, and other client-side payloads.

Source is available under the [PolyForm Perimeter License 1.0.0](LICENSE). You may use, modify, and redistribute it for any purpose except offering a competing product. Commercial rights for competing uses stay with Tyler Hess.

## Features

- RSA-OAEP 4096-bit user keys held in extension storage
- AES-256-GCM payload encryption; per-recipient wrapped data keys
- Preferred decrypt path keeps plaintext out of page JavaScript
- Multiple keys: personal, per-site, and shared group keys
- Public-key possession proofs (`prove`) so a site can confirm the browser holds advertised keys
- Inline decryption for text, images, and PDFs; download controls for other files
- Passphrase-protected key backup import/export
- Dark, self-contained UI: popup, options page, and in-page prompts share `ui.css`
- Site pack (lab hosts) and Chrome Web Store pack (no seeded production hosts)

Icons are generated, not checked in by hand: `npm run icons` rewrites `icons/icon{16,48,128}.png` from `scripts/write-icons.mjs`. `icons/logo.svg` is the same mark for extension pages and docs.

## Quick start (developers)

```bash
npm run pack:site
```

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable Developer mode → **Load unpacked** → select this repo root (or `dist/site/send2end`).
3. Open a connected site and use its encryption / keys UI.

## Builds

| Command | Output | Hosts |
|---------|--------|--------|
| `npm run pack:site` | `dist/site/send2end.zip` | `127.0.0.1` (local sideload) |
| `npm run pack:store` | `dist/send2end-chrome-web-store.zip` | None seeded; users Connect each origin |
| `npm run pack` | Both | — |

Chrome Web Store checklist: [store/CHROME_WEB_STORE.md](store/CHROME_WEB_STORE.md).

## Enable on your site

Users connect each origin they trust. The Chrome Web Store build has no hardcoded site allowlist.

**Full instruction set:** [INTEGRATING.md](INTEGRATING.md) — Connect SDK, key publish, encrypt/deliver payloads, what to store on the server, and a troubleshooting table.

Short path:

1. Ship `sdk/send2end-connect.js` from this repo on your origin.
2. Add **Connect sEnd2End**; the user Allows your origin.
3. Generate a key, **never** send `privateKeyPkcs8` to your backend — store `publicKeySpki`, `keyId`, fingerprint.
4. Encrypt with recipient public keys; persist ciphertext, IV, and per-recipient wraps.
5. Open files with `deliver` so plaintext stays in the extension.

Page bridge: `SEND2END_PING` / `SEND2END_CONNECT` / `SEND2END_REQUEST` / `SEND2END_REPLY`.  
Ops: `status`, `generate`, `import`, `export`, `clear`, `encrypt`, `decrypt`, `deliver`, `wrap`.  
Optional lab seed hosts: `extension.config.json`.

## Threat model

The extension is the preferred crypto boundary. Preferred decrypt paths keep plaintext out of page JavaScript. Sites may also offer an in-page fallback. Treat install plus key backup as operator procedure, not a substitute for trusted app deploys.

## Contributing

Issues and pull requests are welcome. Keep host allowlists tight. Do not add analytics or remote code loading. Contributions are accepted under the same license.

## Privacy

https://tylerlhess.github.io/sEnd2End/privacy.html

## License

[PolyForm Perimeter 1.0.0](LICENSE) © Tyler Hess

Use, modification, and redistribution are permitted except to provide others a product that competes with sEnd2End. Competing commercial use requires a separate license from the copyright holder.
