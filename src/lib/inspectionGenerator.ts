import type { Direction, InspectionBatch, LineProfile, MileageIssue, RawCsvRow } from '../types';
import { designContactHeight, designStagger, isInTunnel, nearestPole } from './catenary';
import { rng } from './lineGenerator';

export const SAMPLE_STEP = 0.25; // 检测车采样间距 m

/** 桩位标记（检测车过杆时的记录） */
export interface PoleMark {
  poleId: string;
  poleNo: string;
  truthMileage: number; // 真实里程
  rawMileage: number; // 带漂移的原始里程
}

/** 预埋缺陷（真值，供测试核对，不进入业务库） */
export interface SeededDefect {
  batchId: string;
  truthMileage: number;
  poleId: string;
  metric: 'height' | 'stagger';
  deviationMm: number;
  month: number;
}

export interface GeneratedBatch {
  batch: InspectionBatch;
  rows: RawCsvRow[];
  marks: PoleMark[];
  defects: SeededDefect[];
  /** 真值：rawMileage -> truthMileage（仅验证脚本用） */
  truthMap: Array<{ raw: number; truth: number }>;
}

// ---- 漂移模型 -----------------------------------------------------------
// 0~28km：缓慢累积漂移，最大 +18m（检测车轮径磨耗，里程脉冲偏多）
// 28km 处：-12m 跳变（换端/信号丢失后里程未同步）
// 36km 处：重置回真实值（司机手动里程校正）
// 41.2~41.8km：数据断点（采集中断 600m）
const DRIFT_KNOTS: Array<[number, number]> = [
  [0, 0],
  [6000, 4],
  [14000, 11],
  [22000, 16],
  [28000, 18],
];
const JUMP_AT = 28000;
const JUMP_OFFSET = -12; // 跳变后漂移函数整体下移 12m
const RESET_AT = 36000;
const GAP_START = 41200;
const GAP_END = 41800;

function driftOffset(truthM: number): number {
  if (truthM < JUMP_AT) {
    return piecewiseLinear(DRIFT_KNOTS, truthM);
  }
  if (truthM < RESET_AT) {
    // 跳变后继续按原斜率漂移
    const base = piecewiseLinear(DRIFT_KNOTS, Math.min(truthM, 28000));
    const slope = (18 - 16) / (28000 - 22000);
    return base + slope * (truthM - JUMP_AT) + JUMP_OFFSET;
  }
  if (truthM < GAP_START) {
    // 重置后残留小漂移 0 → 2m
    return (2 * (truthM - RESET_AT)) / (GAP_START - RESET_AT);
  }
  // 断点之后重新产生小幅漂移 3 → 5m
  if (truthM >= GAP_END) {
    return 3 + (2 * Math.min(1, (truthM - GAP_END) / 6000));
  }
  return 0; // 断区间无数据
}

function piecewiseLinear(knots: Array<[number, number]>, m: number): number {
  if (m <= knots[0][0]) return knots[0][1];
  for (let i = 0; i < knots.length - 1; i++) {
    const [m0, v0] = knots[i];
    const [m1, v1] = knots[i + 1];
    if (m <= m1) return v0 + ((v1 - v0) * (m - m0)) / (m1 - m0);
  }
  return knots[knots.length - 1][1];
}

function gauss(random: () => number, sigma: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma;
}

// ---- 渐变定位点（趋势对比用）--------------------------------------------
// 每月持续下沉/抬升的定位点
const TREND_POLES: Array<[number, 'height' | 'stagger', number]> = [
  // [真值里程 km, 指标, 每月变化 mm]
  [7.4, 'height', -8], // 持续下沉
  [17.9, 'height', -6],
  [30.6, 'stagger', 12], // 拉出值持续跑向一侧
  [43.3, 'height', 7], // 持续抬升
];

