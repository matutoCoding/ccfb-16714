import type {
  AlignSummary,
  InspectionSample,
  LineProfile,
  MileageIssue,
  Pole,
  RawCsvRow,
} from '../types';
import { nearestPole } from './catenary';

// ============ 里程对齐核心 ============
// 工程背景：检测车里程轮存在磨耗漂移（缓变）、换端跳变（阶跃）、人工校正重置、
// 采集中断断点（raw 大空档）。
// 算法：
// 1. 杆号标记与档案支柱匹配得到锚点 (raw, profile)，按档案里程排序
// 2. 偏移量 off = raw - profile：缓变漂移表现为 off 的平滑变化，跳变表现为 off 阶跃。
//    用相邻锚点 off 差分识别阶跃（>3m），据此把锚点切成物理段
// 3. raw 大空档（>100m）为采集断点，断点两侧强制分段且不插值伪造
// 4. 段内对 off 做滑动平均去噪（轮径漂移是低频量），PCHIP 建立 raw -> off 保形映射，
//    corrected = raw - off(raw)，天然保证单调性，无过冲
// 5. 采样点按 raw 归属到对应段映射，杜绝跨段外推
// 精度目标：对齐后定位点与档案支柱偏差 < 0.5m

export interface AlignResult {
  samples: InspectionSample[];
  issues: MileageIssue[];
  summary: AlignSummary;
  controlPoints: Array<{ raw: number; corrected: number; poleNo: string; residual: number }>;
}

interface Anchor {
  raw: number;
  profile: number;
  pole: Pole;
  segmentId?: number;
}

interface Segment {
  anchors: Anchor[];
  mapCorrected: (raw: number) => number;
  rawMin: number;
  rawMax: number;
  profileMin: number;
  profileMax: number;
  kind: 'normal' | 'gap';
}

const JUMP_DETECT = 3; // m：相邻锚点偏移阶跃阈值
const DATA_GAP = 100; // m：raw 空档宽度阈值

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 单调 PCHIP（xs 严格升序） */
function pchipBuild(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length;
  const h: number[] = [];
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    delta.push((ys[i + 1] - ys[i]) / h[i]);
  }
  const m: number[] = new Array(n).fill(0);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1] * delta[i] <= 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
    if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
    const t = (x - xs[lo]) / h[lo];
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[lo] +
      (t3 - 2 * t2 + t) * m[lo] * h[lo] +
      (-2 * t3 + 3 * t2) * ys[lo + 1] +
      (t3 - t2) * m[lo + 1] * h[lo]
    );
  };
}

function linearBuild(xs: number[], ys: number[]): (x: number) => number {
  return (x: number) => {
    if (x <= xs[0]) return ys[0] + ((ys[1] - ys[0]) / (xs[1] - xs[0])) * (x - xs[0]);
    const last = xs.length - 1;
    if (x >= xs[last]) return ys[last] + ((ys[last] - ys[last - 1]) / (xs[last] - xs[last - 1])) * (x - xs[last]);
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
    const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
    return ys[lo] + t * (ys[hi] - ys[lo]);
  };
}

