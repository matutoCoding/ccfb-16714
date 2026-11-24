// 超限点自动判定：按限界值扫描，连续超限合并为一个超限区段，取极值点定级

import type { ExceedPoint, InspectionSample, LimitThresholds, Support, TrackNo } from '@/types'
import { nearestSupport, uid } from '@/utils/format'

interface Violation {
  metric: 'height' | 'stagger'
  level: 1 | 2
  value: number
  limit: number
  upward: boolean
}

const judge = (
  height: number,
  stagger: number,
  limits: LimitThresholds,
): Violation[] => {
  const out: Violation[] = []
  if (height >= limits.heightUpperL2) {
    out.push({ metric: 'height', level: 2, value: height, limit: limits.heightUpperL2, upward: true })
  } else if (height >= limits.heightUpperL1) {
    out.push({ metric: 'height', level: 1, value: height, limit: limits.heightUpperL1, upward: true })
  } else if (height <= limits.heightLowerL2) {
    out.push({ metric: 'height', level: 2, value: height, limit: limits.heightLowerL2, upward: false })
  } else if (height <= limits.heightLowerL1) {
    out.push({ metric: 'height', level: 1, value: height, limit: limits.heightLowerL1, upward: false })
  }
  const absStagger = Math.abs(stagger)
  if (absStagger >= limits.staggerAbsL2) {
    out.push({ metric: 'stagger', level: 2, value: stagger, limit: limits.staggerAbsL2, upward: true })
  } else if (absStagger >= limits.staggerAbsL1) {
    out.push({ metric: 'stagger', level: 1, value: stagger, limit: limits.staggerAbsL1, upward: true })
  }
  return out
}

export const detectExceeds = (
  batchId: string,
  trackNo: TrackNo,
  samples: InspectionSample[],
  supports: Support[],
  limits: LimitThresholds,
): ExceedPoint[] => {
  const result: ExceedPoint[] = []
  // 每个指标维护一个进行中的超限区段
  const open: Record<'height' | 'stagger', {
    startIdx: number
    maxIdx: number
    level: 1 | 2
    maxValue: number
    limitValue: number
    upward: boolean // true=越上限/绝对值增大方向，false=越下限
  } | null> = { height: null, stagger: null }

  const close = (metric: 'height' | 'stagger', endIdx: number) => {
    const seg = open[metric]
    if (!seg) return
    const maxSample = samples[seg.maxIdx]
    const support = nearestSupport(supports, maxSample.mileage)
    result.push({
      id: uid('exc'),
      batchId,
      trackNo,
      startMileage: samples[seg.startIdx].mileage,
      endMileage: samples[endIdx].mileage,
      maxMileage: maxSample.mileage,
      metric,
      level: seg.level,
      maxValue: seg.maxValue,
      limitValue: seg.limitValue,
      nearestSupportCode: support.supportCode,
      status: 'open',
      createdAt: new Date().toISOString(),
    })
    open[metric] = null
  }

  samples.forEach((s, idx) => {
    const violations = judge(s.heightMm, s.staggerMm, limits)
    for (const metric of ['height', 'stagger'] as const) {
      const v = violations.find((x) => x.metric === metric)
      const seg = open[metric]
      if (!v) {
        if (seg) close(metric, idx - 1)
        continue
      }
      if (!seg) {
        open[metric] = {
          startIdx: idx,
          maxIdx: idx,
          level: v.level,
          maxValue: v.value,
          limitValue: v.limit,
          upward: v.upward,
        }
      } else {
        // 区段内出现更高级别或更极端值则升级，按超限方向选取极值
        const worse =
          metric === 'stagger'
            ? Math.abs(v.value) > Math.abs(seg.maxValue)
            : seg.upward
              ? v.value > seg.maxValue
              : v.value < seg.maxValue
        if (worse) {
          seg.maxIdx = idx
          seg.maxValue = v.value
          seg.limitValue = v.limit
        }
        seg.level = Math.max(seg.level, v.level) as 1 | 2
      }
    }
  })

  close('height', samples.length - 1)
  close('stagger', samples.length - 1)
  return result.sort((a, b) => a.maxMileage - b.maxMileage)
}
