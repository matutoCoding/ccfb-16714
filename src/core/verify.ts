// 工单复核：新批次导入后，用同里程最近采样值核对工单对应的超限是否消除
import type { InspectionBatch, InspectionSample, WorkOrder } from '@/types'
import { loadSettings } from '@/db/idb'

export interface VerifyResult {
  order: WorkOrder
  fixed: boolean
  currentValue: number
  limitValue: number
}

const nearestSample = (samples: InspectionSample[], mileage: number): InspectionSample | null => {
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

export const verifyOrderAgainstBatch = async (
  order: WorkOrder,
  batch: InspectionBatch,
  samples: InspectionSample[],
): Promise<VerifyResult> => {
  const settings = await loadSettings()
  const sample = nearestSample(samples, order.mileage)
  const value = order.metric === 'height' ? sample?.heightMm ?? 0 : sample?.staggerMm ?? 0
  const l = settings.limits
  let fixed = false
  let limitValue = 0
  if (order.metric === 'height') {
    fixed = value < l.heightUpperL1 && value > l.heightLowerL1
    limitValue = value >= settings.limits.heightUpperL1
      ? l.heightUpperL1
      : l.heightLowerL1
  } else {
    fixed = Math.abs(value) < l.staggerAbsL1
    limitValue = l.staggerAbsL1
  }
  return { order, fixed, currentValue: value, limitValue }
}