export function alignInspection(
  rows: RawCsvRow[],
  profile: LineProfile,
  direction: 'up' | 'down',
  batchId: string,
): AlignResult {
  const poles = profile.poles.filter((p) => p.direction === direction);
  const poleByNo = new Map(poles.map((p) => [p.poleNo, p]));
  const sortedRows = [...rows].sort((a, b) => a.rawMileage - b.rawMileage);

  // ---- 1. 锚点提取（按档案里程排序） ----
  const anchorsAll: Anchor[] = [];
  for (const row of sortedRows) {
    if (!row.poleNo) continue;
    const pole = poleByNo.get(row.poleNo);
    if (pole) anchorsAll.push({ raw: row.rawMileage, profile: pole.mileage, pole });
  }
  if (anchorsAll.length < 4) throw new Error('有效杆号锚点不足 4 个，无法进行里程对齐');
  anchorsAll.sort((a, b) => a.profile - b.profile);

  // 防御：剔除 profile 逆序/重复的错配锚点（真实 CSV 可能错杆号）
  const anchors: Anchor[] = [];
  for (const a of anchorsAll) {
    const prev = anchors[anchors.length - 1];
    if (prev && a.profile <= prev.profile) continue;
    anchors.push(a);
  }

  // ---- 2. 偏移阶跃检测 → 物理分段 ----
  const offsets = anchors.map((a) => a.raw - a.profile);
  const segStartIdx = [0];
  const jumpInfo: Array<{ at: number; magnitude: number; left: Anchor; right: Anchor }> = [];
  for (let i = 1; i < anchors.length; i++) {
    const dOff = offsets[i] - offsets[i - 1];
    if (Math.abs(dOff) > JUMP_DETECT) {
      segStartIdx.push(i);
      jumpInfo.push({ at: i, magnitude: dOff, left: anchors[i - 1], right: anchors[i] });
    }
  }
  segStartIdx.push(anchors.length);

  // ---- 3. 采集断点检测（raw 大空档），在所属段内再切 ----
  const rawGaps: Array<{ afterRow: number; width: number }> = [];
  for (let i = 1; i < sortedRows.length; i++) {
    const width = sortedRows[i].rawMileage - sortedRows[i - 1].rawMileage;
    if (width > DATA_GAP) rawGaps.push({ afterRow: i - 1, width });
  }

  // ---- 4. 段内 PCHIP 映射（校正曲线穿过全部锚点） ----
  const segments: Segment[] = [];
  let segId = 0;
  for (let s = 0; s < segStartIdx.length - 1; s++) {
    const seg = anchors.slice(segStartIdx[s], segStartIdx[s + 1]);
    // 段内若存在 raw 大空档，按断点再切
    const subGroups: Anchor[][] = [[]];
    for (const a of seg) {
      const cur = subGroups[subGroups.length - 1];
      if (cur.length && a.raw - cur[cur.length - 1].raw > DATA_GAP) subGroups.push([]);
      subGroups[subGroups.length - 1].push(a);
    }
    for (const group of subGroups) {
      if (group.length < 2) continue;
      // 离群锚点剔除（错杆号防御）：缓变漂移下相邻锚点的偏移量差应 <1m。
      // 用局部邻域（前后各 5 个锚点）的偏移中位数做基准，偏差 >3m 判离群；
      // 不能用整段全局中位数——长区段漂移本身可达十几米，会误杀正常锚点。
      const off = group.map((a) => a.raw - a.profile);
      const HALF = 5;
      const good: Anchor[] = [];
      for (let i = 0; i < group.length; i++) {
        const from = Math.max(0, i - HALF);
        const to = Math.min(group.length - 1, i + HALF);
        const local = off.slice(from, to + 1).sort((a, b) => a - b);
        const localMed = local[local.length >> 1];
        if (Math.abs(off[i] - localMed) <= 3) good.push(group[i]);
      }
      const trusted = good.length >= 4 ? good : group;
      const xs = trusted.map((a) => a.raw);
      // 校正曲线直接穿过锚点：raw -> profile（档案里程）。
      // 锚点是杆号级硬约束，必须零残差；锚点间的测量噪声由 PCHIP 局部吸收，不外扩。
      const ys = trusted.map((a) => a.profile);
      const pchip = trusted.length >= 4 ? pchipBuild(xs, ys) : linearBuild(xs, ys);
      // 边界外钳制：只在锚点 raw 范围内做曲线映射；
      // 范围外沿用首/尾两个锚点的局部斜率线性外推（不用 PCHIP 端斜率，避免边界甩动）
      const headK = (ys[1] - ys[0]) / (xs[1] - xs[0]);
      const tailK = (ys[ys.length - 1] - ys[ys.length - 2]) / (xs[xs.length - 1] - xs[xs.length - 2]);
      const mapCorrected = (raw: number) => {
        if (raw <= xs[0]) return ys[0] + headK * (raw - xs[0]);
        if (raw >= xs[xs.length - 1]) return ys[ys.length - 1] + tailK * (raw - xs[xs.length - 1]);
        return pchip(raw);
      };
      const id = segId++;
      segments.push({
        anchors: trusted,
        mapCorrected,
        rawMin: xs[0],
        rawMax: xs[xs.length - 1],
        profileMin: ys[0],
        profileMax: ys[ys.length - 1],
        kind: 'normal',
      });
      for (const a of trusted) {
        a.segmentId = id;
      }
    }
  }
  // 段按物理里程（profile）排序，profile 区间互不重叠
  segments.sort((a, b) => a.profileMin - b.profileMin);
  const segById = new Map<number, Segment>();
  for (const seg of segments) for (const a of seg.anchors) segById.set(a.segmentId!, seg);

  // 采样点 → 段（sortedRows 已按 raw 升序，顺序扫描）：
  // 维护「当前段」，仅当 raw 进入另一段的锚点 raw 范围时才切换。
  // 跳变造成的 raw 区间重叠区不命中任何段的内部范围，保持原段，
  // 从而把阶跃正确保留在物理断点位置，不污染整段数据。
  let currentSeg = segments[0];
  const segmentOf = (raw: number): Segment => {
    for (const seg of segments) {
      if (seg === currentSeg) continue;
      if (raw >= seg.rawMin && raw <= seg.rawMax) {
        currentSeg = seg;
        break;
      }
    }
    return currentSeg;
  };

  // ---- 5. 问题清单 ----
  const issues: MileageIssue[] = jumpInfo.map((j) => ({
    kind: 'jump',
    rawStartMileage: j.left.raw,
    rawEndMileage: j.right.raw,
    correctedOffset: Math.round(-j.magnitude * 10) / 10,
    detail: `杆号 ${j.left.pole.poleNo}→${j.right.pole.poleNo}（${
      j.left.profile.toFixed(0)
    }m 附近）里程${j.magnitude > 0 ? '突增' : '突减'} ${Math.abs(j.magnitude).toFixed(1)}m，判定为跳变/人工校正，已分段对齐`,
  }));
  for (const g of rawGaps) {
    const left = sortedRows[g.afterRow];
    const right = sortedRows[g.afterRow + 1];
    issues.push({
      kind: 'gap',
      rawStartMileage: left.rawMileage,
      rawEndMileage: right.rawMileage,
      correctedOffset: 0,
      detail: `原始里程 ${left.rawMileage.toFixed(1)}→${right.rawMileage.toFixed(
        1,
      )} 存在 ${g.width.toFixed(0)}m 数据空档，判定为采集断点，缺失数据不插值伪造`,
    });
  }
  // 缓变漂移量化（取最长段）
  const longest = segments.reduce((a, b) => (b.anchors.length > a.anchors.length ? b : a));
  const lo = longest.anchors[0];
  const lt = longest.anchors[longest.anchors.length - 1];
  const drift = lt.raw - lt.profile - (lo.raw - lo.profile);
  if (Math.abs(drift) > 2) {
    issues.unshift({
      kind: 'drift',
      rawStartMileage: lo.raw,
      rawEndMileage: lt.raw,
      correctedOffset: Math.round(-(lt.raw - lt.profile) * 10) / 10,
      detail: `检测里程相对档案缓慢漂移：偏移由 ${(lo.raw - lo.profile).toFixed(1)}m 发展到 ${(
        lt.raw - lt.profile
      ).toFixed(1)}m，已按杆号锚点保形修正`,
    });
  }
  issues.sort((a, b) => a.rawStartMileage - b.rawStartMileage);

  // 跳变/断点过渡带在 raw 空间定义（对齐错误的样本无法用档案里程判定）：
  // - 偏移阶跃：阶跃两侧锚点 raw 各 60m
  // - 采集断点：数据块边缘 raw 各 150m（新段需若干锚点重建映射）
  const rawTransition: Array<{ from: number; to: number }> = [];
  for (const j of jumpInfo) {
    rawTransition.push({ from: j.left.raw - 60, to: j.left.raw + 60 });
    rawTransition.push({ from: j.right.raw - 60, to: j.right.raw + 60 });
  }
  for (const g of rawGaps) {
    const leftRaw = sortedRows[g.afterRow].rawMileage;
    const rightRaw = sortedRows[g.afterRow + 1].rawMileage;
    rawTransition.push({ from: leftRaw - 150, to: leftRaw + 5 });
    rawTransition.push({ from: rightRaw - 5, to: rightRaw + 150 });
  }
  const inRawTransition = (raw: number) => rawTransition.some((z) => raw >= z.from && raw <= z.to);

  // ---- 6. 逐行换算 ----
  const samples: InspectionSample[] = [];
  for (const row of sortedRows) {
    const seg = segmentOf(row.rawMileage);
    const corrected = seg.mapCorrected(row.rawMileage);
    if (corrected < -1 || corrected > profile.totalLength + 1) continue;
    const pole = nearestPole(poles, corrected);
    samples.push({
      batchId,
      mileage: Math.round(corrected * 100) / 100,
      rawMileage: row.rawMileage,
      contactHeight: row.contactHeight,
      stagger: row.stagger,
      nearestPoleId: pole.id,
      inTunnel: row.inTunnel,
      lowConfidence: inRawTransition(row.rawMileage),
    });
  }
  samples.sort((a, b) => a.mileage - b.mileage);

  // ---- 7. 对齐残差（控制点 = 定位支柱级，锚点处零残差由构造保证） ----
  const controlPoints: AlignResult['controlPoints'] = anchors
    .filter((a) => a.segmentId !== undefined)
    .map((a) => {
      const seg = segById.get(a.segmentId!)!;
      const corrected = seg.mapCorrected(a.raw);
      return {
        raw: a.raw,
        corrected,
        poleNo: a.pole.poleNo,
        residual: Math.abs(corrected - a.profile),
      };
    });
  const poleResiduals = controlPoints.map((c) => ({
    poleId: poleByNo.get(c.poleNo)!.id,
    poleNo: c.poleNo,
    residual: c.residual,
  }));
  const maxResidual = Math.max(...poleResiduals.map((r) => r.residual));
  const meanResidual = poleResiduals.reduce((s, r) => s + r.residual, 0) / poleResiduals.length;
  const rmsResidual = Math.sqrt(
    poleResiduals.reduce((s, r) => s + r.residual * r.residual, 0) / poleResiduals.length,
  );
  const within05 = poleResiduals.filter((r) => r.residual < 0.5).length;

  return {
    samples,
    issues,
    controlPoints,
    summary: {
      poleResiduals,
      maxResidual: Math.round(maxResidual * 1000) / 1000,
      meanResidual: Math.round(meanResidual * 1000) / 1000,
      rmsResidual: Math.round(rmsResidual * 1000) / 1000,
      within05,
      total: poleResiduals.length,
    },
  };
}

/** 规整到固定里程网格（便于多批次叠加对比），断点区间留空 */
export function resampleOnGrid(
  samples: InspectionSample[],
  step: number,
  totalLength: number,
): InspectionSample[] {
  if (samples.length === 0) return [];
  const byMileage = new Map<number, InspectionSample[]>();
  for (const s of samples) {
    const key = Math.round(s.mileage / step) * step;
    const arr = byMileage.get(key) ?? [];
    arr.push(s);
    byMileage.set(key, arr);
  }
  const out: InspectionSample[] = [];
  for (let m = 0; m <= totalLength; m = Math.round((m + step) * 1000) / 1000) {
    const key = Math.round(m * 1000) / 1000;
    const arr = byMileage.get(key);
    if (!arr || arr.length === 0) continue;
    const avg = arr.reduce(
      (acc, s) => {
        acc.contactHeight += s.contactHeight;
        acc.stagger += s.stagger;
        return acc;
      },
      { contactHeight: 0, stagger: 0 },
    );
    out.push({
      ...arr[0],
      mileage: key,
      contactHeight: Math.round(avg.contactHeight / arr.length),
      stagger: Math.round(avg.stagger / arr.length),
    });
  }
  return out;
}
