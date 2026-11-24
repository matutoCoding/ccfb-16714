// 趋势分析：同股道多个批次在同一里程/定位点上的数值对比
import type { InspectionBatch, InspectionSample, Support } from '@/types'

export interface BatchSeries {
  batch: InspectionBatch
  samples: InspectionSample[]
}

// 二分查找某里程最近采样
const sampleNear = (samples: InspectionSample[], mileage: number): InspectionSample | null => {
  if (samples.length === 0) return null
  let lo = 0
  let hi = samples.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (samples[mid].mileage < mileage) lo = mid + 1
    else hi = mid
  }
  const cur = samples[lo]
  const prev = lo > 0 ? samples[lo - 1] : cur
  return Math.abs(cur.mileage - mileage) < Math.abs(prev.mileage - mileage) ? cur : prev
}

export interface LocatorTrend {
  supportCode: string
  mileage: number
  rows: {
    batchId: string
    inspectDate: string
    heightMm: number
    staggerMm: number
  }[]
  heightDelta: number // 末月 - 首月
  staggerDelta: number
  monotonicHeight: boolean // 是否持续单向变化
  monotonicStagger: boolean
}

export const buildLocatorTrends = (
  series: BatchSeries[],
  supports: Support[],
): LocatorTrend[] => {
  const ordered = [...series].sort((a, b) =>
    a.batch.inspectDate.localeCompare(b.batch.inspectDate),
  )
  if (ordered.length < 2) return []

  return supports.map((support) => {
    const rows = ordered.map((s) => {
      const sample = sampleNear(s.samples, support.mileage)
      return {
        batchId: s.batch.id,
        inspectDate: s.batch.inspectDate,
        heightMm: sample?.heightMm ?? 0,
        staggerMm: sample?.staggerMm ?? 0,
      }
    })
    const heightDelta = rows[rows.length - 1].heightMm - rows[0].heightMm
    const staggerDelta = rows[rows.length - 1].staggerMm - rows[0].staggerMm
    const monotonic = (key: 'heightMm' | 'staggerMm', useAbs: boolean) => {
      const vals = rows.map((r) => (useAbs ? Math.abs(r[key]) : r[key]))
      const increasing = vals.slice(1).every((v, i) => v >= vals[i])
      const decreasing = vals.slice(1).every((v, i) => v <= vals[i])
      return increasing || decreasing
    }
    return {
      supportCode: support.supportCode,
      mileage: support.mileage,
      rows,
      heightDelta,
      staggerDelta,
      monotonicHeight: monotonic('heightMm', false),
      monotonicStagger: monotonic('staggerMm', true),
    }
  })
}

// 窗口内曲线叠加序列
export const buildOverlaySeries = (
  series: BatchSeries[],
  range: [number, number],
  metric: 'heightMm' | 'staggerMm',
  palette: string[],
) =>
  [...series]
    .sort((a, b) => a.batch.inspectDate.localeCompare(b.batch.inspectDate))
    .map((s, i) => ({
      name: s.batch.inspectDate,
      color: palette[i % palette.length],
      points: s.samples
        .filter((p) => p.mileage >= range[0] && p.mileage <= range[1])
        .map((p) => ({ x: p.mileage, y: p[metric] })),
    }))
