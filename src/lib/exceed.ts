import type {
  ExceedLevel,
  ExceedMetric,
  ExceedPoint,
  InspectionBatch,
  InspectionSample,
  LimitConfig,
  LineProfile,
  Pole,
} from '../types';
import { nearestPole, designContactHeight, designStagger } from './catenary';

export const DEFAULT_LIMITS: LimitConfig = {
  // 导高相对设计偏差：一级 ±50mm，二级 ±100mm（演示用，可在设置页调整）
  heightWarn: 50,
  heightSerious: 100,
  // 拉出值绝对值：一级 400mm，二级 450mm
  staggerWarn: 400,
  staggerSerious: 450,
  // 相邻定位点导高差限值
  adjacentHeightDiff: 50,
};

export interface ExceedResult {
  points: ExceedPoint[];
  stats: { level1: number; level2: number; height: number; stagger: number };
}

let seq = 0;
function newId(batchId: string, metric: ExceedMetric): string {
  seq += 1;
  return `${batchId}-EX-${metric}-${seq}`;
}

/**
 * 超限自动判定。
 * - 导高：相对就近支柱设计导高的偏差超 ±限值
 * - 拉出：绝对值超限
 * - 连续超限时合并为一个超限区段，取最恶劣点登记
 */
export function detectExceeds(
  samples: InspectionSample[],
  batch: InspectionBatch,
  profile: LineProfile,
  limits: LimitConfig,
): ExceedResult {
  const poles = profile.poles.filter((p) => p.direction === batch.direction);
  const points: ExceedPoint[] = [];

  runMetric('height');
  runMetric('stagger');

  // 相邻定位点导高差检查
  checkAdjacentPoles();

  const stats = {
    level1: points.filter((p) => p.level === 1).length,
    level2: points.filter((p) => p.level === 2).length,
    height: points.filter((p) => p.metric === 'height').length,
    stagger: points.filter((p) => p.metric === 'stagger').length,
  };
  return { points, stats };

  function levelOf(metric: ExceedMetric, absDev: number): ExceedLevel | null {
    if (metric === 'height') {
      if (absDev >= limits.heightSerious) return 2;
      if (absDev >= limits.heightWarn) return 1;
    } else {
      if (absDev >= limits.staggerSerious) return 2;
      if (absDev >= limits.staggerWarn) return 1;
    }
    return null;
  }

  function runMetric(metric: ExceedMetric) {
    let run: InspectionSample[] = [];
    let worstLevel: ExceedLevel = 1;

    const flush = () => {
      if (run.length === 0) return; // 取偏差最大的点作为代表
      let worst = run[0];
      let worstAbs = 0;
      for (const s of run) {
        const dev = deviationOf(s, metric, poles, profile, batch.direction);
        if (Math.abs(dev) > Math.abs(worstAbs)) {
          worstAbs = dev;
          worst = s;
        }
      }
      const pole = nearestPole(poles, worst.mileage);
      // 设计值取该里程的设计曲线值（含弛度/之字形），与偏差口径一致
      const design =
        metric === 'height'
          ? designContactHeight(profile, worst.mileage, worst.inTunnel, batch.direction)
          : designStagger(profile, worst.mileage, batch.direction);
      const value = metric === 'height' ? worst.contactHeight : worst.stagger;
      const limit =
        metric === 'height'
          ? worstLevel === 2
            ? limits.heightSerious
            : limits.heightWarn
          : worstLevel === 2
            ? limits.staggerSerious
            : limits.staggerWarn;
      points.push({
        id: newId(batch.id, metric),
        batchId: batch.id,
        lineId: batch.lineId,
        direction: batch.direction,
        mileage: worst.mileage,
        nearestPoleId: pole.id,
        metric,
        level: worstLevel,
        value,
        limit,
        design,
        deviation: Math.round(worstAbs),
        handled: false,
      });
      run = [];
    };

    for (const s of samples) {
      // 跳变/断点过渡带的里程置信度低，不参与自动超限判定，避免误报
      if (s.lowConfidence) {
        if (run.length) flush();
        continue;
      }
      const dev = deviationOf(s, metric, poles, profile, batch.direction);
      const lvl = levelOf(metric, Math.abs(dev));
      if (lvl !== null) {
        if (run.length && lvl > worstLevel) worstLevel = lvl;
        if (run.length === 0) worstLevel = lvl;
        run.push(s);
      } else if (run.length) {
        flush();
      }
    }
    flush();
  }

  function checkAdjacentPoles() {
    // 取每个支柱最近的采样，比较相邻定位点导高。
    // 关键：支柱本身有施工高差（设计值不同），必须比「实测高差 − 设计高差」的异常量，
    // 而不是直接比实测高差，否则正常的相邻柱高差会被整段误判。
    const atPoles = new Map<string, InspectionSample>();
    for (const s of samples) {
      if (s.lowConfidence) continue;
      const pole = nearestPole(poles, s.mileage);
      const exist = atPoles.get(pole.id);
      if (!exist || Math.abs(exist.mileage - pole.mileage) > Math.abs(s.mileage - pole.mileage)) {
        atPoles.set(pole.id, s);
      }
    }
    const ordered = poles
      .map((p) => ({ pole: p, s: atPoles.get(p.id) }))
      .filter((x): x is { pole: Pole; s: InspectionSample } => !!x.s);
    for (let i = 1; i < ordered.length; i++) {
      const measuredDiff = ordered[i].s.contactHeight - ordered[i - 1].s.contactHeight;
      const designDiff = ordered[i].pole.designHeight - ordered[i - 1].pole.designHeight;
      const abnormal = measuredDiff - designDiff;
      if (Math.abs(abnormal) >= limits.adjacentHeightDiff) {
        const target = ordered[i];
        points.push({
          id: newId(batch.id, 'height'),
          batchId: batch.id,
          lineId: batch.lineId,
          direction: batch.direction,
          mileage: target.s.mileage,
          nearestPoleId: target.pole.id,
          metric: 'height',
          level: Math.abs(abnormal) >= limits.adjacentHeightDiff * 1.5 ? 2 : 1,
          value: target.s.contactHeight,
          limit: limits.adjacentHeightDiff,
          design: target.pole.designHeight,
          deviation: Math.round(abnormal),
          handled: false,
        });
      }
    }
  }
}

