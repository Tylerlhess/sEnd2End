# Chrome Web Store — submission checklist

This package builds a **store** zip ready for Chrome Web Store upload, separate from the site sideload zip.

**Product name:** sEnd2End

## Build the store package

```bash
cd /path/to/sEnd2End
npm run pack:store
```

Artifacts:

| Path | Use |
|------|-----|
| `dist/send2end-chrome-web-store.zip` | Upload to Chrome Web Store Developer Dashboard |
| `dist/store/` | Unpacked copy for local review before upload |

The store zip has files at the **root** (manifest at top level). Do not nest them in a folder.

Site / sideload is separate:

```bash
npm run pack:site
```

That build may include `http://127.0.0.1` for local work. The **store** build seeds no production hosts; users Connect each origin.

## Before first upload

1. Create a [Chrome Web Store developer account](https://chrome.google.com/webstore/devconsole) ($5 one-time).
2. Privacy policy URL (required): https://tylerlhess.github.io/sEnd2End/privacy.html
3. Prepare store listing screenshots (1280×800 or 640×400): options page with a key fingerprint, a connected site’s crypto UI, encrypt-in-browser on a sample upload. See [listing.md](listing.md).
4. Fill the dashboard from [listing.md](listing.md) and attach [REVIEWER_NOTES.md](REVIEWER_NOTES.md) in the “Notes for reviewers” field (or paste the short version).
5. Set distribution: **Unlisted**, **Private**, or **Public**.
6. Upload `dist/send2end-chrome-web-store.zip`.
7. Complete the privacy practices form: extension stores encryption key material **locally** only; no remote collection; no selling data; single purpose = on-device end-to-end encryption for allowed sites.

## Version bumps

Edit `extension.config.json` → `version`, then:

```bash
npm run pack
```

Chrome Web Store requires each upload to use a **higher** version than the live listing. Keep `package.json` version in sync.

## After publish

1. Note the Web Store item ID (from the dashboard URL).
2. Optionally add `"update_url"` is **not** needed for CWS-hosted updates; Google pushes updates.
3. Update connected sites to prefer “Install from Chrome Web Store” when you have a public/unlisted link, and keep the zip as fallback for Edge / air-gapped installs.
4. For Edge Add-ons, you can submit the same MV3 zip to the Microsoft Partner Center.

## Review tips

- Single purpose: on-device keys and end-to-end encrypt/decrypt for allowed origins.
- No remote code, no analytics, no `eval`.
- Host permissions are optional and granted per origin when the user connects a site.
- Keys never leave the device except as a user-exported passphrase backup file.
