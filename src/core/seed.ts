// ============================================================
// 演示数据生成器：50km 双线、曲线/隧道、三个月检测数据，
// 故意植入尺度漂移、平滑游走、里程跳变、主机重置与数据断点。
// 所有随机均为确定性种子，对齐自检脚本可复现。
// ============================================================

import type {
  AnchorSection,
  CurveInfo,
  DetectionBatch,
  DetectionRun,
  Defect,
  DropperInfo,
  LineInfo,
  LocatorInfo,
  Pole,
  PoleMark,
  Settings,
  TunnelInfo,
  WorkOrder,
} from './types';
import { DEFAULT_SETTINGS } from './types';
import { mulberry32, gaussian, hashSeed } from './rng';
import { alignRun } from './alignment';
import { judgeRun } from './judge';
import { verifyRepair } from './workorder';
import { fmtMileage, uid } from './format';

export interface GeneratedData {
  line: LineInfo;
  poles: Pole[];
  anchors: AnchorSection[];
  curves: CurveInfo[];
  tunnels: TunnelInfo[];
  locators: LocatorInfo[];
  droppers: DropperInfo[];
  batches: DetectionBatch[];
  runs: DetectionRun[];
  defects: Defect[];
  workOrders: WorkOrder[];
  settings: Settings;
}

const LENGTH = 50000;
const DS = 1;

interface StorySite {
  key: string;
  poleIndex: number; // 0-based 支柱序号
  metric: 'height' | 'pull';
  amps: [number, number, number]; // 三个月的附加幅值 mm（height 负=低）
  width: number;
}

