import type { Direction, LineProfile, Pole } from '../types';

// 接触网简化力学模型：
// - 定位点处接触线被定位器固定到设计导高/拉出值
// - 跨中按弛度下垂（抛物线近似）
// - 承力索在定位点经吊弦悬挂，弛度小于接触线

export interface SpanContext {
  poleA: Pole;
  poleB: Pole;
  /** 0~1，在本跨内的相对位置 */
  t: number;
  span: number;
}

/** 找到里程所在跨；里程在首柱之前/末柱之后时返回 null（由调用方按端柱恒定处理） */
export function findSpan(poles: Pole[], mileage: number): SpanContext | null {
  if (poles.length < 2) return null;
  // 首柱之前、末柱之后：不做跨内外推，避免 t 越界产生离谱的设计值
  if (mileage < poles[0].mileage || mileage > poles[poles.length - 1].mileage) return null;
  // 二分查找最后一个 mileage <= 目标里程的支柱
  let lo = 0;
  let hi = poles.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (poles[mid].mileage <= mileage) lo = mid;
    else hi = mid - 1;
  }
  const a = poles[lo];
  const b = poles[lo + 1];
  if (!b) return null;
  const span = b.mileage - a.mileage;
  return { poleA: a, poleB: b, t: (mileage - a.mileage) / span, span };
}

/**
 * 设计接触线导高 mm。
 * 定位点 = 设计导高；跨中按抛物线弛度下垂（隧道内弛度显著减小，链形悬挂整体吊弦）。
 * 必须按方向过滤支柱——profile.poles 是上下行混合数组，直接二分会跨方向错乱。
 */
export function designContactHeight(
  profile: LineProfile,
  mileage: number,
  inTunnel: boolean,
  direction?: Direction,
): number {
  const poles = direction ? profile.poles.filter((p) => p.direction === direction) : profile.poles;
  const ctx = findSpan(poles, mileage);
  if (!ctx) {
    // 首柱之前/末柱之后：端柱设计导高恒定，无跨中弛度
    const endPole = mileage < poles[0].mileage ? poles[0] : poles[poles.length - 1];
    return endPole?.designHeight ?? profile.designHeight;
  }
  const sag = (inTunnel ? 25 : 55) * 4 * ctx.t * (1 - ctx.t); // 跨中最大弛度 mm
  const endHeight = ctx.poleA.designHeight + (ctx.poleB.designHeight - ctx.poleA.designHeight) * ctx.t;
  return endHeight - sag;
}

/** 设计拉出值 mm：定位点之间线性过渡，形成之字形 */
export function designStagger(profile: LineProfile, mileage: number, direction?: Direction): number {
  const poles = direction ? profile.poles.filter((p) => p.direction === direction) : profile.poles;
  const ctx = findSpan(poles, mileage);
  if (!ctx) {
    const endPole = mileage < poles[0].mileage ? poles[0] : poles[poles.length - 1];
    return endPole?.designStagger ?? 0;
  }
  return ctx.poleA.designStagger + (ctx.poleB.designStagger - ctx.poleA.designStagger) * ctx.t;
}

/**
 * 承力索导高 mm：定位点处高出接触线（结构高度），跨中弛度更大。
 */
export function designMessengerHeight(
  profile: LineProfile,
  mileage: number,
  inTunnel: boolean,
  direction?: Direction,
): number {
  const poles = direction ? profile.poles.filter((p) => p.direction === direction) : profile.poles;
  const ctx = findSpan(poles, mileage);
  if (!ctx) {
    const endPole = mileage < poles[0].mileage ? poles[0] : poles[poles.length - 1];
    const structural = inTunnel ? 500 : 1400;
    return (endPole?.designHeight ?? profile.designHeight) + structural;
  }
  const structural = inTunnel ? 500 : 1400; // 隧道内结构高度小
  const contact = designContactHeight(profile, mileage, inTunnel, direction);
  const messengerSag = (inTunnel ? 10 : 30) * 4 * ctx.t * (1 - ctx.t);
  const endTop =
    ctx.poleA.designHeight +
    structural +
    (ctx.poleB.designHeight - ctx.poleA.designHeight) * ctx.t;
  // 承力索在定位点高、跨中略下垂；吊弦长度 = messenger - contact
  return Math.max(contact + 120, endTop - messengerSag);
}

/** 判断里程是否在隧道内 */
export function isInTunnel(profile: LineProfile, mileage: number): boolean {
  return profile.tunnels.some((t) => mileage >= t.startMileage && mileage < t.endMileage);
}

/** 就近支柱 */
export function nearestPole(poles: Pole[], mileage: number): Pole {
  let best = poles[0];
  let bestD = Infinity;
  for (const p of poles) {
    const d = Math.abs(p.mileage - mileage);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
