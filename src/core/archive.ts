import type { Pole } from './types';

/** 找里程最近的支柱 */
export function nearestPole(poles: Pole[], mileage: number): Pole | undefined {
  if (!poles.length) return undefined;
  let lo = 0;
  let hi = poles.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (poles[mid].mileage < mileage) lo = mid + 1;
    else hi = mid;
  }
  const cand = [poles[lo], poles[lo - 1]].filter(Boolean);
  return cand.reduce((best, p) => (Math.abs(p.mileage - mileage) < Math.abs(best.mileage - mileage) ? p : best), cand[0]);
}

/** 找某里程所在跨距的前一杆 */
export function spanBeforePole(poles: Pole[], mileage: number): Pole | undefined {
  let lo = 0;
  let hi = poles.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (poles[mid].mileage <= mileage) lo = mid + 1;
    else hi = mid;
  }
  return poles[Math.max(0, lo - 1)];
}
