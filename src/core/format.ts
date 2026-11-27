// 里程 / 数值格式化

/** m → K12+345.67 */
export function fmtMileage(m: number, withDecimals = true): string {
  if (!Number.isFinite(m)) return '—';
  const neg = m < 0;
  const v = Math.abs(m);
  const km = Math.floor(v / 1000);
  const rest = v - km * 1000;
  const restStr = withDecimals ? rest.toFixed(2).padStart(6, '0') : Math.round(rest).toString().padStart(3, '0');
  return `${neg ? '-' : ''}K${km}+${restStr}`;
}

/** 紧凑里程，用于坐标轴 */
export function fmtKm(m: number): string {
  return `K${(m / 1000).toFixed(1)}`;
}

export function fmtFixed(v: number | null | undefined, digits = 2, suffix = ''): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}${suffix}`;
}

export function fmtDate(ts?: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  // 加 BOM，Excel 打开中文不乱码
  const blob = new Blob(['﻿' + text], { type: mime });
  downloadBlob(filename, blob);
}

/** 杆号归一化：去空格/大小写，提取字母+数字主体 */
export function normalizePoleCode(code: string): string {
  return String(code ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[＃#号]/g, '');
}

/** 从杆号中提取数字序号（兜底匹配用） */
export function poleDigits(code: string): number | null {
  const m = normalizePoleCode(code).match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : null;
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 在有序数值数组中二分查找 <= x 的下标 */
export function bisectLeft(arr: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 线性插值查找（数组严格递增），外推用端点斜率 */
export function interp1(xs: ArrayLike<number>, ys: ArrayLike<number>, x: number): number {
  const n = xs.length;
  if (n === 0) return NaN;
  if (n === 1) return ys[0];
  if (x <= xs[0]) {
    const s = (ys[1] - ys[0]) / (xs[1] - xs[0]);
    return ys[0] + s * (x - xs[0]);
  }
  if (x >= xs[n - 1]) {
    const s = (ys[n - 1] - ys[n - 2]) / (xs[n - 1] - xs[n - 2]);
    return ys[n - 1] + s * (x - xs[n - 1]);
  }
  const i = bisectLeft(xs, x);
  const i0 = Math.max(0, i - 1);
  const x0 = xs[i0];
  const x1 = xs[i0 + 1];
  const t = (x - x0) / (x1 - x0);
  return ys[i0] + (ys[i0 + 1] - ys[i0]) * t;
}
