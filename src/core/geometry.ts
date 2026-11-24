// 线路几何：里程 -> 三维坐标的统一映射，生成器与三维回放共用
// x 轴为里程方向，y 为高度，z 为横向（曲线偏转方向）

import type { CurveSegment, LineArchive, Support, TrackNo } from '@/types'

export interface Point3 {
  x: number
  y: number
  z: number
}

export const TRACK_OFFSET: Record<TrackNo, number> = {
  1: -2.5, // 下行
  2: 2.5, // 上行
}

// 曲线段在该处的横向偏移（米）。用圆弧近似，按里程分段积分
const lateralAt = (curves: CurveSegment[], trackNo: TrackNo, mileage: number): number => {
  let z = 0
  let prevEnd = 0
  for (const c of curves) {
    if (c.trackNo !== trackNo) continue
    if (mileage <= c.startMileage) break
    const sign = c.radius >= 0 ? 1 : -1
    const r = Math.abs(c.radius)
    if (mileage >= c.endMileage) {
      // 整段：弦偏移 L^2/(2R)，出曲线后保持切线方向延伸由下一段处理
      const len = c.endMileage - c.startMileage
      z += sign * (len * len) / (2 * r)
      prevEnd = c.endMileage
    } else {
      const len = mileage - c.startMileage
      z += sign * (len * len) / (2 * r)
      return z
    }
  }
  return z
}

// 中心线坐标
export const centerlinePoint = (archive: LineArchive, mileage: number): Point3 => ({
  x: mileage,
  y: 0,
  z: lateralAt(archive.curves, 1, mileage),
})

// 股道坐标（含线间距偏移）
export const trackPoint = (
  archive: LineArchive,
  trackNo: TrackNo,
  mileage: number,
): Point3 => {
  const c = centerlinePoint(archive, mileage)
  return { x: c.x, y: 0, z: c.z + TRACK_OFFSET[trackNo] }
}

// 设计导高（毫米）：隧道内略低，其余取档案设计值
export const designHeightAt = (archive: LineArchive, mileage: number): number => {
  const inTunnel = archive.tunnels.some(
    (t) => mileage >= t.startMileage && mileage <= t.endMileage,
  )
  return inTunnel ? archive.designHeight - 200 : archive.designHeight
}

// 设计拉出值（毫米）：定位点之间线性过渡
export const designStaggerAt = (supports: Support[], mileage: number): number => {
  if (supports.length === 0) return 0
  let lo = 0
  let hi = supports.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (supports[mid].mileage < mileage) lo = mid + 1
    else hi = mid
  }
  const right = supports[lo]
  const left = lo > 0 ? supports[lo - 1] : right
  if (left === right) return right.hasLocators[0]?.designStagger ?? 0
  const span = right.mileage - left.mileage
  const t = span === 0 ? 0 : (mileage - left.mileage) / span
  const lv = left.hasLocators[0]?.designStagger ?? 0
  const rv = right.hasLocators[0]?.designStagger ?? 0
  return lv + (rv - lv) * t
}

// 接触线三维坐标。exagH/exagS 为放大倍数（毫米换算成米时再乘放大）
export const contactWirePoint = (
  archive: LineArchive,
  trackNo: TrackNo,
  supports: Support[],
  mileage: number,
  heightMm: number,
  staggerMm: number,
  exagH = 1,
  exagS = 1,
): Point3 => {
  const base = trackPoint(archive, trackNo, mileage)
  return {
    x: base.x,
    y: (heightMm / 1000) * exagH,
    z: base.z + (staggerMm / 1000) * exagS,
  }
}

// 承力索：沿跨距呈悬链线状抬升，跨中最大抬升 600mm
export const messengerWirePoint = (
  archive: LineArchive,
  trackNo: TrackNo,
  supports: Support[],
  mileage: number,
  exagH: number,
): Point3 => {
  const base = trackPoint(archive, trackNo, mileage)
  const heightMm = designHeightAt(archive, mileage)
  let lo = 0
  let hi = supports.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (supports[mid].mileage < mileage) lo = mid + 1
    else hi = mid
  }
  const right = supports[lo]
  const left = lo > 0 ? supports[lo - 1] : right
  const span = Math.max(right.mileage - left.mileage, 1)
  const t = Math.min(1, Math.max(0, (mileage - left.mileage) / span))
  const sag = 0.6 * 4 * t * (1 - t) // 跨中 0.6m，支柱处 0
  return {
    x: base.x,
    y: (heightMm / 1000 + sag) * exagH,
    z: base.z,
  }
}
