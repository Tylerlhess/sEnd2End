/**
 * Pack the sEnd2End extension for:
 *   - site: sideload zip (optional local hosts) for Load unpacked
 *   - store: Chrome Web Store zip (no seeded hosts; users Connect each origin)
 *
 * Usage:
 *   node scripts/pack.mjs [--target site|store|all] [--site-out <dir>]
 */
import { crc32 } from 'node:zlib'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(readFileSync(join(root, 'extension.config.json'), 'utf8'))

function parseArgs(argv) {
  let target = 'all'
  let siteOut = join(root, 'dist', 'site')
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--target') target = argv[++i] || target
    else if (arg === '--site-out') siteOut = argv[++i] || siteOut
  }
  if (!['site', 'store', 'all'].includes(target)) {
    throw new Error(`Unknown --target ${target}. Use site, store, or all.`)
  }
  return { target, siteOut }
}

function dosDateTime(date) {
  const year = Math.max(date.getFullYear() - 1980, 0)
  const dosDate = (year << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  return { dosDate, dosTime }
}

function zipStore(entries, date = new Date()) {
  const { dosDate, dosTime } = dosDateTime(date)
  const locals = []
  const centrals = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = entry.data
    const crc = crc32(data) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    const localFile = Buffer.concat([local, name, data])
    locals.push(localFile)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(dosTime, 12)
    central.writeUInt16LE(dosDate, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(Buffer.concat([central, name]))
    offset += localFile.length
  }

  const localBlob = Buffer.concat(locals)
  const centralBlob = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBlob.length, 12)
  end.writeUInt32LE(localBlob.length, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([localBlob, centralBlob, end])
}

function ensureIcons() {
  const icon16 = join(root, config.icons['16'])
  if (existsSync(icon16)) return
  const script = join(root, 'scripts', 'write-icons.mjs')
  const result = spawnSync(process.execPath, [script], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error('Failed to generate extension icons')
}

function buildManifest(kind) {
  const seedHosts = config.seed_hosts?.[kind] || []
  const manifest = {
    manifest_version: 3,
    name: config.name,
    short_name: config.short_name,
    version: config.version,
    description: config.description,
    author: config.author,
    icons: config.icons,
    permissions: config.permissions,
    optional_host_permissions: config.optional_host_permissions,
    background: {
      service_worker: 'background.js',
      type: 'module',
    },
    content_scripts: [
      {
        matches: config.content_matches,
        js: ['content.js'],
        run_at: 'document_start',
      },
    ],
    options_page: 'options.html',
    action: {
      default_title: 'sEnd2End',
      default_popup: 'popup.html',
      default_icon: {
        '16': config.icons['16'],
        '48': config.icons['48'],
      },
    },
  }
  if (config.homepage_url) {
    manifest.homepage_url = config.homepage_url
  }
  if (seedHosts.length > 0) {
    manifest.host_permissions = seedHosts
  }
  return manifest
}

function writeSeedFile(kind) {
  const origins = config.seed_origins?.[kind] || []
  const path = join(root, 'seed-sites.json')
  writeFileSync(path, `${JSON.stringify({ origins, web_store_url: config.web_store_url || '' }, null, 2)}\n`)
  return path
}

function collectFiles(manifest) {
  const files = new Map()
  files.set('manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'))
  for (const file of config.files) {
    const from = join(root, file)
    if (!existsSync(from)) throw new Error(`Missing extension file: ${file}`)
    files.set(file.replace(/\\/g, '/'), readFileSync(from))
  }
  for (const rel of Object.values(config.icons)) {
    const from = join(root, rel)
    if (!existsSync(from)) throw new Error(`Missing icon: ${rel}`)
    files.set(rel.replace(/\\/g, '/'), readFileSync(from))
  }
  return files
}

function writeTree(dir, files) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  for (const [rel, data] of files) {
    const dest = join(dir, rel)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, data)
  }
}

function packSite(siteOut) {
  writeSeedFile('site')
  const files = collectFiles(buildManifest('site'))
  const folderName = config.package_slug || 'send2end'
  const dir = join(siteOut, folderName)
  writeTree(dir, files)

  // Keep a root-level manifest for Load unpacked from this repo during local dev.
  writeFileSync(join(root, 'manifest.json'), files.get('manifest.json'))

  const zipEntries = [...files.entries()].map(([name, data]) => ({
    name: `${folderName}/${name}`,
    data,
  }))
  const zipPath = join(siteOut, `${folderName}.zip`)
  writeFileSync(zipPath, zipStore(zipEntries))
  console.log(`Site pack -> ${dir}`)
  console.log(`Site zip  -> ${zipPath}`)
  return { dir, zipPath }
}

function packStore() {
  writeSeedFile('store')
  const files = collectFiles(buildManifest('store'))
  const dir = join(root, 'dist', 'store')
  writeTree(dir, files)
  const zipEntries = [...files.entries()].map(([name, data]) => ({ name, data }))
  const slug = config.package_slug || 'send2end'
  const zipPath = join(root, 'dist', `${slug}-chrome-web-store.zip`)
  writeFileSync(zipPath, zipStore(zipEntries))
  console.log(`Store pack -> ${dir}`)
  console.log(`Store zip  -> ${zipPath}`)
  return { dir, zipPath }
}

ensureIcons()
const { target, siteOut } = parseArgs(process.argv.slice(2))
mkdirSync(join(root, 'dist'), { recursive: true })

if (target === 'site' || target === 'all') packSite(siteOut)
if (target === 'store' || target === 'all') packStore()
