# Chrome Web Store listing copy

Use these fields in the Developer Dashboard. Keep the **single purpose** clear: on-device end-to-end encryption for sites you allow.

## Name

sEnd2End

## Summary (132 characters max)

End-to-end encryption on your device. Keys stay local while allowed sites encrypt files, messages, and other data.

## Description

sEnd2End holds your RSA private key on this device and performs encrypt and decrypt for sites that integrate with it.

The name emphasizes **End2End**: ciphertext can move through servers; your private key does not.

**What it does**

- Generates an RSA-OAEP 4096-bit key pair in the extension
- Publishes only the public key through the connected site (you stay signed in there)
- Encrypts data with AES-256-GCM; wraps the data key to people you select
- Decrypts ciphertext inside the extension for view or download so page JavaScript does not receive plaintext on the preferred path
- Lets you export and import a passphrase-protected key backup
- Works for files, messages, and other client-side encrypted payloads sites choose to support

**What it does not do**

- It does not send your private key to a remote server
- It does not run on unrelated websites until you connect them
- It does not replace your account login on those sites

**Who should install**

Anyone who needs on-device end-to-end encryption with a connected web app.

**Setup**

1. Install sEnd2End from the Chrome Web Store.
2. Open a site that integrates sEnd2End and click **Connect sEnd2End** (or use the toolbar popup).
3. Generate a key and download a passphrase backup. Store the backup offline.
4. Use the site’s encrypt UI when data must stay ciphertext on the server.

Lab and air-gapped installs can still use the sideload zip (Load unpacked).

## Category

Productivity (or Privacy & Security if available in your region).

## Language

English

## Official URL

Set this to your public GitHub repository or product homepage after it exists.

## Support URL

Use the same repository Issues page, or your support email.

## Privacy policy URL

Host [privacy-policy.md](privacy-policy.md) at a public HTTPS URL and paste that URL here.

## Screenshots (you capture)

Minimum 1; recommended 3:

1. Extension options page showing a key fingerprint (sEnd2End branding)
2. A connected site’s keys or encrypt UI with the plugin active
3. Encrypt-in-browser enabled on a sample upload

Size: 1280×800 or 640×400 PNG/JPEG.

## Promo tile / marquee

Optional. Use the 128×128 icon from `icons/icon128.png` as a starting point.