/**
 * 相对「设计曲线」的偏差，而不是相对定位点设计值。
 * 关键：接触线在跨中本来就有设计弛度（露天约 55mm），拉出值在定位点间按之字形线性过渡，
 * 若拿定位点设计值逐采样比对，会把整条跨的正常弛度误判成超限。
 */
function deviationOf(
  s: InspectionSample,
  metric: ExceedMetric,
  poles: Pole[],
  profile: LineProfile,
  direction: 'up' | 'down',
): number {
  if (metric === 'height') {
    // 导高：相对设计曲线（含跨中弛度）的偏差
    const design = designContactHeight(profile, s.mileage, s.inTunnel, direction);
    return s.contactHeight - design;
  }
  // 拉出值：限界是弓网安全几何的绝对包络，直接用实测绝对值（带符号返回，取绝对值判级）
  return s.stagger;
}

/** 下一批次自动复核：超限点在新批次同里程附近是否仍超限（相对设计曲线口径） */
export function recheckExceed(
  point: ExceedPoint,
  newSamples: InspectionSample[],
  limits: LimitConfig,
  profile: LineProfile,
): { value: number; deviation: number; passed: boolean } {
  const window = 10; // m
  const nearby = newSamples.filter((s) => Math.abs(s.mileage - point.mileage) <= window);
  if (nearby.length === 0) {
    return { value: 0, deviation: 0, passed: false };
  }
  const deviationAt = (s: InspectionSample): number =>
    point.metric === 'height'
      ? s.contactHeight - designContactHeight(profile, s.mileage, s.inTunnel, point.direction)
      : s.stagger; // 拉出按实测绝对值包络判级
  let worst = nearby[0];
  let worstDev = deviationAt(worst);
  for (const s of nearby) {
    const d = deviationAt(s);
    if (Math.abs(d) > Math.abs(worstDev)) {
      worstDev = d;
      worst = s;
    }
  }
  const value = point.metric === 'height' ? worst.contactHeight : worst.stagger;
  const deviation = Math.round(worstDev);
  const threshold =
    point.metric === 'height'
      ? point.level === 2
        ? limits.heightSerious
        : limits.heightWarn
      : point.level === 2
        ? limits.staggerSerious
        : limits.staggerWarn;
  const passed = Math.abs(deviation) < threshold;
  return { value, deviation, passed };
}
