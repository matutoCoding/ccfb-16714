// ============================================================
// 里程对齐引擎（系统最核心的正确性保证）
//
// 思路：
//  1. CSV 采样按顺序给出原始（漂移）里程 raw；过杆记录带杆号。
//  2. 杆号与线路档案权威支柱一一匹配，得到 (rawMileage -> archiveMileage) 锚点。
//  3. 扫描采样里程增量识别：数据缺口(断点)、里程回退/重置；
//     扫描相邻锚点的 raw 增量与档案跨距之差，识别里程跳变，并定位到采样行。
//  4. 在跳变/断点处切分段；段内对里程偏差 o = M - r 做局部线性稳健平滑，
//     再以锚点构造分段线性映射 raw -> fixed（段端线性外推）。
//  5. 留一杆交叉验证（LOOCV）量化“对齐后支柱位置 vs 档案”的真实误差，
//     演示种子数据另带 truthMileage 做全采样点真值校验。
// ============================================================

import type {
  AlignReport,
  BreakEvent,
  JumpEvent,
  Pole,
  PoleMark,
  PoleAlignResult,
  SegmentStat,
} from './types';
import { interp1, normalizePoleCode, poleDigits, uid } from './format';

export interface AlignOptions {
  archivePoles: Pole[];
  poleMarks: PoleMark[];
  rawMileage: Float64Array | number[];
  truthMileage?: Float64Array;
  tolerance?: number;
  /** 被用户忽略（不切分）的跳变 id */
  ignoredJumpIds?: string[];
  /** 全局手动偏移 m，在自动映射之后叠加 */
  manualOffset?: number;
  /** 全局手动系数微调（1 = 不调），以线路中点为支点 */
  manualScale?: number;
}

export interface AlignOutput {
  fixed: Float64Array;
  report: AlignReport;
}

interface Anchor {
  rowIndex: number;
  code: string;
  raw: number;
  ref: number;
}

const JUMP_DISCREPANCY_THRESHOLD = 1.5; // 相邻杆间 raw 跨距与档案跨距差 >1.5m 判为跳变
const GAP_FACTOR = 8; // 采样缺口 > 8 倍正常步长
const GAP_MIN = 8; // 且绝对缺口 > 8m
const BACKWARD_THRESHOLD = -0.5; // 里程倒退超过 0.5m 判为重置

