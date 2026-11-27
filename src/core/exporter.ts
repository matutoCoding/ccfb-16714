// 导出：超限报表 CSV、单个锚段几何图 SVG、全部锚段几何图 HTML 图册
import type { AnchorSection, Defect, DetectionBatch, DetectionRun, Pole, DropperInfo } from './types';
import { TRACK_LABEL } from './types';
import { fmtMileage } from './format';

function esc(s: string | number | undefined | null): string {
  return String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] as string);
}

export function defectsReportCsv(
  defects: Defect[],
  ctx: { batches: DetectionBatch[]; workOrderCode?: (id?: string) => string },
): string {
  const batchMap = new Map(ctx.batches.map((b) => [b.id, b]));
  const header = [
    '缺陷编号', '检测批次', '检测日期', '线别', '峰值里程', '起点', '终点',
    '最近支柱', '锚段', '检测项目', '等级', '峰值', '异常偏差', '判定阈值',
    '超限长度(m)', '状态', '工单',
  ];
  const statusLabel: Record<Defect['status'], string> = {
    open: '未处理', ordered: '已派单', processing: '处理中', resolved: '已处理待复核', verified: '复核已修复',
  };
  const rows = defects.map((d) => {
    const b = batchMap.get(d.batchId);
    return [
      d.id,
      b?.name ?? d.batchId,
      b?.date ?? '',
      TRACK_LABEL[d.track],
      fmtMileage(d.mileage),
      fmtMileage(d.startMileage),
      fmtMileage(d.endMileage),
      d.poleCode ?? '',
      d.anchorCode ?? '',
      d.metric === 'height' ? '导高(mm)' : '拉出值(mm)',
      d.level === 2 ? '二级' : '一级',
      d.value,
      d.deviation,
      d.limitUsed,
      d.length.toFixed(1),
      statusLabel[d.status],
      ctx.workOrderCode?.(d.workOrderId) ?? '',
    ];
  });
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------------- 锚段几何图 SVG ----------------

export interface AnchorChartArgs {
  anchor: AnchorSection;
  run?: DetectionRun | null;
  poles: Pole[];
  droppers: DropperInfo[];
  defects?: Defect[];
  designHeight: number;
  heightL1: number;
  heightL2: number;
  pullL1: number;
  pullL2: number;
  width?: number;
}

export function anchorGeometrySvg(a: AnchorChartArgs): string {
  const W = a.width ?? 1180;
  const ML = 64;
  const MR = 20;
  const PW = W - ML - MR;
  const PANEL_H = 210;
  const GAP = 56;
  const MT = 46;
  const H = MT + PANEL_H + GAP + PANEL_H + 70;

  const x0 = a.anchor.fromMileage - 3;
  const x1 = a.anchor.toMileage + 3;
  const X = (m: number) => ML + ((m - x0) / (x1 - x0)) * PW;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Microsoft YaHei,Segoe UI,sans-serif">`,
  );
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);
  parts.push(
    `<text x="${ML}" y="26" font-size="18" font-weight="700" fill="#0f172a">锚段 ${esc(a.anchor.code)} · ${TRACK_LABEL[a.anchor.track]} · ${fmtMileage(a.anchor.fromMileage)} ~ ${fmtMileage(a.anchor.toMileage)}（长 ${a.anchor.length.toFixed(0)}m / ${a.anchor.spanCount} 跨）</text>`,
  );

  // 数据范围
  let hMin = a.designHeight - 120;
  let hMax = a.designHeight + 120;
  let pMax = 520;
  const idxRange = findIndexRange(a.run, x0, x1);
  if (a.run) {
    for (let i = idxRange.lo; i <= idxRange.hi; i++) {
      hMin = Math.min(hMin, a.run.height[i]);
      hMax = Math.max(hMax, a.run.height[i]);
      pMax = Math.max(pMax, Math.abs(a.run.pull[i]));
    }
  }
  hMin = Math.floor((hMin - 10) / 20) * 20;
  hMax = Math.ceil((hMax + 10) / 20) * 20;
  pMax = Math.ceil((pMax + 40) / 100) * 100;

  // ---- 面板 1：导高 ----
  const y1Top = MT;
  const YH = (v: number) => y1Top + 12 + (1 - (v - hMin) / (hMax - hMin)) * (PANEL_H - 24);
  parts.push(panelFrame(ML, y1Top, PW, PANEL_H, '导高 (mm)'));
  // 阈值线
  for (const [v, color, label] of [
    [a.designHeight + a.heightL2, '#dc2626', `二级 +${a.heightL2}`],
    [a.designHeight + a.heightL1, '#f59e0b', `一级 +${a.heightL1}`],
    [a.designHeight, '#16a34a', '设计'],
    [a.designHeight - a.heightL1, '#f59e0b', `一级 -${a.heightL1}`],
    [a.designHeight - a.heightL2, '#dc2626', `二级 -${a.heightL2}`],
  ] as Array<[number, string, string]>) {
    if (v < hMin || v > hMax) continue;
    const y = YH(v);
    parts.push(`<line x1="${ML}" y1="${y.toFixed(1)}" x2="${ML + PW}" y2="${y.toFixed(1)}" stroke="${color}" stroke-width="1" stroke-dasharray="${label === '设计' ? '0' : '5 4'}" opacity="0.7"/>`);
    parts.push(`<text x="${ML + PW - 6}" y="${(y - 3).toFixed(1)}" font-size="10" fill="${color}" text-anchor="end">${label} ${v}</text>`);
  }
  // y 轴刻度
  for (let v = Math.ceil(hMin / 20) * 20; v <= hMax; v += 20) {
    const y = YH(v);
    parts.push(`<line x1="${ML - 4}" y1="${y}" x2="${ML}" y2="${y}" stroke="#94a3b8"/>`);
    parts.push(`<text x="${ML - 7}" y="${y + 3.5}" font-size="10" fill="#64748b" text-anchor="end">${v}</text>`);
  }
  if (a.run) {
    parts.push(profilePath(a.run, idxRange, X, YH, (i) => a.run!.height[i], '#2563eb'));
  }

  // ---- 面板 2：拉出值 ----
  const y2Top = MT + PANEL_H + GAP;
  const YP = (v: number) => y2Top + 12 + (1 - (v + pMax) / (2 * pMax)) * (PANEL_H - 24);
  parts.push(panelFrame(ML, y2Top, PW, PANEL_H, '拉出值 (mm)'));
  for (const [v, color] of [
    [a.pullL2, '#dc2626'], [a.pullL1, '#f59e0b'], [0, '#16a34a'], [-a.pullL1, '#f59e0b'], [-a.pullL2, '#dc2626'],
  ] as Array<[number, string]>) {
    const y = YP(v);
    parts.push(`<line x1="${ML}" y1="${y.toFixed(1)}" x2="${ML + PW}" y2="${y.toFixed(1)}" stroke="${color}" stroke-width="1" stroke-dasharray="${v === 0 ? '0' : '5 4'}" opacity="0.7"/>`);
    parts.push(`<text x="${ML + PW - 6}" y="${(y - 3).toFixed(1)}" font-size="10" fill="${color}" text-anchor="end">${v > 0 ? '+' : ''}${v}</text>`);
  }
  for (let v = -pMax; v <= pMax; v += pMax / 5) {
    const y = YP(v);
    parts.push(`<text x="${ML - 7}" y="${y + 3.5}" font-size="10" fill="#64748b" text-anchor="end">${Math.round(v)}</text>`);
  }
  if (a.run) {
    parts.push(profilePath(a.run, idxRange, X, YP, (i) => a.run!.pull[i], '#7c3aed'));
  }

  // ---- 支柱 / 吊弦 / x 轴（两面板同步标注） ----
  const anchorPoles = a.poles.filter((p) => p.mileage >= a.anchor.fromMileage - 1 && p.mileage <= a.anchor.toMileage + 1);
  for (const p of anchorPoles) {
    const x = X(p.mileage);
    for (const top of [y1Top, y2Top]) {
      parts.push(`<line x1="${x}" y1="${top + 10}" x2="${x}" y2="${top + PANEL_H - 4}" stroke="#0f172a" stroke-width="1.2" opacity="0.35"/>`);
    }
    parts.push(`<polygon points="${x},${y2Top + PANEL_H + 2} ${x - 4},${y2Top + PANEL_H + 9} ${x + 4},${y2Top + PANEL_H + 9}" fill="#0f172a"/>`);
    parts.push(`<text x="${x}" y="${y2Top + PANEL_H + 22}" font-size="10" fill="#0f172a" text-anchor="middle" font-weight="600">${esc(p.code)}</text>`);
    parts.push(`<text x="${x}" y="${y2Top + PANEL_H + 35}" font-size="9" fill="#94a3b8" text-anchor="middle">${fmtMileage(p.mileage, false)}</text>`);
  }
  // 吊弦刻度
  for (const d of a.droppers) {
    if (d.mileage < x0 || d.mileage > x1) continue;
    const x = X(d.mileage);
    parts.push(`<line x1="${x}" y1="${y1Top + PANEL_H - 8}" x2="${x}" y2="${y1Top + PANEL_H - 2}" stroke="#0891b2" stroke-width="1.4"/>`);
    parts.push(`<line x1="${x}" y1="${y2Top + PANEL_H - 8}" x2="${x}" y2="${y2Top + PANEL_H - 2}" stroke="#0891b2" stroke-width="1.4"/>`);
  }
  parts.push(`<text x="${ML}" y="${H - 12}" font-size="11" fill="#0891b2">▲ 黑：支柱/定位点　青刻度：吊弦</text>`);

  // 超限点
  for (const d of a.defects ?? []) {
    if (d.mileage < x0 || d.mileage > x1) continue;
    const x = X(d.mileage);
    const color = d.level === 2 ? '#dc2626' : '#f59e0b';
    if (d.metric === 'height') {
      const y = YH(d.value);
      parts.push(`<circle cx="${x}" cy="${y}" r="5" fill="${color}" stroke="#fff" stroke-width="1.5"/>`);
    } else {
      const y = YP(d.signedValue);
      parts.push(`<circle cx="${x}" cy="${y}" r="5" fill="${color}" stroke="#fff" stroke-width="1.5"/>`);
    }
  }

  // x 里程网格
  const tickStep = chooseTickStep(x1 - x0);
  for (let m = Math.ceil(x0 / tickStep) * tickStep; m <= x1; m += tickStep) {
    const x = X(m);
    parts.push(`<line x1="${x}" y1="${y1Top + 10}" x2="${x}" y2="${y1Top + PANEL_H - 4}" stroke="#e2e8f0" stroke-width="1"/>`);
    parts.push(`<text x="${x}" y="${H - 30}" font-size="10" fill="#64748b" text-anchor="middle">${fmtMileage(m, false)}</text>`);
  }

  parts.push('</svg>');
  return parts.join('');
}

