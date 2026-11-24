// 端到端逻辑验证：解析 CSV -> 对齐 -> 超限判定（严格复刻 src/core/exceed.ts）
import { readFile, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = join(root, 'public', 'sample-data')
const LIMITS = {
  heightUpperL1: 6500, heightUpperL2: 6650,
  heightLowerL1: 5700, heightLowerL2: 5500,
  staggerAbsL1: 400, staggerAbsL2: 450,
}

const parseCsv = (text) => {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean)
  const header = lines[0].split(',')
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]))
  return lines.slice(1).map((line, i) => {
    const c = line.split(',')
    return {
      seq: i,
      rawMileage: Number(c[idx['原始里程']]),
      heightMm: Number(c[idx['导高']]),
      staggerMm: Number(c[idx['拉出值']]),
      event: c[idx['事件']] || undefined,
      supportCode: c[idx['杆号']] || undefined,
    }
  })
}

const align = (rows, supports) => {
  const map = new Map(supports.map((s) => [s.supportCode, s.mileage]))
  const breakRows = new Set()
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i].rawMileage - rows[i - 1].rawMileage
    if (d < -50 || rows[i - 1].event === 'BREAK' || rows[i].event === 'BREAK') breakRows.add(i)
  }
  const anchors = []
  for (const r of rows) {
    if (r.event !== 'POLE' || !r.supportCode) continue
    const m = map.get(r.supportCode)
    if (m !== undefined) anchors.push({ rowIndex: r.seq, raw: r.rawMileage, offset: m - r.rawMileage })
  }
  const breakIdx = [0, ...[...breakRows].sort((a, b) => a - b), rows.length]
  const offsetAt = (seg, rowIndex) => {
    if (!seg.length) return 0
    if (rowIndex <= seg[0].rowIndex) return seg[0].offset
    if (rowIndex >= seg[seg.length - 1].rowIndex) return seg[seg.length - 1].offset
    for (let i = 0; i < seg.length - 1; i++) {
      if (rowIndex >= seg[i].rowIndex && rowIndex <= seg[i + 1].rowIndex) {
        const t = (rowIndex - seg[i].rowIndex) / (seg[i + 1].rowIndex - seg[i].rowIndex)
        return seg[i].offset + (seg[i + 1].offset - seg[i].offset) * t
      }
    }
    return seg[seg.length - 1].offset
  }
  return rows.map((r, i) => {
    let seg = anchors
    for (let s = 0; s < breakIdx.length - 1; s++) {
      if (i >= breakIdx[s] && i < breakIdx[s + 1]) {
        seg = anchors.filter((x) => x.rowIndex >= breakIdx[s] && x.rowIndex < breakIdx[s + 1])
        break
      }
    }
    return { mileage: r.rawMileage + offsetAt(seg, i), heightMm: r.heightMm, staggerMm: r.staggerMm }
  })
}

// 与 src/core/exceed.ts 同构
const judge = (h, st) => {
  const out = []
  if (h >= LIMITS.heightUpperL2) out.push({ metric: 'height', level: 2, value: h, upward: true })
  else if (h >= LIMITS.heightUpperL1) out.push({ metric: 'height', level: 1, value: h, upward: true })
  else if (h <= LIMITS.heightLowerL2) out.push({ metric: 'height', level: 2, value: h, upward: false })
  else if (h <= LIMITS.heightLowerL1) out.push({ metric: 'height', level: 1, value: h, upward: false })
  const abs = Math.abs(st)
  if (abs >= LIMITS.staggerAbsL2) out.push({ metric: 'stagger', level: 2, value: st, upward: true })
  else if (abs >= LIMITS.staggerAbsL1) out.push({ metric: 'stagger', level: 1, value: st, upward: true })
  return out
}

const detect = (samples) => {
  const result = []
  const open = { height: null, stagger: null }
  const close = (metric, endIdx) => {
    const seg = open[metric]
    if (!seg) return
    result.push({ metric, ...seg, endMileage: samples[endIdx].mileage })
    open[metric] = null
  }
  samples.forEach((s, idx) => {
    const violations = judge(s.heightMm, s.staggerMm)
    for (const metric of ['height', 'stagger']) {
      const v = violations.find((x) => x.metric === metric)
      const seg = open[metric]
      if (!v) {
        if (seg) close(metric, idx - 1)
        continue
      }
      if (!seg) {
        open[metric] = { startIdx: idx, maxIdx: idx, mileage: s.mileage, level: v.level, value: v.value, upward: v.upward }
      } else {
        const worse = metric === 'stagger'
          ? Math.abs(v.value) > Math.abs(seg.value)
          : seg.upward ? v.value > seg.value : v.value < seg.value
        if (worse) Object.assign(seg, { maxIdx: idx, mileage: s.mileage, value: v.value })
        seg.level = Math.max(seg.level, v.level)
      }
    }
  })
  close('height', samples.length - 1)
  close('stagger', samples.length - 1)
  return result
}

const main = async () => {
  const archive = JSON.parse(await readFile(join(dataDir, 'line_archive.json'), 'utf8'))
  const files = (await readdir(dataDir)).filter((f) => f.endsWith('.csv')).sort()
  let total = 0
  for (const f of files) {
    const trackNo = Number(f.match(/track(\d)/)[1])
    const rows = parseCsv(await readFile(join(dataDir, f), 'utf8'))
    const samples = align(rows, archive.supports.filter((s) => s.trackNo === trackNo))
    const points = detect(samples)
    total += points.length
    const l1 = points.filter((p) => p.level === 1).length
    const l2 = points.filter((p) => p.level === 2).length
    const detail = points
      .map((p) => `${p.metric === 'height' ? 'H' : 'S'}${p.level}@${p.mileage.toFixed(0)}=${p.value.toFixed(0)}`)
      .join('  ')
    console.log(`${f}  超限区段 ${points.length} 个（一级 ${l1} / 二级 ${l2}）`)
    console.log(`   ${detail}`)
  }
  console.log(`\n共检出 ${total} 个超限区段`)
}
main()
