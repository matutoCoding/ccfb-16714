// 通用工具函数

export const fmtMileage = (m: number): string => {
  const km = Math.floor(m / 1000)
  const rest = m - km * 1000
  return `K${km}+${rest.toFixed(1).padStart(5, '0')}`
}

export const fmtMm = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`

export const fmtM = (v: number): string => `${v.toFixed(2)}m`

export const monthLabel = (inspectDate: string): string => inspectDate

export const uid = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v))

export const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// 最近支柱二分查找（supports 按里程升序）
export const nearestSupport = <T extends { mileage: number }>(
  list: T[],
  mileage: number,
): T => {
  let lo = 0
  let hi = list.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (list[mid].mileage < mileage) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && Math.abs(list[lo - 1].mileage - mileage) < Math.abs(list[lo].mileage - mileage)) {
    return list[lo - 1]
  }
  return list[lo]
}

// 确定性伪随机（生成器与回放共用同一序列，保证可复现）
export const seededRandom = (seed: number): (() => number) => {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}
