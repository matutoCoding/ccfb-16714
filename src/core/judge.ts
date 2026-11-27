// 超限自动判定：按限界值分级（一级/二级），连续超限采样聚类为“超限点/区段”

import type { Defect, DetectionRun, LimitSettings, Pole, AnchorSection, MetricType } from './types';
import { nearestPole } from './archive';

export interface JudgeContext {
  run: DetectionRun;
  batchId: string;
  track: 'up' | 'down';
  limits: LimitSettings;
  poles: Pole[];
  anchors: AnchorSection[];
  designHeight: number;
  designStagger: number;
}

interface Cluster {
  metric: MetricType;
  level: 1 | 2;
  peakIndex: number;
  startIndex: number;
  endIndex: number;
  peakAbs: number;
  peakSigned: number;
  peakDeviation: number;
  limitUsed: number;
}

const MERGE_GAP_M = 3; // 超限簇之间小于该间隔则合并

export function judgeRun(ctx: JudgeContext): Defect[] {
  const { run, limits } = ctx;
  const n = run.pointCount;
  const defects: Defect[] = [];

  for (const metric of ['height', 'pull'] as MetricType[]) {
    const isOver = (i: number): { over: boolean; level: 1 | 2; abs: number; dev: number; limit: number } => {
      if (metric === 'height') {
        const h = run.height[i];
        const dev = h - ctx.designHeight; // 导高过高/过低都算偏差
        const abs = Math.abs(dev);
        if (abs >= limits.heightLevel2) return { over: true, level: 2, abs: Math.abs(h), dev, limit: limits.heightLevel2 };
        if (abs >= limits.heightLevel1) return { over: true, level: 1, abs: Math.abs(h), dev, limit: limits.heightLevel1 };
        return { over: false, level: 1, abs: Math.abs(h), dev, limit: limits.heightLevel1 };
      } else {
        const p = run.pull[i];
        const abs = Math.abs(p);
        // 异常分量：超出设计之字基准幅值的部分（带方向）
        const excess = Math.sign(p) * Math.max(0, abs - ctx.designStagger);
        if (abs >= limits.pullLevel2) return { over: true, level: 2, abs, dev: excess, limit: limits.pullLevel2 };
        if (abs >= limits.pullLevel1) return { over: true, level: 1, abs, dev: excess, limit: limits.pullLevel1 };
        return { over: false, level: 1, abs, dev: excess, limit: limits.pullLevel1 };
      }
    };

    // 找出所有超限索引，再聚类（允许 MERGE_GAP_M 内的小回落）
    const overFlags: Array<ReturnType<typeof isOver>> = new Array(n);
    for (let i = 0; i < n; i++) overFlags[i] = isOver(i);

    let i = 0;
    while (i < n) {
      if (!overFlags[i].over) {
        i++;
        continue;
      }
      const start = i;
      let end = i;
      let peakIndex = i;
      let peakAbsMetric = -Infinity;
      let maxLevel: 1 | 2 = 1;

      const consider = (j: number) => {
        const f = overFlags[j];
        const magnitude = metric === 'height' ? Math.abs(run.height[j] - ctx.designHeight) : Math.abs(run.pull[j]);
        if (magnitude > peakAbsMetric) {
          peakAbsMetric = magnitude;
          peakIndex = j;
        }
        if (f.level === 2) maxLevel = 2;
        end = j;
      };

      consider(i);
      let j = i + 1;
      while (j < n) {
        if (overFlags[j].over) {
          consider(j);
          j++;
          continue;
        }
        // 向前看 MERGE_GAP_M 米内是否再次超限
        const m0 = run.fixedMileage[j];
        let k = j;
        let resumed = -1;
        while (k < n && run.fixedMileage[k] - m0 <= MERGE_GAP_M) {
          if (overFlags[k].over) {
            resumed = k;
            break;
          }
          k++;
        }
        if (resumed >= 0) {
          for (let q = j; q <= resumed; q++) consider(q);
          j = resumed + 1;
        } else {
          break;
        }
      }

      const fPeak = overFlags[peakIndex];
      const cluster: Cluster = {
        metric,
        level: maxLevel,
        peakIndex,
        startIndex: start,
        endIndex: end,
        peakAbs: metric === 'height' ? run.height[peakIndex] : Math.abs(run.pull[peakIndex]),
        peakSigned: metric === 'height' ? run.height[peakIndex] : run.pull[peakIndex],
        peakDeviation: fPeak.dev,
        limitUsed: (maxLevel as number) === 2
          ? metric === 'height' ? limits.heightLevel2 : limits.pullLevel2
          : metric === 'height' ? limits.heightLevel1 : limits.pullLevel1,
      };
      defects.push(buildDefect(cluster, ctx));
      i = end + 1;
    }
  }

  // 同里程附近的高度/拉出缺陷保留为独立记录；按里程排序
  defects.sort((a, b) => a.mileage - b.mileage || a.metric.localeCompare(b.metric));
  return defects;
}

