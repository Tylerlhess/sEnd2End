# Privacy policy — sEnd2End

**Last updated:** 2026-08-24

This privacy policy applies to the **sEnd2End** browser extension (Chrome / Edge, Manifest V3).

## What the extension does

sEnd2End holds your RSA private key on this device and encrypts or decrypts data for websites you connect. Crypto runs inside the extension. Those servers store ciphertext and public keys only. They do not receive your private key.

Use cases include encrypted files, messages, and other client-side encrypted payloads.

## Data stored on your device

The extension may store in Chrome’s local extension storage:

- Your RSA key pair (public and private halves)
- Key id and fingerprint metadata
- Origins you have connected

That data stays on your device. The extension does not sync it to our servers.

## Data you export

If you use **Download backup**, the extension writes an encrypted backup file to a location you choose. That file is protected by the passphrase you enter. We do not receive that file unless you send it yourself.

## Data we collect

The extension does **not**:

- Send analytics or telemetry
- Sell or share personal data
- Read browsing history outside origins you connect
- Inject scripts on other websites until you allow that origin

The Chrome Web Store build does not pre-grant any production site. You connect each origin. Lab sideload builds may pre-allow `http://127.0.0.1` for local testing.

## How connected sites use the extension

When you are signed in to a connected site, the page may ask the extension to:

- Report whether a key is present
- Generate, import, or export a key (export needs your passphrase)
- Encrypt bytes before upload or send
- Decrypt ciphertext for view or download inside the extension UI

The page does not receive plaintext after a plugin-delivered decrypt.

## Contact

For privacy questions about this extension, use the address published with your Chrome Web Store listing, or the support URL on the project repository.

## Changes

We may update this policy when the extension’s data practices change. The “Last updated” date at the top will change when we do.