// ---- 单批次生成 ---------------------------------------------------------
export function generateBatch(
  profile: LineProfile,
  direction: Direction,
  month: number, // 0,1,2
  seedBase: number,
): GeneratedBatch {
  const random = rng(seedBase + month * 997 + (direction === 'up' ? 0 : 31337));
  const poles = profile.poles.filter((p) => p.direction === direction);
  const inspectDate = `2026-${String(7 + month).padStart(2, '0')}-${month === 0 ? '18' : month === 1 ? '15' : '12'}`;
  const batchId = `B-${direction}-2026${String(7 + month).padStart(2, '0')}`;

  // 本批次缺陷：固定缺陷点（每月重复，第三个月修好一部分）+ 随机缺陷
  // 注：拉出值限界是绝对值（一级 400/二级 450），而设计之字形本身在 ±300 变化，
  // 故拉出缺陷需让实测绝对值越过 400/450 才能触发；导高是相对设计曲线的偏差限界。
  const fixedDefectPlan: Array<[number, 'height' | 'stagger', number, number]> = [
    // [真值里程 km, 指标, 初始偏差 mm, 持续到的月份(-1=全部)]
    [5.2, 'height', 38, -1], // 导高一级，持续未修
    [12.6, 'stagger', 160, 1], // 拉出二级（叠加设计值越过 450），第 2 月后修复
    [20.3, 'height', 72, -1], // 导高二级，持续
    [27.1, 'stagger', 130, -1], // 拉出一级，持续
    [33.8, 'height', 42, -1], // 导高一级
    [38.9, 'stagger', 170, 2], // 拉出二级
  ];

  const defects: SeededDefect[] = [];
  const rows: RawCsvRow[] = [];
  const marks: PoleMark[] = [];
  const truthMap: Array<{ raw: number; truth: number }> = [];

  const poleAt = (m: number) => nearestPole(poles, m);
  const trendAt = (m: number) => {
    let h = 0;
    let s = 0;
    for (const [km, metric, perMonth] of TREND_POLES) {
      const d = Math.abs(m - km * 1000);
      if (d < 45) {
        const w = 1 - d / 45; // 影响窗口约一个跨距
        if (metric === 'height') h += perMonth * month * w;
        else s += perMonth * month * w;
      }
    }
    return { h, s };
  };

  const fixedDefectAt = (m: number): { h: number; s: number } => {
    let h = 0;
    let s = 0;
    for (const [km, metric, dev, until] of fixedDefectPlan) {
      if (until !== -1 && month > until) continue;
      const d = Math.abs(m - km * 1000);
      if (d < 30) {
        // 中心 ±10m 为缺陷平台（保证定位点峰值达到额定偏差，能触发对应等级），
        // 10~30m 线性衰减到 0，模拟缺陷向两侧跨距的影响
        const w = d <= 10 ? 1 : 1 - (d - 10) / 20;
        // 缺陷每月略发展（+5%/月）
        const grow = 1 + month * 0.05;
        if (metric === 'height') {
          h += dev * grow * w;
        } else {
          // 拉出缺陷朝该里程设计拉出值的同号方向放大，确保实测绝对值真正越过限界
          const sign = designStagger(profile, km * 1000, direction) >= 0 ? 1 : -1;
          s += sign * dev * grow * w;
        }
      }
    }
    return { h, s };
  };

  // 预生成桩位 raw 里程表（杆号必须挂到「同一连续块」内的采样行，
  // 否则跳变两侧 raw 区间重叠时会跨块错配）
  for (const p of poles) {
    if (p.mileage > GAP_START && p.mileage < GAP_END) continue;
    marks.push({
      poleId: p.id,
      poleNo: p.poleNo,
      truthMileage: p.mileage,
      rawMileage: p.mileage + driftOffset(p.mileage) + gauss(random, 0.3),
    });
  }

  const n = Math.floor(profile.totalLength / SAMPLE_STEP);
  for (let i = 0; i <= n; i++) {
    const truth = i * SAMPLE_STEP;
    if (truth >= GAP_START && truth < GAP_END) continue; // 断点
    const offset = driftOffset(truth);
    const raw = truth + offset + gauss(random, 0.15);
    truthMap.push({ raw, truth });

    const inTunnel = isInTunnel(profile, truth);
    const baseH = designContactHeight(profile, truth, inTunnel, direction);
    const baseS = designStagger(profile, truth, direction);
    const trend = trendAt(truth);
    const defect = fixedDefectAt(truth);

    // 测量噪声：导高 σ=2.5mm，拉出 σ=3mm；隧道内略大
    const noiseH = gauss(random, inTunnel ? 3.2 : 2.5);
    const noiseS = gauss(random, inTunnel ? 3.8 : 3.0);

    const contactHeight = Math.round(baseH + trend.h + defect.h + noiseH);
    const stagger = Math.round(baseS + trend.s + defect.s + noiseS);

    rows.push({
      rawMileage: Math.round(raw * 100) / 100,
      poleNo: '',
      contactHeight,
      stagger,
      inTunnel,
    });
    truthMap[truthMap.length - 1].raw = rows[rows.length - 1].rawMileage;
  }

  // 杆号挂接：数据块按真值里程切分（与断点/跳变的物理位置一致），
  // 桩位按自身真值里程确定所属块，只在该块的采样行内按 raw 就近匹配，
  // 从根本上避免跳变两侧 raw 区间重叠导致的跨块错配。
  const truthBlockId = (truthM: number): number => {
    let id = 0;
    if (truthM >= JUMP_AT) id += 1;
    if (truthM >= RESET_AT) id += 1;
    if (truthM >= GAP_END) id += 1;
    return id;
  };
  const blockRowsGen = new Map<number, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const truth = truthMap[i].truth;
    const id = truthBlockId(truth);
    const arr = blockRowsGen.get(id) ?? [];
    arr.push(i);
    blockRowsGen.set(id, arr);
  }
  for (const mark of marks) {
    const id = truthBlockId(mark.truthMileage);
    const indices = blockRowsGen.get(id);
    if (!indices) continue;
    let best = -1;
    let bestD = Infinity;
    for (const i of indices) {
      const d = Math.abs(rows[i].rawMileage - mark.rawMileage);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0 && bestD < 1.5 && !rows[best].poleNo) {
      rows[best].poleNo = mark.poleNo;
    }
  }

  // 记录预埋缺陷（落在定位点附近的才登记，便于工单闭环验证）
  for (const [km, metric, dev, until] of fixedDefectPlan) {
    if (until !== -1 && month > until) continue;
    const m = km * 1000;
    if (m >= GAP_START && m < GAP_END) continue;
    const pole = poleAt(m);
    defects.push({
      batchId,
      truthMileage: pole.mileage,
      poleId: pole.id,
      metric,
      deviationMm: Math.round(dev * (1 + month * 0.05)),
      month,
    });
  }

  const issues: MileageIssue[] = [
    {
      kind: 'drift',
      rawStartMileage: 0,
      rawEndMileage: JUMP_AT + 18,
      correctedOffset: 0,
      detail: '0~28km 里程持续漂移，末端累积 +18m（轮径磨耗特征）',
    },
    {
      kind: 'jump',
      rawStartMileage: JUMP_AT + 18,
      rawEndMileage: JUMP_AT + 18 + JUMP_OFFSET,
      correctedOffset: JUMP_OFFSET,
      detail: 'K28 处里程跳变 -12m（换端后里程未同步）',
    },
    {
      kind: 'drift',
      rawStartMileage: JUMP_AT,
      rawEndMileage: RESET_AT,
      correctedOffset: 0,
      detail: 'K28~K36 跳变后继续线性漂移',
    },
    {
      kind: 'jump',
      rawStartMileage: RESET_AT + 6,
      rawEndMileage: RESET_AT,
      correctedOffset: -6,
      detail: 'K36 处人工里程校正，漂移重置',
    },
    {
      kind: 'gap',
      rawStartMileage: GAP_START + driftOffset(GAP_START),
      rawEndMileage: GAP_END + driftOffset(GAP_END),
      correctedOffset: 0,
      detail: 'K41+200~K41+800 采集断点，缺失 600m',
    },
  ];

  const batch: InspectionBatch = {
    id: batchId,
    name: `${direction === 'up' ? '上行' : '下行'} 2026年${7 + month}月检测`,
    lineId: profile.id,
    direction,
    inspectDate,
    importedAt: 0,
    sampleStep: SAMPLE_STEP,
    sampleCount: rows.length,
    mileageIssues: issues,
  };

  return { batch, rows, marks, defects, truthMap };
}

/** 生成三个月 × 上下行共 6 个批次 */
export function generateAllBatches(profile: LineProfile): GeneratedBatch[] {
  const out: GeneratedBatch[] = [];
  for (const direction of ['up', 'down'] as Direction[]) {
    for (let month = 0; month < 3; month++) {
      out.push(generateBatch(profile, direction, month, 20260901));
    }
  }
  return out;
}