function panelFrame(x: number, y: number, w: number, h: number, title: string): string {
  return [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#f8fafc" stroke="#cbd5e1" rx="6"/>`,
    `<text x="${x + 10}" y="${y + 18}" font-size="12" font-weight="700" fill="#334155">${title}</text>`,
  ].join('');
}

function chooseTickStep(span: number): number {
  for (const s of [10, 20, 50, 100, 200, 500]) if (span / s <= 12) return s;
  return 1000;
}

function findIndexRange(run: DetectionRun | null | undefined, x0: number, x1: number): { lo: number; hi: number } {
  if (!run) return { lo: 0, hi: -1 };
  let lo = 0;
  let hi = run.pointCount - 1;
  while (lo < run.pointCount && run.fixedMileage[lo] < x0) lo++;
  while (hi > 0 && run.fixedMileage[hi] > x1) hi--;
  return { lo: Math.max(0, lo), hi: Math.min(run.pointCount - 1, hi) };
}

function profilePath(
  run: DetectionRun,
  range: { lo: number; hi: number },
  X: (m: number) => number,
  Y: (v: number) => number,
  getV: (i: number) => number,
  color: string,
): string {
  if (range.hi < range.lo) return '';
  // 大数据量时按像素抽稀（每像素取 min/max 包络），这里锚段仅 ~1.3km / 1300 点，直接画
  let d = '';
  for (let i = range.lo; i <= range.hi; i++) {
    const x = X(run.fixedMileage[i]);
    const y = Y(getV(i));
    d += `${i === range.lo ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)} `;
  }
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.6"/>`;
}

