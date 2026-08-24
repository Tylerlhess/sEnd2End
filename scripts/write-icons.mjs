/**
 * Write the sEnd2End PNG icons for Manifest V3 / Chrome Web Store (no image deps).
 *
 * Mark: rounded teal tile, diagonal gradient, white padlock with a cut-out keyhole.
 * Shapes are evaluated in a 128x128 design space and supersampled so the 16px
 * toolbar icon stays readable instead of aliasing into mush.
 */
import { deflateSync, crc32 } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'icons')

const DESIGN = 128
const SAMPLES = 4

const TILE_TOP = [45, 212, 191]
const TILE_BOTTOM = [13, 108, 100]
const GLYPH = [248, 250, 252]

const TILE = { x0: 3, y0: 3, x1: 125, y1: 125, r: 30 }
const BODY = { x0: 34, y0: 58, x1: 94, y1: 106, r: 13 }
const SHACKLE = { cx: 64, cy: 56, rOuter: 24, rInner: 15, leg: 8 }
const KEYHOLE = { cx: 64, cy: 78, r: 7.5, stemBottom: 96, stemTop: 3, stemFlare: 3.5 }

function insideRoundedRect(x, y, rect) {
  const halfW = (rect.x1 - rect.x0) / 2
  const halfH = (rect.y1 - rect.y0) / 2
  const cx = rect.x0 + halfW
  const cy = rect.y0 + halfH
  const dx = Math.abs(x - cx) - (halfW - rect.r)
  const dy = Math.abs(y - cy) - (halfH - rect.r)
  const outX = Math.max(dx, 0)
  const outY = Math.max(dy, 0)
  return Math.hypot(outX, outY) - rect.r <= 0
}

function insideShackle(x, y) {
  const dist = Math.hypot(x - SHACKLE.cx, y - SHACKLE.cy)
  if (dist > SHACKLE.rOuter || dist < SHACKLE.rInner) return false
  return y <= SHACKLE.cy + SHACKLE.leg
}

function insideKeyhole(x, y) {
  if (Math.hypot(x - KEYHOLE.cx, y - KEYHOLE.cy) <= KEYHOLE.r) return true
  if (y < KEYHOLE.cy || y > KEYHOLE.stemBottom) return false
  const t = (y - KEYHOLE.cy) / (KEYHOLE.stemBottom - KEYHOLE.cy)
  return Math.abs(x - KEYHOLE.cx) <= KEYHOLE.stemTop + t * KEYHOLE.stemFlare
}

function tileColor(x, y) {
  const t = Math.min(Math.max((x / DESIGN) * 0.35 + (y / DESIGN) * 0.65, 0), 1)
  return [
    Math.round(TILE_TOP[0] + (TILE_BOTTOM[0] - TILE_TOP[0]) * t),
    Math.round(TILE_TOP[1] + (TILE_BOTTOM[1] - TILE_TOP[1]) * t),
    Math.round(TILE_TOP[2] + (TILE_BOTTOM[2] - TILE_TOP[2]) * t),
  ]
}

function samplePixel(size, px, py) {
  const scale = DESIGN / size
  const step = scale / SAMPLES
  let covered = 0
  let total = 0
  let r = 0
  let g = 0
  let b = 0

  for (let sy = 0; sy < SAMPLES; sy += 1) {
    for (let sx = 0; sx < SAMPLES; sx += 1) {
      total += 1
      const x = (px + (sx + 0.5) / SAMPLES) * scale
      const y = (py + (sy + 0.5) / SAMPLES) * scale
      if (!insideRoundedRect(x, y, TILE)) continue
      covered += 1
      const onGlyph =
        (insideRoundedRect(x, y, BODY) || insideShackle(x, y)) && !insideKeyhole(x, y)
      const [cr, cg, cb] = onGlyph ? GLYPH : tileColor(x, y)
      r += cr
      g += cg
      b += cb
    }
  }

  if (covered === 0) return [0, 0, 0, 0]
  return [
    Math.round(r / covered),
    Math.round(g / covered),
    Math.round(b / covered),
    Math.round((covered / total) * 255),
  ]
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0, 0)
  return Buffer.concat([len, body, crc])
}

function encodePng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = samplePixel(size, x, y)
      const i = row + 1 + x * 4
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
      raw[i + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(outDir, { recursive: true })
for (const size of [16, 48, 128]) {
  const path = join(outDir, `icon${size}.png`)
  writeFileSync(path, encodePng(size))
  console.log(`Wrote ${path}`)
}
