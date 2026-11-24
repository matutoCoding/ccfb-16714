// 检测车 CSV 解析与批次导入管线
// 表头兼容中英文：序号/seq、里程/mileage、导高/height、拉出/stagger、事件/event、杆号/support

import type {
  InspectionBatch,
  LineArchive,
  RawCsvRow,
  TrackNo,
} from '@/types'
import { alignBatch } from '@/core/align'
import { detectExceeds } from '@/core/exceed'
import { loadSettings, putBatch, putExceeds, saveSamples } from '@/db/idb'
import { uid } from '@/utils/format'

const HEADER_ALIAS: Record<string, keyof RawCsvRow | 'event' | 'supportCode'> = {
  seq: 'seq',
  序号: 'seq',
  mileage: 'rawMileage',
  里程: 'rawMileage',
  原始里程: 'rawMileage',
  height: 'heightMm',
  导高: 'heightMm',
  接触线高度: 'heightMm',
  stagger: 'staggerMm',
  拉出值: 'staggerMm',
  拉出: 'staggerMm',
  event: 'event',
  事件: 'event',
  support: 'supportCode',
  杆号: 'supportCode',
  支柱号: 'supportCode',
}

const parseLine = (line: string): string[] => {
  const cells: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') {
        quoted = false
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      cells.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur)
  return cells
}

export const parseCsv = (text: string): RawCsvRow[] => {
  const clean = text.replace(/^﻿/, '')
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) throw new Error('CSV 内容为空或缺少数据行')

  const headers = parseLine(lines[0]).map((h) => h.trim().toLowerCase())
  const colIdx = headers.map((h) => HEADER_ALIAS[h])
  const required = ['seq', 'rawMileage', 'heightMm', 'staggerMm']
  for (const key of required) {
    if (!colIdx.includes(key as keyof RawCsvRow)) {
      throw new Error(`CSV 缺少必需列：${key}（表头：${headers.join(', ')}）`)
    }
  }

  const rows: RawCsvRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i])
    const row: RawCsvRow = {
      seq: i - 1,
      rawMileage: 0,
      heightMm: 0,
      staggerMm: 0,
    }
    let valid = true
    colIdx.forEach((key, col) => {
      if (!key) return
      const val = cells[col]?.trim() ?? ''
      if (key === 'event' || key === 'supportCode') {
        ;(row as Record<string, unknown>)[key] = val || undefined
      } else {
        const num = Number(val)
        if (Number.isNaN(num)) valid = false
        ;(row as Record<string, number>)[key] = num
      }
    })
    if (valid) rows.push(row)
  }
  return rows
}

export interface ImportMeta {
  name: string
  inspectDate: string
  trackNo: TrackNo
  driftModel?: string
}

export const importCsvBatch = async (
  text: string,
  meta: ImportMeta,
  archive: LineArchive,
): Promise<InspectionBatch> => {
  const rows = parseCsv(text)
  const batchId = uid('batch')
  const trackSupports = archive.supports.filter((s) => s.trackNo === meta.trackNo)

  const { samples, report } = alignBatch(batchId, rows, trackSupports)
  const settings = await loadSettings()
  const exceeds = detectExceeds(
    batchId,
    meta.trackNo,
    samples,
    trackSupports,
    settings.limits,
  )

  const batch: InspectionBatch = {
    id: batchId,
    name: meta.name,
    inspectDate: meta.inspectDate,
    trackNo: meta.trackNo,
    importedAt: Date.now(),
    sampleCount: samples.length,
    rawStartMileage: rows[0].rawMileage,
    rawEndMileage: rows[rows.length - 1].rawMileage,
    alignedStartMileage: samples[0].mileage,
    alignedEndMileage: samples[samples.length - 1].mileage,
    driftMaxM: report.driftMaxM,
    driftModel: meta.driftModel ?? 'unknown',
    alignmentReport: { ...report, batchId },
    exceedCounts: {
      level1: exceeds.filter((e) => e.level === 1).length,
      level2: exceeds.filter((e) => e.level === 2).length,
    },
    verifiedFixed: 0,
  }

  await saveSamples(samples)
  await putBatch(batch)
  await putExceeds(exceeds)
  return batch
}
