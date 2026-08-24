# Notes for Chrome Web Store reviewers

**Single purpose:** On-device end-to-end encryption (sEnd2End). Users connect sites they trust; private keys stay local.

**How to test**

1. Install this package.
2. Open any https site you control.
3. Click the sEnd2End toolbar icon → **Connect this site**, or use the page’s Connect button.
4. Open the site’s encryption / keys UI. Status should show the plugin as active.
5. Generate a key, export a passphrase backup, clear the key, import the backup.
6. Encrypt a small file through the site, then decrypt & view or download it.

**Permissions**

- `storage` — local RSA key material and connected-site list.
- `activeTab` / `scripting` — connect the current tab after the user clicks Connect.
- Optional host permissions `http(s)://*/*` — granted per origin when the user connects a site.

**Privacy**

- No analytics, ads, or remote logging from the extension.
- Private keys never leave the device except as a user-triggered passphrase backup file.
- Privacy policy: host `store/privacy-policy.md` at a public HTTPS URL and paste that URL here.

**Remote code**

- None. All scripts ship inside the package.