export function alignRun(opts: AlignOptions): AlignOutput {
  const raw = opts.rawMileage;
  const n = raw.length;
  const tolerance = opts.tolerance ?? 0.5;
  const manualOffset = opts.manualOffset ?? 0;
  const manualScale = opts.manualScale ?? 1;
  const ignored = new Set(opts.ignoredJumpIds ?? []);

  const poles = [...opts.archivePoles].sort((a, b) => a.mileage - b.mileage);
  const byCode = new Map<string, Pole>();
  const byDigits = new Map<number, Pole>();
  for (const p of poles) {
    byCode.set(normalizePoleCode(p.code), p);
    const d = poleDigits(p.code);
    if (d !== null && !byDigits.has(d)) byDigits.set(d, p);
  }

  // ---------- 1. 杆号匹配 ----------
  const poleResults: PoleAlignResult[] = [];
  const anchorsAll: Anchor[] = [];
  const seenCodes = new Map<string, number>(); // code -> 已用 anchor 序号

  const marks = [...opts.poleMarks].sort((a, b) => a.rowIndex - b.rowIndex);
  let unknownCodeCount = 0;

  for (const mk of marks) {
    const codeN = normalizePoleCode(mk.code);
    let pole = codeN ? byCode.get(codeN) : undefined;
    if (!pole) {
      // 兜底：纯数字/尾号匹配
      const d = poleDigits(mk.code);
      if (d !== null) pole = byDigits.get(d);
    }
    if (!pole) {
      unknownCodeCount++;
      poleResults.push({
        code: mk.code,
        refMileage: NaN,
        rawMileage: mk.rawMileage,
        fixedMileage: NaN,
        fitResidual: NaN,
        cvError: null,
        status: 'unknown-code',
      });
      continue;
    }
    const dupCount = seenCodes.get(pole.code) ?? 0;
    seenCodes.set(pole.code, dupCount + 1);
    if (dupCount > 0) {
      poleResults.push({
        code: pole.code,
        refMileage: pole.mileage,
        rawMileage: mk.rawMileage,
        fixedMileage: NaN,
        fitResidual: NaN,
        cvError: null,
        status: 'duplicate',
      });
      continue;
    }
    anchorsAll.push({ rowIndex: mk.rowIndex, code: pole.code, raw: mk.rawMileage, ref: pole.mileage });
  }
  anchorsAll.sort((a, b) => a.rowIndex - b.rowIndex);

  // 档案中缺失的杆（CSV 未识别/未提供）
  const matchedCodes = new Set(anchorsAll.map((a) => a.code));
  for (const p of poles) {
    if (!matchedCodes.has(p.code)) {
      poleResults.push({
        code: p.code,
        refMileage: p.mileage,
        rawMileage: NaN,
        fixedMileage: NaN,
        fitResidual: NaN,
        cvError: null,
        status: 'missing-in-csv',
      });
    }
  }

  // ---------- 2. 采样流扫描：断点 / 回退 ----------
  const breaks: BreakEvent[] = [];
  const mandatoryBoundaries = new Set<number>(); // 在 afterRow 之后切分

  const deltas: number[] = [];
  for (let i = 1; i < n; i++) deltas.push(raw[i] - raw[i - 1]);
  const posDeltas = deltas.filter((d) => d > 0.05).sort((a, b) => a - b);
  const medianStep = posDeltas.length ? posDeltas[posDeltas.length >> 1] : 1;

  for (let i = 1; i < n; i++) {
    const d = raw[i] - raw[i - 1];
    if (d <= BACKWARD_THRESHOLD) {
      const ev: BreakEvent = {
        kind: 'break',
        id: `br_${i}`,
        rowIndex: i,
        rawFrom: raw[i - 1],
        rawTo: raw[i],
        rawGap: d,
        reason: d < -2 ? 'mileage-reset' : 'non-monotonic',
        note: d < -2 ? `里程回退 ${d.toFixed(2)}m，疑似主机重置` : `里程非单调（${d.toFixed(2)}m）`,
      };
      breaks.push(ev);
      mandatoryBoundaries.add(i - 1); // 在 i-1 行之后切
    } else if (d > Math.max(GAP_MIN, medianStep * GAP_FACTOR)) {
      const ev: BreakEvent = {
        kind: 'break',
        id: `br_${i}`,
        rowIndex: i,
        rawFrom: raw[i - 1],
        rawTo: raw[i],
        rawGap: d,
        reason: 'data-gap',
        note: `数据缺口，原始里程跳增 ${d.toFixed(1)}m`,
      };
      breaks.push(ev);
      mandatoryBoundaries.add(i - 1);
    }
  }

  // ---------- 3. 相邻锚点扫描：里程跳变 ----------
  const jumps: JumpEvent[] = [];
  for (let k = 1; k < anchorsAll.length; k++) {
    const a = anchorsAll[k - 1];
    const b = anchorsAll[k];
    const dRaw = b.raw - a.raw;
    const dRef = b.ref - a.ref;
    if (!Number.isFinite(dRaw) || dRaw <= 0) continue; // 中间应有重置断点处理
    const discrepancy = dRaw - dRef;
    if (Math.abs(discrepancy) > JUMP_DISCREPANCY_THRESHOLD) {
      // 在两个锚点行之间找增量最异常的采样位置
      let splitAfter = Math.max(a.rowIndex, 0);
      let maxAbs = -1;
      const lo = Math.max(1, a.rowIndex + 1);
      const hi = Math.min(b.rowIndex, n - 1);
      for (let i = lo; i <= hi; i++) {
        const dd = Math.abs(raw[i] - raw[i - 1] - medianStep);
        if (dd > maxAbs) {
          maxAbs = dd;
          splitAfter = i - 1;
        }
      }
      if (splitAfter < a.rowIndex) splitAfter = a.rowIndex;
      if (splitAfter >= b.rowIndex) splitAfter = b.rowIndex - 1;
      const id = `jp_${jumps.length + 1}_${a.code}_${b.code}`;
      jumps.push({
        kind: 'jump',
        id,
        afterRow: splitAfter,
        betweenPoles: [a.code, b.code],
        rawDelta: dRaw,
        refDelta: dRef,
        discrepancy,
        splitRawMileage: raw[Math.min(splitAfter + 1, n - 1)],
        accepted: !ignored.has(id),
      });
    }
  }

  // ---------- 4. 组织分段 ----------
  const boundaries = new Set<number>(mandatoryBoundaries);
  for (const j of jumps) {
    if (j.accepted) boundaries.add(j.afterRow);
  }
  const cuts = [...boundaries].filter((r) => r >= 0 && r < n - 1).sort((a, b) => a - b);
  const segBounds: Array<[number, number]> = [];
  let start = 0;
  for (const c of cuts) {
    segBounds.push([start, c]);
    start = c + 1;
  }
  segBounds.push([start, n - 1]);

  // 每段构造映射
  interface SegMap {
    rowStart: number;
    rowEnd: number;
    xs: number[]; // raw 锚点（平滑后映射所用）
    ys: number[]; // 修正后里程
    anchors: Anchor[];
    scale: number;
    midRef: number;
  }
  const segMaps: SegMap[] = [];
  const segments: SegmentStat[] = [];

  segBounds.forEach(([rs, re], si) => {
    const anc = anchorsAll.filter((a) => a.rowIndex >= rs && a.rowIndex <= re);
    anc.sort((a, b) => a.raw - b.raw);

    let xs: number[] = [];
    let ys: number[] = [];
    let scale = 1;
    let midRef = 0;

    if (anc.length >= 2) {
      // 偏差序列 o = ref - raw，做局部线性加权平滑（窗 5），压制过杆噪声
      const raws = anc.map((a) => a.raw);
      const offs = anc.map((a) => a.ref - a.raw);
      const sm = localLinearSmooth(raws, offs, 2);
      xs = raws;
      ys = raws.map((r, i) => r + sm[i]);
      const first = anc[0];
      const last = anc[anc.length - 1];
      scale = (last.ref - first.ref) / (last.raw - first.raw || 1);
      midRef = (first.ref + last.ref) / 2;
      // 保证映射单调（平滑极端情况下保险）
      for (let i = 1; i < ys.length; i++) {
        if (ys[i] <= ys[i - 1]) ys[i] = ys[i - 1] + 1e-4;
      }
    } else if (anc.length === 1) {
      const a = anc[0];
      xs = [a.raw - 1, a.raw, a.raw + 1];
      ys = [a.ref - 1, a.ref, a.ref + 1];
      scale = 1;
      midRef = a.ref;
    } else {
      // 无锚点段：用全部锚点的全局仿射兜底
      if (anchorsAll.length >= 2) {
        const f = globalAffine(anchorsAll);
        xs = [];
        ys = [];
        scale = f.scale;
        midRef = f.offset; // 占位
      }
    }

    segMaps.push({ rowStart: rs, rowEnd: re, xs, ys, anchors: anc, scale, midRef });
    segments.push({
      index: si,
      rowStart: rs,
      rowEnd: re,
      anchorCount: anc.length,
      rawStart: raw[rs],
      rawEnd: raw[re],
      fixedStart: ys.length ? interp1(xs, ys, raw[rs]) : NaN,
      fixedEnd: ys.length ? interp1(xs, ys, raw[re]) : NaN,
      scale,
    });
  });

  // ---------- 5. 逐采样修正 ----------
  const fixed = new Float64Array(n);

  const nearestValidSeg = (si: number): SegMap | null => {
    if (segMaps[si] && segMaps[si].xs.length >= 2) return segMaps[si];
    for (let d = 1; d < segMaps.length; d++) {
      if (si - d >= 0 && segMaps[si - d].xs.length >= 2) return segMaps[si - d];
      if (si + d < segMaps.length && segMaps[si + d].xs.length >= 2) return segMaps[si + d];
    }
    return null;
  };

  /** 在指定行所属分段内，把原始里程映射为档案里程 */
  const mapAt = (rawValue: number, rowIndex: number): number => {
    let si = 0;
    while (si < segMaps.length - 1 && rowIndex > segMaps[si].rowEnd) si++;
    let sm = segMaps[si];
    let v: number;
    if (sm.xs.length >= 2) {
      v = interp1(sm.xs, sm.ys, rawValue);
    } else {
      const borrow = nearestValidSeg(si);
      if (borrow) {
        sm = borrow;
        v = interp1(borrow.xs, borrow.ys, rawValue);
      } else {
        const f = globalAffine(anchorsAll);
        sm.midRef = (anchorsAll[0]?.ref ?? 0) + ((anchorsAll[anchorsAll.length - 1]?.ref ?? 0) - (anchorsAll[0]?.ref ?? 0)) / 2;
        v = f.offset + f.scale * rawValue;
      }
    }
    if (manualScale !== 1) v = sm.midRef + (v - sm.midRef) * manualScale;
    return v + manualOffset;
  };

  for (let i = 0; i < n; i++) {
    fixed[i] = mapAt(raw[i], i);
  }

  // ---------- 6. 锚点拟合残差 + 留一交叉验证 ----------
  const anchorByCode = new Map(anchorsAll.map((a) => [a.code, a]));
  for (const pr of poleResults) {
    const a = anchorByCode.get(pr.code);
    if (!a) continue;
    // 在过杆事件自身的（亚米级）原始里程处求值，这是“对齐后杆位 vs 档案”的直接偏差
    pr.fixedMileage = mapAt(a.raw, a.rowIndex);
    pr.fitResidual = pr.fixedMileage - pr.refMileage;
  }

  // LOOCV：同一分段内，用前后相邻锚点（不含自身）线性预测
  let maxCv = 0;
  let sumSq = 0;
  let cvCount = 0;
  for (let k = 1; k < anchorsAll.length - 1; k++) {
    const prev = anchorsAll[k - 1];
    const cur = anchorsAll[k];
    const next = anchorsAll[k + 1];
    // 跨跳变边界不做 CV
    if (Math.abs(cur.raw - prev.raw - (cur.ref - prev.ref)) > JUMP_DISCREPANCY_THRESHOLD) continue;
    if (Math.abs(next.raw - cur.raw - (next.ref - cur.ref)) > JUMP_DISCREPANCY_THRESHOLD) continue;
    if (next.raw === prev.raw) continue;
    const predicted = prev.ref + ((next.ref - prev.ref) * (cur.raw - prev.raw)) / (next.raw - prev.raw);
    const err = predicted - cur.ref;
    const pr = poleResults.find((p) => p.code === cur.code && p.status === 'matched');
    if (pr) pr.cvError = err;
    maxCv = Math.max(maxCv, Math.abs(err));
    sumSq += err * err;
    cvCount++;
  }
  const rmsCv = cvCount ? Math.sqrt(sumSq / cvCount) : 0;

  // 真值校验（仅演示种子）
  let maxTrueError: number | undefined;
  if (opts.truthMileage && opts.truthMileage.length === n) {
    maxTrueError = 0;
    for (let i = 0; i < n; i++) {
      const e = Math.abs(fixed[i] - opts.truthMileage[i]);
      if (e > maxTrueError) maxTrueError = e;
    }
  }

  const report: AlignReport = {
    alignedAt: Date.now(),
    archivePoleCount: poles.length,
    matchedPoleCount: anchorsAll.length,
    unknownCodeCount,
    usedAnchorCount: anchorsAll.length,
    maxCvError: maxCv,
    rmsCvError: rmsCv,
    maxTrueError,
    tolerance,
    pass: maxCv < tolerance && (maxTrueError === undefined || maxTrueError < tolerance),
    segments,
    jumps,
    breaks,
    poleResults: poleResults.sort((a, b) => (a.refMileage ?? a.rawMileage) - (b.refMileage ?? b.rawMileage)),
    manualOffset,
    manualScale,
  };

  return { fixed, report };
}