export function generateDataset(): GeneratedData {
  const line: LineInfo = {
    id: 'line',
    name: '云岭线',
    code: 'YL',
    totalLength: LENGTH,
    designHeight: 6000,
    designStagger: 250,
    trackSpacing: 5.0,
    spanNominal: 50,
    updatedAt: Date.now(),
  };

  const curves: CurveInfo[] = [
    { id: 'cv1', code: 'Q1', start: 3200, end: 4800, radius: 1800, direction: 'right', tracks: 'both' },
    { id: 'cv2', code: 'Q2', start: 8500, end: 10100, radius: 1200, direction: 'left', tracks: 'both' },
    { id: 'cv3', code: 'Q3', start: 14000, end: 15600, radius: 2500, direction: 'right', tracks: 'both' },
    { id: 'cv4', code: 'Q4', start: 19800, end: 22300, radius: 900, direction: 'left', tracks: 'both' },
    { id: 'cv5', code: 'Q5', start: 27000, end: 28400, radius: 2000, direction: 'right', tracks: 'both' },
    { id: 'cv6', code: 'Q6', start: 33500, end: 36200, radius: 1500, direction: 'left', tracks: 'both' },
    { id: 'cv7', code: 'Q7', start: 41000, end: 42600, radius: 3000, direction: 'right', tracks: 'both' },
    { id: 'cv8', code: 'Q8', start: 46500, end: 48200, radius: 1100, direction: 'left', tracks: 'both' },
  ];

  const tunnels: TunnelInfo[] = [
    { id: 'tn1', name: '黑山隧道', start: 6000, end: 8100 },
    { id: 'tn2', name: '长风隧道', start: 16800, end: 19600 },
    { id: 'tn3', name: '云岭隧道', start: 30200, end: 33800 },
    { id: 'tn4', name: '石门隧道', start: 43800, end: 46100 },
  ];

  // ---------------- 支柱 / 锚段 / 定位器 / 吊弦 ----------------
  const poles: Pole[] = [];
  const anchors: AnchorSection[] = [];
  const locators: LocatorInfo[] = [];
  const droppers: DropperInfo[] = [];
  const polesByTrack: Record<'up' | 'down', Pole[]> = { up: [], down: [] };

  (['up', 'down'] as const).forEach((track) => {
    const prefix = track === 'up' ? 'S' : 'X';
    const rnd = mulberry32(hashSeed(`archive-${track}`));
    const list: Pole[] = [];
    let m = 26 + rnd() * 10;
    let idx = 1;
    while (m < LENGTH - 26) {
      const code = `${prefix}${String(idx).padStart(4, '0')}`;
      const pole: Pole = {
        id: `pole-${track}-${idx}`,
        track,
        code,
        mileage: Math.round(m * 100) / 100,
        side: track === 'up' ? 'left' : 'right',
      };
      list.push(pole);
      poles.push(pole);

      // 定位器：之字值正负交替 + 少量随机
      const alt = idx % 2 === 0 ? 1 : -1;
      const stagger = Math.round(alt * (215 + rnd() * 55));
      locators.push({
        id: `loc-${track}-${idx}`,
        track,
        poleCode: code,
        mileage: pole.mileage,
        type: rnd() < 0.5 ? '限位定位器' : '普通定位器',
        designStagger: stagger,
      });

      idx++;
      m += 46 + rnd() * 8; // 跨距 46~54m
    }
    // spanNext
    for (let i = 0; i < list.length; i++) {
      list[i].spanNext = i < list.length - 1 ? Math.round((list[i + 1].mileage - list[i].mileage) * 10) / 10 : undefined;
    }
    polesByTrack[track] = list;

    // 锚段：每 22~27 跨一个锚段
    let ai = 0;
    let p = 0;
    while (p < list.length - 1) {
      const spanCount = Math.min(22 + Math.floor(rnd() * 6), list.length - 1 - p);
      if (spanCount < 6) break;
      const from = list[p];
      const to = list[p + spanCount];
      const code = `${prefix}M${String(ai + 1).padStart(2, '0')}`;
      const anchor: AnchorSection = {
        id: `anc-${track}-${ai + 1}`,
        track,
        code,
        fromPoleCode: from.code,
        toPoleCode: to.code,
        fromMileage: from.mileage,
        toMileage: to.mileage,
        spanCount,
        length: Math.round((to.mileage - from.mileage) * 10) / 10,
        tensionKN: 20 + Math.round(rnd() * 6),
      };
      anchors.push(anchor);
      for (let k = p; k <= p + spanCount; k++) list[k].anchorCode = code;

      // 每个跨距 5 根吊弦
      for (let k = p; k < p + spanCount; k++) {
        const a = list[k];
        const b = list[k + 1];
        for (let d = 1; d <= 5; d++) {
          const frac = d / 6 + gaussian(rnd, 0, 0.006);
          const dm = a.mileage + (b.mileage - a.mileage) * frac;
          droppers.push({
            id: `drp-${track}-${a.code}-${d}`,
            track,
            anchorCode: code,
            spanFromPole: a.code,
            mileage: Math.round(dm * 100) / 100,
            indexInSpan: d,
          });
        }
      }

      p += spanCount;
      ai++;
    }
  });

  // ---------------- 三个月批次 ----------------
  const batchDefs = [
    { id: 'batch-2026-09', name: '2026年9月月度检测', date: '2026-09-18', monthIndex: 0 },
    { id: 'batch-2026-10', name: '2026年10月月度检测', date: '2026-10-16', monthIndex: 1 },
    { id: 'batch-2026-11', name: '2026年11月月度检测', date: '2026-11-13', monthIndex: 2 },
  ];
  const batches: DetectionBatch[] = batchDefs.map((b) => ({
    ...b,
    source: 'seed' as const,
    note: '接触网检测车月度巡检（演示数据，含人为植入的里程漂移）',
    createdAt: new Date(b.date).getTime(),
  }));

  // 趋势/维修故事点（支柱序号）
  const stories: Record<'up' | 'down', StorySite[]> = {
    up: [
      { key: 'up-trend-pull', poleIndex: 160, metric: 'pull', amps: [150, 200, 248], width: 4.5 },
      { key: 'up-repair-height', poleIndex: 420, metric: 'height', amps: [-96, -5, -7], width: 3.2 },
      { key: 'up-persist-pull', poleIndex: 700, metric: 'pull', amps: [205, 218, 212], width: 5.5 },
    ],
    down: [
      { key: 'down-trend-height', poleIndex: 240, metric: 'height', amps: [-18, -56, -96], width: 3.8 },
      { key: 'down-repair-pull', poleIndex: 560, metric: 'pull', amps: [268, 8, 10], width: 4.2 },
    ],
  };

  const runs: DetectionRun[] = [];
  const defectsAll: Defect[] = [];

  for (const track of ['up', 'down'] as const) {
    const tpoles = polesByTrack[track];
    for (let mi = 0; mi < 3; mi++) {
      const run = buildRun({
        track,
        monthIndex: mi,
        batchId: batchDefs[mi].id,
        poles: tpoles,
        locators: locators.filter((l) => l.track === track),
        stories: stories[track],
      });
      runs.push(run);
      const ds = judgeRun({
        run,
        batchId: batchDefs[mi].id,
        track,
        limits: DEFAULT_SETTINGS.limits,
        poles: tpoles,
        anchors: anchors.filter((a) => a.track === track),
        designHeight: line.designHeight,
        designStagger: line.designStagger,
      });
      // 标记故事点 trendKey 稳定化
      for (const d of ds) {
        const story = stories[track].find((s) => {
          const sm = tpoles[Math.min(s.poleIndex, tpoles.length - 1)].mileage;
          return Math.abs(d.mileage - sm) < 15 && d.metric === s.metric;
        });
        if (story) d.trendKey = story.key;
      }
      defectsAll.push(...ds);
    }
  }

  // ---------------- 维修工单（含自动复核） ----------------
  const workOrders: WorkOrder[] = [];
  const dateOf = (batchId: string) => batches.find((b) => b.id === batchId)?.date;

  const findStoryDefect = (key: string, monthIndex: number): Defect | undefined => {
    const story = [...stories.up, ...stories.down].find((s) => s.key === key)!;
    const track = key.startsWith('up') ? 'up' : 'down';
    const pm = polesByTrack[track][Math.min(story.poleIndex, polesByTrack[track].length - 1)].mileage;
    const batchId = batchDefs[monthIndex].id;
    return defectsAll
      .filter((d) => d.batchId === batchId && d.track === track && d.metric === story.metric)
      .sort((a, b) => Math.abs(a.mileage - pm) - Math.abs(b.mileage - pm))[0];
  };

  // WO-001 上行导高二级，9 月整治，10 月检测自动复核通过
  const d1 = findStoryDefect('up-repair-height', 0);
  if (d1) {
    const finishedAt = new Date('2026-09-30T15:00:00').getTime();
    const wo: WorkOrder = {
      id: 'wo-001',
      code: 'GD-2026-1001',
      defectIds: [d1.id],
      track: 'up',
      mileage: d1.mileage,
      poleCode: d1.poleCode,
      anchorCode: d1.anchorCode,
      title: `上行 ${fmtMileage(d1.mileage)} 接触线导高过低（二级）整治`,
      assignee: '宁州接触网一工区',
      priority: 2,
      status: 'done',
      createdAt: new Date('2026-09-19T09:00:00').getTime(),
      plannedDate: '2026-09-28',
      measure: '调整该定位点两侧吊弦长度，校核定位器坡度，将导高恢复至 6000mm 设计值。',
      result: '更换受力吊弦 2 根，调整吊弦 6 根，复测导高 5998~6012mm，拉出值正常。',
      finishedAt,
    };
    const v = verifyRepair({
      track: 'up',
      mileage: d1.mileage,
      metric: 'height',
      beforeValue: Math.abs(d1.deviation),
      finishedAt,
      runs,
      batchDateOf: dateOf,
      settings: DEFAULT_SETTINGS.limits,
      designHeight: line.designHeight,
      designStagger: line.designStagger,
    });
    if (v) wo.verification = v;
    workOrders.push(wo);
    d1.status = 'verified';
    d1.workOrderId = wo.id;
  }

  // WO-002 下行拉出值二级，10 月前整治，10 月复核通过
  const d2 = findStoryDefect('down-repair-pull', 0);
  if (d2) {
    const finishedAt = new Date('2026-10-09T11:00:00').getTime();
    const wo: WorkOrder = {
      id: 'wo-002',
      code: 'GD-2026-1002',
      defectIds: [d2.id],
      track: 'down',
      mileage: d2.mileage,
      poleCode: d2.poleCode,
      anchorCode: d2.anchorCode,
      title: `下行 ${fmtMileage(d2.mileage)} 拉出值超标（二级）调整定位器`,
      assignee: '云岭接触网二工区',
      priority: 2,
      status: 'done',
      createdAt: new Date('2026-09-20T10:30:00').getTime(),
      plannedDate: '2026-10-08',
      measure: '松开定位线夹，按设计之字值重调定位器拉出值至 ±250mm，紧固并复测。',
      result: '定位器根部偏移，重新调整后拉出值 262mm，力矩达标。',
      finishedAt,
    };
    const v = verifyRepair({
      track: 'down',
      mileage: d2.mileage,
      metric: 'pull',
      beforeValue: Math.abs(d2.deviation),
      finishedAt,
      runs,
      batchDateOf: dateOf,
      settings: DEFAULT_SETTINGS.limits,
      designHeight: line.designHeight,
      designStagger: line.designStagger,
    });
    if (v) wo.verification = v;
    workOrders.push(wo);
    d2.status = 'verified';
    d2.workOrderId = wo.id;
  }

  // WO-003 上行持续拉出超限，处理中（关联 10 月缺陷）
  const d3 = findStoryDefect('up-persist-pull', 1) ?? findStoryDefect('up-persist-pull', 0);
  if (d3) {
    const wo: WorkOrder = {
      id: 'wo-003',
      code: 'GD-2026-1103',
      defectIds: [d3.id],
      track: 'up',
      mileage: d3.mileage,
      poleCode: d3.poleCode,
      anchorCode: d3.anchorCode,
      title: `上行 ${d3.poleCode ?? ''} 定位点拉出值连续偏大，申请天窗处理`,
      assignee: '宁州接触网一工区',
      priority: 1,
      status: 'processing',
      createdAt: new Date('2026-10-18T14:00:00').getTime(),
      plannedDate: '2026-11-28',
      measure: '拟更换偏移定位器底座并重新标定之字值。',
    };
    workOrders.push(wo);
    d3.status = 'processing';
    d3.workOrderId = wo.id;
    // 同步关联其它月份同 trendKey 缺陷
    for (const d of defectsAll) {
      if (d.trendKey === d3.trendKey && d.id !== d3.id && !d.workOrderId) {
        d.workOrderId = wo.id;
        if (d.status === 'open') d.status = 'ordered';
        if (!wo.defectIds.includes(d.id)) wo.defectIds.push(d.id);
      }
    }
  }

  // WO-004 由 11 月最新二级趋势点生成的待处理工单
  const d4 = findStoryDefect('up-trend-pull', 2);
  if (d4) {
    const wo: WorkOrder = {
      id: 'wo-004',
      code: 'GD-2026-1108',
      defectIds: [d4.id],
      track: 'up',
      mileage: d4.mileage,
      poleCode: d4.poleCode,
      anchorCode: d4.anchorCode,
      title: `上行 ${d4.poleCode ?? ''} 定位点拉出值持续恶化至二级，紧急整治`,
      assignee: '宁州接触网一工区',
      priority: 2,
      status: 'created',
      createdAt: new Date('2026-11-14T08:30:00').getTime(),
      plannedDate: '2026-11-29',
    };
    workOrders.push(wo);
    d4.status = 'ordered';
    d4.workOrderId = wo.id;
  }
  const d5 = findStoryDefect('down-trend-height', 2);
  if (d5) {
    const wo: WorkOrder = {
      id: 'wo-005',
      code: 'GD-2026-1109',
      defectIds: [d5.id],
      track: 'down',
      mileage: d5.mileage,
      poleCode: d5.poleCode,
      anchorCode: d5.anchorCode,
      title: `下行 ${d5.poleCode ?? ''} 附近导高持续走低至二级`,
      assignee: '云岭接触网二工区',
      priority: 2,
      status: 'created',
      createdAt: new Date('2026-11-14T09:10:00').getTime(),
      plannedDate: '2026-11-30',
    };
    workOrders.push(wo);
    d5.status = 'ordered';
    d5.workOrderId = wo.id;
  }

  return {
    line,
    poles,
    anchors,
    curves,
    tunnels,
    locators,
    droppers,
    batches,
    runs,
    defects: defectsAll,
    workOrders,
    settings: { ...DEFAULT_SETTINGS },
  };
}

