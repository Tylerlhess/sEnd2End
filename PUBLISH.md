# Publish sEnd2End as a public GitHub repo

Local git is ready on `main`. GitHub CLI is installed; you still need to log in once.

## 1. Log in

```powershell
gh auth login
```

Choose GitHub.com → HTTPS → login with browser (or token).

## 2. Create the public repo and push

From this directory:

```powershell
# Personal account:
gh repo create sEnd2End --public --source=. --remote=origin --push

# Or under an org (replace ORG):
gh repo create ORG/sEnd2End --public --source=. --remote=origin --push
```

## 3. After the URL exists

Add to `package.json`:

```json
"repository": {
  "type": "git",
  "url": "https://github.com/ORG/sEnd2End.git"
},
"bugs": { "url": "https://github.com/ORG/sEnd2End/issues" },
"homepage": "https://github.com/ORG/sEnd2End#readme"
```

Then set `homepage_url` in `extension.config.json` to that repo (or your product site), pack, commit, and push. Point the Chrome Web Store listing “official URL” / support at the same place if you want.
