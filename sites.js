/** Connected-site allowlist (origins) for sEnd2End. */

export const SITES_KEY = 'send2endSites'

export function originPattern(origin) {
  return `${origin}/*`
}

export function patternsForOrigin(origin) {
  const patterns = [originPattern(origin)]
  try {
    const url = new URL(origin)
    if (url.hostname === '127.0.0.1') {
      patterns.push('http://127.0.0.1:*/*')
    }
  } catch {
    /* ignore */
  }
  return [...new Set(patterns)]
}

export async function listSites() {
  const data = await chrome.storage.local.get(SITES_KEY)
  const sites = data[SITES_KEY]
  return Array.isArray(sites) ? sites : []
}

export async function isSiteAllowed(origin) {
  if (!origin || origin === 'null') return false
  const sites = await listSites()
  return sites.includes(origin)
}

export async function addSite(origin) {
  if (!origin || origin === 'null') throw new Error('Invalid origin')
  const sites = await listSites()
  if (!sites.includes(origin)) {
    sites.push(origin)
    sites.sort()
    await chrome.storage.local.set({ [SITES_KEY]: sites })
  }
  return sites
}

export async function removeSite(origin) {
  const sites = (await listSites()).filter((item) => item !== origin)
  await chrome.storage.local.set({ [SITES_KEY]: sites })
  return sites
}

export async function ensureSeedSites(seedOrigins) {
  if (!Array.isArray(seedOrigins) || seedOrigins.length === 0) return listSites()
  const sites = await listSites()
  let changed = false
  for (const origin of seedOrigins) {
    if (origin && !sites.includes(origin)) {
      sites.push(origin)
      changed = true
    }
  }
  if (changed) {
    sites.sort()
    await chrome.storage.local.set({ [SITES_KEY]: sites })
  }
  return sites
}