// ============================================================
// 单次检测 run 构造
// ============================================================

interface BuildRunArgs {
  track: 'up' | 'down';
  monthIndex: number;
  batchId: string;
  poles: Pole[];
  locators: LocatorInfo[];
  stories: StorySite[];
}

function buildRun(args: BuildRunArgs): DetectionRun {
  const { track, monthIndex, batchId, poles, locators, stories } = args;
  const rnd = mulberry32(hashSeed(`run-${track}-${monthIndex}`));
  const N = Math.floor(LENGTH / DS) + 1;

  // ---- 漂移模型 ----
  const epsMag = 0.0004 + rnd() * 0.0005;
  const eps = epsMag * (rnd() < 0.5 ? -1 : 1);
  const off0 = (rnd() - 0.5) * 6;
  const A1 = 1.5 + rnd() * 2.2;
  const L1 = 7000 + rnd() * 8000;
  const ph1 = rnd() * Math.PI * 2;
  const A2 = 0.5 + rnd() * 1.1;
  const L2 = 2400 + rnd() * 3200;
  const ph2 = rnd() * Math.PI * 2;

  const driftSmooth = (m: number) =>
    off0 + eps * m + A1 * Math.sin((2 * Math.PI * m) / L1 + ph1) + A2 * Math.sin((2 * Math.PI * m) / L2 + ph2);

  // 3 个里程跳变（位置取两杆中点）；其中一个 run 植入大幅负跳变（主机重置）
  const jumps: Array<{ at: number; amount: number }> = [];
  const jumpPoleIdx = [
    90 + Math.floor(rnd() * 60),
    380 + Math.floor(rnd() * 80),
    640 + Math.floor(rnd() * 120),
  ];
  jumpPoleIdx.forEach((pi, k) => {
    const a = poles[Math.min(pi, poles.length - 2)];
    const b = poles[Math.min(pi + 1, poles.length - 1)];
    if (!a || !b) return;
    const at = (a.mileage + b.mileage) / 2;
    let amount: number;
    if (track === 'down' && monthIndex === 1 && k === 1) {
      amount = -31 - rnd() * 4; // 大负跳变 → 采样里程倒退
    } else {
      amount = (5 + rnd() * 9) * (rnd() < 0.5 ? -1 : 1);
    }
    jumps.push({ at, amount });
  });
  jumps.sort((x, y) => x.at - y.at);

  // 一个数据断点（缺口），半数带缺口后里程基准错位
  const gapStartM = 12000 + rnd() * 26000;
  const gapLen = 45 + rnd() * 110;
  const gapReset = rnd() < 0.5 ? (6 + rnd() * 8) * (rnd() < 0.5 ? -1 : 1) : 0;
  if (gapReset !== 0) jumps.push({ at: gapStartM + gapLen, amount: gapReset });

  const driftAt = (m: number) => {
    let d = driftSmooth(m);
    for (const j of jumps) if (m >= j.at) d += j.amount;
    return d;
  };

  // ---- 设计之字线 ----
  const staggerAtPole = new Map<string, number>();
  for (const l of locators) staggerAtPole.set(l.poleCode, l.designStagger);
  const designPull = (m: number): number => {
    // 找相邻杆
    let lo = 0;
    let hi = poles.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (poles[mid].mileage < m) lo = mid + 1;
      else hi = mid;
    }
    const i1 = Math.min(lo, poles.length - 1);
    const i0 = Math.max(0, i1 - 1);
    const p0 = poles[i0];
    const p1 = poles[i1];
    const s0 = staggerAtPole.get(p0.code) ?? 250;
    const s1 = staggerAtPole.get(p1.code) ?? -250;
    if (p1.mileage === p0.mileage) return s0;
    let t = (m - p0.mileage) / (p1.mileage - p0.mileage);
    t = Math.max(0, Math.min(1, t));
    const tt = t * t * (3 - 2 * t);
    return s0 + (s1 - s0) * tt;
  };

  // ---- 故事点 + 随机缺陷点 ----
  const siteDefs: Array<{ m: number; metric: 'height' | 'pull'; amp: number; width: number }> = [];
  for (const s of stories) {
    const p = poles[Math.min(s.poleIndex, poles.length - 1)];
    let amp = s.amps[monthIndex];
    if (s.metric === 'pull') {
      // 沿该定位点之字方向叠加，确保确实把拉出值推向超限
      const sign = Math.sign(designPull(p.mileage)) || 1;
      amp = amp * sign;
    }
    siteDefs.push({ m: p.mileage, metric: s.metric, amp, width: s.width });
  }
  // 随机缺陷（每月每线 7 处）
  for (let k = 0; k < 7; k++) {
    const pi = 40 + Math.floor(rnd() * (poles.length - 80));
    const p = poles[pi];
    const metric: 'height' | 'pull' = rnd() < 0.5 ? 'height' : 'pull';
    const wantL2 = rnd() < 0.4;
    if (metric === 'height') {
      const amp = wantL2 ? -(85 + rnd() * 55) : -(44 + rnd() * 32);
      siteDefs.push({ m: p.mileage + gaussian(rnd, 0, 8), metric, amp, width: 2.5 + rnd() * 4 });
    } else {
      const sign = Math.sign(designPull(p.mileage)) || 1;
      const amp = sign * (wantL2 ? 250 + rnd() * 90 : 150 + rnd() * 70);
      siteDefs.push({ m: p.mileage + gaussian(rnd, 0, 8), metric, amp, width: 3 + rnd() * 5 });
    }
  }

  // ---- 逐米采样 ----
  const truth = new Float64Array(N);
  const raw = new Float64Array(N);
  const height = new Float32Array(N);
  const pull = new Float32Array(N);
  const speed = new Float32Array(N);

  const phA = rnd() * 6.28;
  const phB = rnd() * 6.28;
  const phC = rnd() * 6.28;

  for (let i = 0; i < N; i++) {
    const m = i * DS;
    truth[i] = m;
    raw[i] = m + driftAt(m);

    // 导高基准 + 平滑不平顺 + 跨内弛度
    let h = 6000;
    h += 7 * Math.sin(m / 920 + phA) + 3.2 * Math.sin(m / 217 + phB) + gaussian(rnd, 0, 1.6);
    const spanP = nearestSpanT(poles, m);
    if (spanP >= 0) h -= 5.5 * Math.sin(Math.PI * spanP) ** 2;
    for (const s of siteDefs) {
      if (s.metric !== 'height') continue;
      h += s.amp * Math.exp(-(((m - s.m) / s.width) ** 2));
    }
    height[i] = Math.round(h * 10) / 10;

    // 拉出值 = 设计之字 + 相关噪声 + 缺陷
    let p = designPull(m);
    p += 13 * Math.sin(m / 131 + phC) + 7 * Math.sin(m / 47 + phA) + gaussian(rnd, 0, 4);
    for (const s of siteDefs) {
      if (s.metric !== 'pull') continue;
      p += s.amp * Math.exp(-(((m - s.m) / s.width) ** 2));
    }
    pull[i] = Math.round(p * 10) / 10;

    speed[i] = Math.max(0, Math.min(120, 88 + 20 * Math.sin(m / 1500 + phB) + 7 * Math.sin(m / 97) + gaussian(rnd, 0, 1.5)));
  }

  // ---- 过杆标记（含噪声、少量漏杆、1 个未知杆号） ----
  const marks: PoleMark[] = [];
  poles.forEach((p, idx) => {
    if (rnd() < 0.004 && !stories.some((s) => s.poleIndex === idx)) return; // 0.4% 漏识别
    const row = Math.round(p.mileage / DS);
    if (row < 0 || row >= N) return;
    // 过杆事件有独立的（亚米级）里程，不覆盖整数米采样行，避免采样真值错位
    const rawAtPole = p.mileage + driftAt(p.mileage) + gaussian(rnd, 0, 0.05);
    marks.push({ rowIndex: row, code: p.code, rawMileage: rawAtPole });
  });
  // 未知杆号
  const unkRow = Math.floor(N * (0.2 + rnd() * 0.6));
  marks.push({
    rowIndex: unkRow,
    code: `${track === 'up' ? 'S' : 'X'}9${String(Math.floor(rnd() * 900) + 100)}`,
    rawMileage: raw[unkRow],
  });
  marks.sort((a, b) => a.rowIndex - b.rowIndex);

  // ---- 应用数据断点：删除 gap 区间采样，重映射行号 ----
  const g0 = Math.floor(gapStartM / DS);
  const g1 = Math.floor((gapStartM + gapLen) / DS);
  const kept: number[] = [];
  for (let i = 0; i < N; i++) if (i < g0 || i > g1) kept.push(i);
  const M = kept.length;
  const raw2 = new Float64Array(M);
  const truth2 = new Float64Array(M);
  const h2 = new Float32Array(M);
  const p2 = new Float32Array(M);
  const sp2 = new Float32Array(M);
  const oldToNew = new Int32Array(N).fill(-1);
  kept.forEach((oldI, newI) => {
    oldToNew[oldI] = newI;
    raw2[newI] = raw[oldI];
    truth2[newI] = truth[oldI];
    h2[newI] = height[oldI];
    p2[newI] = pull[oldI];
    sp2[newI] = speed[oldI];
  });
  const marks2: PoleMark[] = [];
  for (const mk of marks) {
    const ni = oldToNew[mk.rowIndex];
    if (ni < 0) continue; // 杆落在缺数段，丢弃
    marks2.push({ ...mk, rowIndex: ni });
  }

  // ---- 对齐 ----
  const { fixed, report } = alignRun({
    rawMileage: raw2,
    poleMarks: marks2,
    archivePoles: poles,
    truthMileage: truth2,
    tolerance: 0.5,
  });

  return {
    id: `${batchId}__${track}`,
    batchId,
    track,
    fileName: `catenary_${track}_${batchId}.csv`,
    importedAt: new Date(batchId.includes('09') ? '2026-09-18' : batchId.includes('10') ? '2026-10-16' : '2026-11-13').getTime(),
    pointCount: M,
    rawMileage: raw2,
    fixedMileage: fixed,
    height: h2,
    pull: p2,
    speed: sp2,
    poleMarks: marks2,
    report,
    truthMileage: truth2,
  };
}

/** 里程所在跨距的 t（0~1），用于跨内弛度 */
function nearestSpanT(poles: Pole[], m: number): number {
  let lo = 0;
  let hi = poles.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (poles[mid].mileage < m) lo = mid + 1;
    else hi = mid;
  }
  const i1 = Math.min(lo, poles.length - 1);
  const i0 = Math.max(0, i1 - 1);
  const a = poles[i0];
  const b = poles[i1];
  if (m < a.mileage || m > b.mileage || b.mileage === a.mileage) return -1;
  return (m - a.mileage) / (b.mileage - a.mileage);
}