function buildDefect(c: Cluster, ctx: JudgeContext): Defect {
  const { run } = ctx;
  const mileage = run.fixedMileage[c.peakIndex];
  const startMileage = run.fixedMileage[c.startIndex];
  const endMileage = run.fixedMileage[Math.min(c.endIndex, run.pointCount - 1)];
  const np = nearestPole(ctx.poles, mileage);
  const anchor = ctx.anchors.find((a) => mileage >= a.fromMileage && mileage <= a.toMileage);
  const value = c.metric === 'height' ? Math.round(c.peakAbs) : Math.round(c.peakAbs);
  const signedValue = Math.round(c.peakSigned);

  // 趋势归并键：优先归到最近杆（定位点），否则 20m 里程格
  const trendKey = np && Math.abs(np.mileage - mileage) < 25
    ? `pole:${np.code}`
    : `bin:${Math.round(mileage / 20) * 20}`;

  return {
    id: `${run.id}__${c.metric}__${Math.round(mileage * 10)}`,
    runId: run.id,
    batchId: ctx.batchId,
    track: ctx.track,
    metric: c.metric,
    level: c.level,
    mileage,
    startMileage,
    endMileage,
    length: Math.max(0, endMileage - startMileage),
    value,
    signedValue,
    deviation: Math.round(c.peakDeviation),
    limitUsed: c.limitUsed,
    poleCode: np?.code,
    anchorCode: anchor?.code ?? np?.anchorCode,
    status: 'open',
    trendKey,
  };
}

/** 从一次 run 的序列中取某里程附近窗口的峰值偏差（工单复核用） */
export function peakDeviationNear(
  run: DetectionRun,
  mileage: number,
  metric: MetricType,
  designHeight: number,
  windowM = 12,
  designStagger = 250,
): { peak: number; excess: number; signedPeak: number; mileage: number } {
  let lo = 0;
  let hi = run.pointCount - 1;
  // fixedMileage 近似单调，二分窗口
  let l = 0;
  let r = run.pointCount - 1;
  while (l < r) {
    const mid = (l + r) >> 1;
    if (run.fixedMileage[mid] < mileage - windowM) l = mid + 1;
    else r = mid;
  }
  lo = l;
  l = 0;
  r = run.pointCount - 1;
  while (l < r) {
    const mid = (l + r) >> 1;
    if (run.fixedMileage[mid] < mileage + windowM) l = mid + 1;
    else r = mid;
  }
  hi = Math.max(0, l - 1);

  let peak = 0;
  let excess = 0;
  let signedPeak = 0;
  let atMileage = mileage;
  for (let i = Math.max(0, lo - 2); i <= Math.min(run.pointCount - 1, hi + 2); i++) {
    if (metric === 'height') {
      const dev = Math.abs(run.height[i] - designHeight);
      if (dev > peak) {
        peak = dev;
        excess = dev;
        signedPeak = run.height[i] - designHeight;
        atMileage = run.fixedMileage[i];
      }
    } else {
      const abs = Math.abs(run.pull[i]);
      if (abs > peak) {
        peak = abs;
        excess = Math.max(0, abs - designStagger);
        signedPeak = run.pull[i];
        atMileage = run.fixedMileage[i];
      }
    }
  }
  return { peak, excess, signedPeak, mileage: atMileage };
}
