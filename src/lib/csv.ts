import type {
  AnchorSection,
  ExceedPoint,
  InspectionBatch,
  LineProfile,
  RawCsvRow,
} from '../types';
import { formatMileage } from './geometry';

// 检测车 CSV 约定列：
// 里程(m),杆号,导高(mm),拉出值(mm),隧道标记
export const CSV_HEADER = '里程(m),杆号,导高(mm),拉出值(mm),隧道标记';

export function rowsToCsv(rows: RawCsvRow[]): string {
  const lines = [CSV_HEADER];
  for (const r of rows) {
    lines.push(
      `${r.rawMileage.toFixed(2)},${r.poleNo},${r.contactHeight},${r.stagger},${r.inTunnel ? 1 : 0}`,
    );
  }
  return '﻿' + lines.join('\r\n');
}

export function parseCsv(text: string): RawCsvRow[] {
  const clean = text.replace(/^﻿/, '').trim();
  const lines = clean.split(/\r?\n/);
  if (lines.length < 2) throw new Error('CSV 内容为空或只有表头');
  const rows: RawCsvRow[] = [];
  // 跳过表头（首行含非数字字段时自动跳过）
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(',').map((s) => s.trim());
    if (parts.length < 4) continue;
    const rawMileage = Number(parts[0]);
    if (!Number.isFinite(rawMileage)) continue;
    rows.push({
      rawMileage,
      poleNo: parts[1] ?? '',
      contactHeight: Number(parts[2]),
      stagger: Number(parts[3]),
      inTunnel: (parts[4] ?? '0') === '1' || parts[4] === '是',
    });
  }
  if (rows.length === 0) throw new Error('未解析到有效数据行');
  return rows;
}

/** 超限报表 CSV */
export function exceedReportCsv(
  points: ExceedPoint[],
  batches: InspectionBatch[],
  profile: LineProfile,
): string {
  const batchMap = new Map(batches.map((b) => [b.id, b]));
  const poleMap = new Map(profile.poles.map((p) => [p.id, p]));
  const header = [
    '批次',
    '方向',
    '检测日期',
    '里程',
    '杆号',
    '指标',
    '等级',
    '实测值(mm)',
    '限界(mm)',
    '设计值(mm)',
    '偏差(mm)',
    '处理状态',
  ];
  const lines = [header.join(',')];
  for (const p of points) {
    const b = batchMap.get(p.batchId);
    const pole = poleMap.get(p.nearestPoleId);
    lines.push(
      [
        b?.name ?? p.batchId,
        p.direction === 'up' ? '上行' : '下行',
        b?.inspectDate ?? '',
        formatMileage(p.mileage),
        pole?.poleNo ?? '',
        p.metric === 'height' ? '导高' : '拉出值',
        p.level === 2 ? '二级' : '一级',
        p.value,
        p.limit,
        p.design,
        p.deviation,
        p.handled ? '已处理' : '未处理',
      ].join(','),
    );
  }
  return '﻿' + lines.join('\r\n');
}

/** 锚段几何图 CSV：锚段内每个采样点的里程/导高/拉出（可在 Excel 中绘图） */
export function anchorGeometryCsv(
  anchor: AnchorSection,
  samples: { mileage: number; contactHeight: number; stagger: number }[],
): string {
  const lines = [
    `锚段,${anchor.name}`,
    '里程,里程标,导高(mm),拉出值(mm)',
  ];
  for (const s of samples) {
    if (s.mileage < anchor.startMileage - 1 || s.mileage > anchor.endMileage + 1) continue;
    lines.push(`${s.mileage.toFixed(2)},${formatMileage(s.mileage)},${s.contactHeight},${s.stagger}`);
  }
  return '﻿' + lines.join('\r\n');
}

/** 触发浏览器下载 */
export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