/** 全部锚段几何图 HTML 图册（可直接浏览器打印为 PDF） */
export function anchorAlbumHtml(args: {
  lineName: string;
  batchName: string;
  trackLabel: string;
  svgs: Array<{ code: string; svg: string }>;
}): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/>
<title>${args.lineName} 锚段几何图图册 · ${args.batchName} · ${args.trackLabel}</title>
<style>
 body{font-family:"Microsoft YaHei",sans-serif;margin:0;background:#e2e8f0;color:#0f172a}
 header{padding:24px 32px;background:#0f172a;color:#fff}
 header h1{margin:0 0 6px;font-size:22px}
 header p{margin:0;color:#94a3b8;font-size:13px}
 section{background:#fff;margin:18px auto;padding:10px;max-width:1220px;box-shadow:0 2px 10px rgba(0,0,0,.08);page-break-after:always}
 svg{width:100%;height:auto;display:block}
 @media print{body{background:#fff}section{box-shadow:none;margin:0;max-width:none}}
</style></head><body>
<header><h1>${args.lineName} 接触网锚段几何检测图图册</h1>
<p>${args.batchName} · ${args.trackLabel} · 共 ${args.svgs.length} 个锚段 · 蓝：导高曲线　紫：拉出值曲线　红/橙点：超限　可 Ctrl+P 另存为 PDF</p></header>
${args.svgs.map((s) => `<section>${s.svg}</section>`).join('\n')}
</body></html>`;
}
