// 检测车 CSV 解析与生成。兼容常见中英文表头、不同列序。
import type { PoleMark } from './types';

export interface ParsedCsv {
  rawMileage: Float64Array;
  height: Float32Array;
  pull: Float32Array;
  speed: Float32Array;
  poleMarks: PoleMark[];
  headers: string[];
  rowCount: number;
  hasPoleColumn: boolean;
}

type ColKind = 'mileage' | 'pole' | 'height' | 'pull' | 'speed' | 'ignore';

function classifyHeader(h: string): ColKind {
  const s = h.trim().toLowerCase();
  if (!s) return 'ignore';
  if (/杆号|支柱号|杆编号|pole|pillar|poleid|pole_id/.test(s)) return 'pole';
  if (/里程|公里标|mileage|chainage|kmloc|location|^km$/.test(s)) return 'mileage';
  if (/导高|接触线高|高度|height|wireheight|hgt/.test(s)) return 'height';
  if (/拉出|之字|pull|stagger|offset|zigzag/.test(s)) return 'pull';
  if (/速度|车速|speed|vel/.test(s)) return 'speed';
  return 'ignore';
}

/** 解析里程文本，支持 K12+345.6 / 普通数字 */
export function parseMileageToken(tok: string): number {
  if (tok == null) return NaN;
  let s = String(tok).trim();
  if (!s) return NaN;
  const kmMatch = s.match(/K?\s*(-?\d+)\s*\+\s*(\d+(?:\.\d+)?)/i);
  if (kmMatch) {
    return parseInt(kmMatch[1], 10) * 1000 + parseFloat(kmMatch[2]);
  }
  s = s.replace(/[m米\s]/g, '');
  // 可能是 12345.6
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : NaN;
}

function splitLine(line: string, delim: string): string[] {
  // 支持带引号字段
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
    } else if (ch === delim && !inQ) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

export function parseDetectionCsv(text: string): ParsedCsv {
  // 去 BOM
  const content = text.replace(/^﻿/, '');
  const firstLines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!firstLines.length) throw new Error('CSV 文件为空');

  // 自动判断分隔符
  const delim = firstLines[0].includes('\t') ? '\t' : (firstLines[0].match(/;/g)?.length ?? 0) > (firstLines[0].match(/,/g)?.length ?? 0) ? ';' : ',';

  // 找表头行（前 10 行内含“里程/mileage”关键字的行）
  let headerIdx = 0;
  let headers: string[] = [];
  for (let i = 0; i < Math.min(10, firstLines.length); i++) {
    const cols = splitLine(firstLines[i], delim);
    if (cols.some((c) => classifyHeader(c) === 'mileage')) {
      headerIdx = i;
      headers = cols;
      break;
    }
  }
  if (!headers.length) {
    // 无表头：默认 里程,杆号,导高,拉出值,速度
    headers = ['里程', '杆号', '导高', '拉出值', '速度'];
  }

  const kinds: ColKind[] = headers.map(classifyHeader);
  // 若没有里程列但第一列看起来是序号，兜底把第二列当里程
  let mileageCol = kinds.indexOf('mileage');
  if (mileageCol < 0) mileageCol = 0;
  const poleCol = kinds.indexOf('pole');
  const heightCol = kinds.indexOf('height');
  const pullCol = kinds.indexOf('pull');
  const speedCol = kinds.indexOf('speed');

  const rawArr: number[] = [];
  const hArr: number[] = [];
  const pArr: number[] = [];
  const spArr: number[] = [];
  const poleMarks: PoleMark[] = [];

  for (let li = headerIdx + 1; li < firstLines.length; li++) {
    const cols = splitLine(firstLines[li], delim);
    if (cols.length < 2) continue;
    const m = parseMileageToken(cols[mileageCol] ?? '');
    if (!Number.isFinite(m)) continue;
    rawArr.push(m);
    hArr.push(heightCol >= 0 ? parseFloat(cols[heightCol]) || 0 : 6000);
    pArr.push(pullCol >= 0 ? parseFloat(cols[pullCol]) || 0 : 0);
    spArr.push(speedCol >= 0 ? parseFloat(cols[speedCol]) || 0 : 0);
    if (poleCol >= 0) {
      const code = (cols[poleCol] ?? '').trim();
      if (code) poleMarks.push({ rowIndex: rawArr.length - 1, code, rawMileage: m });
    }
  }

  if (rawArr.length < 10) throw new Error('有效数据行过少，请检查 CSV 格式（需包含里程列）');

  return {
    rawMileage: Float64Array.from(rawArr),
    height: Float32Array.from(hArr),
    pull: Float32Array.from(pArr),
    speed: Float32Array.from(spArr),
    poleMarks,
    headers,
    rowCount: rawArr.length,
    hasPoleColumn: poleCol >= 0,
  };
}

/** 把一个 run 导出为“检测车原始 CSV”（里程列为漂移后的 raw，供导入测试） */
export function runToRawCsv(args: {
  rawMileage: ArrayLike<number>;
  height: ArrayLike<number>;
  pull: ArrayLike<number>;
  speed: ArrayLike<number>;
  poleMarks: PoleMark[];
  limitRows?: number;
}): string {
  const { rawMileage, height, pull, speed, poleMarks } = args;
  const n = Math.min(rawMileage.length, args.limitRows ?? Infinity);
  // 过杆行使用“过杆事件自身的（亚米级）里程”，真实检测车 CSV 中该标记里程
  // 比连续采样行更精确；这是对齐能稳定 <0.5m 的关键。
  const markByRow = new Map<number, PoleMark>();
  for (const mk of poleMarks) {
    if (mk.rowIndex < n && !markByRow.has(mk.rowIndex)) markByRow.set(mk.rowIndex, mk);
  }
  const lines = ['序号,里程(m),杆号,导高(mm),拉出值(mm),速度(km/h)'];
  for (let i = 0; i < n; i++) {
    const mk = markByRow.get(i);
    const pole = mk?.code ?? '';
    const mileageCell = mk ? mk.rawMileage : rawMileage[i];
    lines.push(
      [
        i + 1,
        mileageCell.toFixed(3),
        pole,
        height[i].toFixed(1),
        pull[i].toFixed(1),
        speed[i].toFixed(1),
      ].join(','),
    );
  }
  return lines.join('\r\n');
}

/** CSV 模板（含两行示例） */
export const CSV_TEMPLATE = `序号,里程(m),杆号,导高(mm),拉出值(mm),速度(km/h)
1,1000.000,S0020,6002.5,-248.3,82
2,1001.000,,6001.8,-245.1,82
3,1002.000,,6003.1,-240.6,83
...
说明：
1. 必须包含“里程”列，支持 K12+345.6 格式；
2. “杆号”列在经过支柱的行填写杆号，用于和线路档案对齐；
3. 导高单位 mm，拉出值单位 mm（带符号，正负表示方向）；
4. 里程允许存在漂移、跳变与断点，系统会按杆号自动分段修正。`;
