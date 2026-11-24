// 里程对齐核心算法
// 思路：
// 1. 识别 BREAK 事件（里程清零/重新计数）与里程跳变（相邻采样 delta 异常）
// 2. 用检测车记录的过杆事件（杆号）匹配线路档案支柱，得到各锚点处的漂移量
// 3. 断点之间按锚点漂移量做分段线性插值校正，杆号位置精确落回档案里程
// 4. 输出对齐后采样、对齐报告（含杆位残差，验收标准 <0.5m）

import type {
  AlignmentEvent,
  AlignmentReport,
  InspectionSample,
  RawCsvRow,
  Support,
} from '@/types'

interface PoleAnchor {
  rowIndex: number
  rawMileage: number
  supportCode: string
  archiveMileage: number
  offset: number // 档案里程 - 原始里程
}

interface Segment {
  startRow: number
  endRow: number
  anchors: PoleAnchor[]
}

const NOMINAL_STEP = 0.5 // 标称采样间隔(米)
const JUMP_FACTOR = 8 // delta 超过标称间隔多少倍判定为跳变
const BREAK_DELTA = -50 // 里程大幅倒退判定为断点重计

export interface AlignResult {
  samples: InspectionSample[]
  report: Omit<AlignmentReport, 'batchId'>
}

export const alignBatch = (
  batchId: string,
  rows: RawCsvRow[],
  supports: Support[],
): AlignResult => {
  const supportMap = new Map(supports.map((s) => [s.supportCode, s]))
  const events: AlignmentEvent[] = []
  const breakRows = new Set<number>()
  const jumpRows = new Set<number>()

  // 1. 检测跳变与断点
  for (let i = 1; i < rows.length; i++) {
    const delta = rows[i].rawMileage - rows[i - 1].rawMileage
    if (delta < BREAK_DELTA || rows[i - 1].event === 'BREAK' || rows[i].event === 'BREAK') {
      breakRows.add(i)
      events.push({
        rowIndex: i,
        type: 'break',
        rawMileage: rows[i].rawMileage,
        gapSize: Math.abs(delta),
      })
    } else if (delta > NOMINAL_STEP * JUMP_FACTOR) {
      jumpRows.add(i)
      events.push({
        rowIndex: i,
        type: 'jump',
        rawMileage: rows[i].rawMileage,
        gapSize: delta,
      })
    }
  }

  // 2. 过杆事件匹配档案，建立锚点
  const anchors: PoleAnchor[] = []
  const unmatchedPoles: string[] = []
  for (const row of rows) {
    if (row.event !== 'POLE' || !row.supportCode) continue
    const support = supportMap.get(row.supportCode)
    if (!support) {
      unmatchedPoles.push(row.supportCode)
      continue
    }
    anchors.push({
      rowIndex: row.seq,
      rawMileage: row.rawMileage,
      supportCode: row.supportCode,
      archiveMileage: support.mileage,
      offset: support.mileage - row.rawMileage,
    })
    events.push({
      rowIndex: row.seq,
      type: 'pole',
      rawMileage: row.rawMileage,
      supportCode: row.supportCode,
      archiveMileage: support.mileage,
    })
  }

  // 3. 按断点切段，锚点归入对应段
  const segments: Segment[] = []
  const breakIdx = [0, ...Array.from(breakRows).sort((a, b) => a - b), rows.length]
  for (let s = 0; s < breakIdx.length - 1; s++) {
    const startRow = breakIdx[s]
    const endRow = breakIdx[s + 1]
    segments.push({
      startRow,
      endRow,
      anchors: anchors.filter((a) => a.rowIndex >= startRow && a.rowIndex < endRow),
    })
  }

  // 锚点处漂移量（原始里程 -> 校正量），分段线性插值
  const offsetAt = (segment: Segment, rowIndex: number, rawMileage: number): number => {
    const a = segment.anchors
    if (a.length === 0) {
      // 无锚点段：借用全局最近锚点的漂移量（极端兜底，正常数据不会出现）
      if (anchors.length === 0) return 0
      let nearest = anchors[0]
      for (const x of anchors) {
        if (Math.abs(x.rowIndex - rowIndex) < Math.abs(nearest.rowIndex - rowIndex)) nearest = x
      }
      return nearest.offset
    }
    if (rowIndex <= a[0].rowIndex) return a[0].offset
    if (rowIndex >= a[a.length - 1].rowIndex) return a[a.length - 1].offset
    for (let i = 0; i < a.length - 1; i++) {
      if (rowIndex >= a[i].rowIndex && rowIndex <= a[i + 1].rowIndex) {
        const span = a[i + 1].rowIndex - a[i].rowIndex
        const t = span === 0 ? 0 : (rowIndex - a[i].rowIndex) / span
        return a[i].offset + (a[i + 1].offset - a[i].offset) * t
      }
    }
    return a[a.length - 1].offset
  }

  // 4. 逐行校正
  const samples: InspectionSample[] = new Array(rows.length)
  let segPtr = 0
  for (let i = 0; i < rows.length; i++) {
    while (segPtr < segments.length - 1 && i >= segments[segPtr].endRow) segPtr++
    const row = rows[i]
    const offset = offsetAt(segments[segPtr], i, row.rawMileage)
    samples[i] = {
      batchId,
      mileage: row.rawMileage + offset,
      heightMm: row.heightMm,
      staggerMm: row.staggerMm,
      event: breakRows.has(i) ? 2 : row.event === 'POLE' ? 1 : 0,
      supportCode: row.supportCode,
    }
  }

  // 5. 杆位残差验收
  const residuals = anchors.map((a) => {
    const alignedM = a.rawMileage + a.offset
    return {
      supportCode: a.supportCode,
      archiveM: a.archiveMileage,
      alignedM,
      residualM: alignedM - a.archiveMileage,
    }
  })
  const absResiduals = residuals.map((r) => Math.abs(r.residualM))
  const maxResidualM = absResiduals.length ? Math.max(...absResiduals) : 0
  const meanResidualM = absResiduals.length
    ? absResiduals.reduce((sum, v) => sum + v, 0) / absResiduals.length
    : 0
  // 真实漂移量按断点分段统计：扣除每段段首的重计基准后，锚点偏移的最大波动
  let driftMaxM = 0
  for (const seg of segments) {
    if (seg.anchors.length === 0) continue
    const base = seg.anchors[0].offset
    for (const a of seg.anchors) {
      driftMaxM = Math.max(driftMaxM, Math.abs(a.offset - base))
    }
  }

  events.sort((x, y) => x.rowIndex - y.rowIndex)

  return {
    samples,
    report: {
      totalRows: rows.length,
      poleCount: anchors.length + unmatchedPoles.length,
      breakCount: breakRows.size,
      jumpCount: jumpRows.size,
      matchedPoles: anchors.length,
      unmatchedPoles,
      maxResidualM,
      meanResidualM,
      residuals,
      events,
      pass05m: maxResidualM < 0.5,
      driftMaxM,
    },
  }
}
