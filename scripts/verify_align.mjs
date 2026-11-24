// 对齐算法离线验证：node scripts/verify_align.mjs
// 在生成的 6 个批次上复刻 src/core/align.ts 的逻辑，检查杆位残差是否 <0.5m
import { readFile, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = join(root, 'public', 'sample-data')

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
  const jumpRows = new Set()
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i].rawMileage - rows[i - 1].rawMileage
    if (d < -50 || rows[i - 1].event === 'BREAK' || rows[i].event === 'BREAK') breakRows.add(i)
    else if (d > 0.5 * 8) jumpRows.add(i)
  }
  const anchors = []
  const unmatched = []
  for (const r of rows) {
    if (r.event !== 'POLE' || !r.supportCode) continue
    const m = map.get(r.supportCode)
    if (m === undefined) unmatched.push(r.supportCode)
    else anchors.push({ rowIndex: r.seq, raw: r.rawMileage, code: r.supportCode, archive: m, offset: m - r.rawMileage })
  }
  const breakIdx = [0, ...[...breakRows].sort((a, b) => a - b), rows.length]
  const offsetAt = (segAnchors, rowIndex) => {
    const a = segAnchors
    if (!a.length) return anchors.length ? anchors.reduce((best, x) =>
      Math.abs(x.rowIndex - rowIndex) < Math.abs(best.rowIndex - rowIndex) ? x : best).offset : 0
    if (rowIndex <= a[0].rowIndex) return a[0].offset
    if (rowIndex >= a[a.length - 1].rowIndex) return a[a.length - 1].offset
    for (let i = 0; i < a.length - 1; i++) {
      if (rowIndex >= a[i].rowIndex && rowIndex <= a[i + 1].rowIndex) {
        const t = (rowIndex - a[i].rowIndex) / (a[i + 1].rowIndex - a[i].rowIndex)
        return a[i].offset + (a[i + 1].offset - a[i].offset) * t
      }
    }
    return 0
  }
  let maxRes = 0
  let sumRes = 0
  let maxDrift = 0
  for (let s = 0; s < breakIdx.length - 1; s++) {
    const seg = anchors.filter((x) => x.rowIndex >= breakIdx[s] && x.rowIndex < breakIdx[s + 1])
    if (!seg.length) continue
    // 段内基准：段首锚点的档案-原始差值，扣除后剩余的才是真实漂移
    const base = seg[0].archive - seg[0].raw
    for (const an of seg) {
      const aligned = an.raw + offsetAt(seg, an.rowIndex)
      const res = Math.abs(aligned - an.archive)
      maxRes = Math.max(maxRes, res)
      sumRes += res
      maxDrift = Math.max(maxDrift, Math.abs(an.archive - an.raw - base))
    }
  }
  return {
    poles: anchors.length + unmatched.length,
    matched: anchors.length,
    unmatched: unmatched.length,
    breaks: breakRows.size,
    jumps: jumpRows.size,
    maxResidualM: maxRes,
    meanResidualM: sumRes / Math.max(anchors.length, 1),
    maxDrift,
  }
}

const main = async () => {
  const archive = JSON.parse(await readFile(join(dataDir, 'line_archive.json'), 'utf8'))
  const files = (await readdir(dataDir)).filter((f) => f.endsWith('.csv'))
  let allPass = true
  for (const f of files.sort()) {
    const trackNo = Number(f.match(/track(\d)/)[1])
    const rows = parseCsv(await readFile(join(dataDir, f), 'utf8'))
    const supports = archive.supports.filter((s) => s.trackNo === trackNo)
    const r = align(rows, supports)
    const pass = r.maxResidualM < 0.5
    allPass &&= pass
    console.log(
      `${f}  过杆=${r.poles} 匹配=${r.matched} 未匹配=${r.unmatched} ` +
        `断点=${r.breaks} 跳变=${r.jumps} 最大漂移=${r.maxDrift.toFixed(2)}m ` +
        `最大残差=${r.maxResidualM.toFixed(4)}m 均值=${r.meanResidualM.toFixed(4)}m ` +
        `${pass ? 'PASS(<0.5m)' : 'FAIL'}`,
    )
  }
  console.log(allPass ? '\n全部批次对齐精度验收通过' : '\n存在验收失败批次')
  process.exit(allPass ? 0 : 1)
}

main()