/** 局部线性加权平滑（tricube 权），halfWin 为单侧锚点数 */
function localLinearSmooth(x: number[], y: number[], halfWin: number): number[] {
  const n = x.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - halfWin);
    const hi = Math.min(n - 1, i + halfWin);
    const x0 = x[i];
    const maxD = Math.max(...x.slice(lo, hi + 1).map((xx) => Math.abs(xx - x0)), 1e-6);
    let sw = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (let j = lo; j <= hi; j++) {
      const d = Math.abs(x[j] - x0) / maxD;
      const w = Math.pow(1 - Math.pow(d, 3), 3); // tricube
      sw += w;
      sx += w * (x[j] - x0);
      sy += w * y[j];
      sxx += w * (x[j] - x0) ** 2;
      sxy += w * (x[j] - x0) * y[j];
    }
    // 加权线性回归 y = a + b*(x-x0)，在 x0 处取值 a
    const denom = sw * sxx - sx * sx;
    let a: number;
    if (Math.abs(denom) < 1e-12) {
      a = sy / sw;
    } else {
      a = (sy * sxx - sxy * sx) / denom;
    }
    out[i] = a;
  }
  return out;
}

function globalAffine(anchors: Anchor[]): { offset: number; scale: number } {
  if (anchors.length < 2) return { offset: 0, scale: 1 };
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  const n = anchors.length;
  for (const a of anchors) {
    sx += a.raw;
    sy += a.ref;
    sxx += a.raw * a.raw;
    sxy += a.raw * a.ref;
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return { offset: anchors[0].ref - anchors[0].raw, scale: 1 };
  const scale = (n * sxy - sx * sy) / denom;
  const offset = (sy - scale * sx) / n;
  return { offset, scale };
}

/** 生成一个新的跳变/断点 id（UI 手动加事件时用） */
export function newAlignEventId(prefix: string): string {
  return uid(prefix);
}
