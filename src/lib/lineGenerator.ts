import type {
  AnchorSection,
  Direction,
  Dropper,
  LineProfile,
  Pole,
  TrackCurve,
  Tunnel,
} from '../types';
import { formatMileage } from './geometry';

export const LINE_LENGTH = 50_000; // 50 km
const ANCHOR_LEN = 2200; // 锚段约 2.2km
const SPAN_NOMINAL = 55; // 标称跨距
const DESIGN_HEIGHT = 6000; // 标准导高 6000mm
const DESIGN_STAGGER = 300; // 拉出值 ±300mm

/** 可复现随机数（mulberry32） */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 平曲线布置（两条方向共用平面线形，反向时曲线左右互换）。
 * 用确定性方案，保证各方向/各批次一致。
 */
function buildCurves(lineId: string, direction: Direction): TrackCurve[] {
  const plan: Array<[number, number, number, 'left' | 'right']> = [
    // 起点 m, 长度 m, 半径 m, 方向
    [3200, 1400, 2000, 'right'],
    [8100, 900, 1500, 'left'],
    [13500, 1800, 3000, 'right'],
    [19800, 1200, 1200, 'left'],
    [26400, 1600, 2500, 'right'],
    [33000, 1000, 1800, 'left'],
    [39500, 2000, 3500, 'right'],
    [45200, 1100, 1600, 'left'],
  ];
  return plan.map(([start, len, radius, side], i) => ({
    id: `${lineId}-${direction}-curve-${i}`,
    lineId,
    direction,
    startMileage: start,
    endMileage: start + len,
    radius,
    type: direction === 'up' ? side : side === 'left' ? 'right' : 'left',
  }));
}

function buildTunnels(lineId: string): Tunnel[] {
  const plan: Array<[number, number, string]> = [
    [10500, 2300, '青龙山隧道'],
    [22800, 3100, '云岭隧道'],
    [36200, 1800, '青石坳隧道'],
    [46800, 2200, '南塬隧道'],
  ];
  return plan.map(([start, len, name], i) => ({
    id: `${lineId}-tunnel-${i}`,
    lineId,
    startMileage: start,
    endMileage: start + len,
    name,
  }));
}

function buildDirection(lineId: string, direction: Direction, random: () => number): {
  poles: Pole[];
  droppers: Dropper[];
  anchors: AnchorSection[];
  curves: TrackCurve[];
} {
  const curves = buildCurves(lineId, direction);
  const inCurve = (m: number) => curves.find((c) => m >= c.startMileage && m < c.endMileage);

  // ---- 锚段 ----
  const anchors: AnchorSection[] = [];
  const anchorCount = Math.round(LINE_LENGTH / ANCHOR_LEN);
  for (let i = 0; i < anchorCount; i++) {
    const start = i * ANCHOR_LEN;
    const end = i === anchorCount - 1 ? LINE_LENGTH : (i + 1) * ANCHOR_LEN;
    anchors.push({
      id: `${lineId}-${direction}-anchor-${i}`,
      lineId,
      direction,
      index: i,
      startMileage: start,
      endMileage: end,
      name: `${formatMileage(start)}~${formatMileage(end)}`,
    });
  }

  // ---- 支柱 ----
  const poles: Pole[] = [];
  const droppers: Dropper[] = [];
  let mileage = 40;
  let poleSeq = 1;
  // 之字形相位必须与 catenary.designStagger 的线性插值一致（首柱取 +），
  // 两方向共用同一相位约定，否则检测模型与档案会系统性错位、整片误判超限。
  let staggerSign = 1;
  const anchorAt = (m: number) =>
    anchors.find((a) => m >= a.startMileage && m < a.endMileage) ?? anchors[anchors.length - 1];

  while (mileage < LINE_LENGTH - 30) {
    // 跨距：直线 50~60，曲线内 40~50
    const curve = inCurve(mileage);
    const span = curve
      ? 40 + random() * 10
      : SPAN_NOMINAL - 5 + random() * 10;
    mileage += span;
    if (mileage >= LINE_LENGTH - 30) break;

    const tunnel = mileage >= 10500 && false; // 占位（隧道判断在下方用 tunnels）
    void tunnel;
    const poleNo = `${poleSeq++}#`;
    staggerSign = -staggerSign;
    // 曲线段通过减小拉出值绝对值模拟轨道超高补偿（简化）
    const staggerAmp = curve ? DESIGN_STAGGER - 60 : DESIGN_STAGGER;
    const designStagger = Math.round(staggerSign * staggerAmp + (random() - 0.5) * 20);
    // 隧道内导高略低（5750），其余 6000，附带 ±30 施工偏差
    const inTunnelHere = isInsideTunnel(mileage);
    const baseHeight = inTunnelHere ? 5750 : DESIGN_HEIGHT;
    const designHeight = Math.round(baseHeight + (random() - 0.5) * 60);

    const pole: Pole = {
      id: `${lineId}-${direction}-pole-${poleSeq - 1}`,
      lineId,
      direction,
      poleNo,
      mileage: Math.round(mileage * 10) / 10,
      anchorId: anchorAt(mileage).id,
      designStagger,
      designHeight,
      hasRegistrator: true,
    };
    poles.push(pole);

    // ---- 吊弦：每跨 4~6 根 ----
    const prev = poles[poles.length - 2];
    if (prev) {
      const spanLen = pole.mileage - prev.mileage;
      const n = 4 + Math.floor(random() * 3);
      const inside = isInsideTunnel(pole.mileage);
      const structural = inside ? 500 : 1400;
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        const dMileage = prev.mileage + spanLen * t;
        // 吊弦长度：跨中长、两端短（抛物线）
        const sag = (inside ? 25 : 55) * 4 * t * (1 - t);
        const length = Math.round(structural - sag + (random() - 0.5) * 12);
        droppers.push({
          id: `${prev.id}-d-${k}`,
          poleFromId: prev.id,
          mileage: Math.round(dMileage * 10) / 10,
          length: Math.max(120, length),
        });
      }
    }
  }
  return { poles, droppers, anchors, curves };
}

// 隧道里程表（与 buildTunnels 保持一致）
const TUNNEL_RANGES: Array<[number, number]> = [
  [10500, 12800],
  [22800, 25900],
  [36200, 38000],
  [46800, 49000],
];
function isInsideTunnel(m: number): boolean {
  return TUNNEL_RANGES.some(([s, e]) => m >= s && m < e);
}

/** 生成一条双线线路档案 */
export function buildLineProfile(seed = 20260901): LineProfile {
  const lineId = 'L-DEMO';
  const random = rng(seed);
  const tunnels = buildTunnels(lineId);
  const up = buildDirection(lineId, 'up', random);
  const down = buildDirection(lineId, 'down', random);

  return {
    id: lineId,
    name: '示范城际铁路 S1 线',
    code: 'S1',
    totalLength: LINE_LENGTH,
    designHeight: DESIGN_HEIGHT,
    designStagger: DESIGN_STAGGER,
    spanNominal: SPAN_NOMINAL,
    poles: [...up.poles, ...down.poles],
    droppers: [...up.droppers, ...down.droppers],
    anchors: [...up.anchors, ...down.anchors],
    curves: [...up.curves, ...down.curves],
    tunnels,
  };
}
