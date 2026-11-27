/**
 * 里程对齐精度验证（Node 端，不依赖浏览器）
 * 用法：npm run test:align
 *
 * 验收目标：漂移/跳变/断点数据对齐后，检测定位点与档案支柱里程偏差 < 0.5m
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildLineProfile } from '../src/lib/lineGenerator';
import { generateAllBatches } from '../src/lib/inspectionGenerator';
import { alignInspection } from '../src/lib/alignment';
import { rowsToCsv } from '../src/lib/csv';
import { formatMileage } from '../src/lib/geometry';

const outDir = join(process.cwd(), 'testdata');
mkdirSync(outDir, { recursive: true });

const profile = buildLineProfile();
const all = generateAllBatches(profile);

interface Row {
  batch: string;
  direction: string;
  samples: number;
  anchors: number;
  anchorMax: number;
  normalP95: number;
  normalMax: number;
  within05: string;
  lowConf: number;
  pass: boolean;
}

const report: Row[] = [];
let globalAnchorMax = 0;
let allAnchorPass = true;
const normalErrorsAll: number[] = [];
const bandErrorsAll: number[] = [];

for (const g of all) {
  const result = alignInspection(g.rows, profile, g.batch.direction, g.batch.id);
  const s = result.summary;
  globalAnchorMax = Math.max(globalAnchorMax, s.maxResidual);
  const anchorPass = s.maxResidual < 0.5;
  if (!anchorPass) allAnchorPass = false;

  const correctedByRaw = new Map(result.samples.map((x) => [x.rawMileage, x]));
  const normalErrors: number[] = [];
  const bandErrors: number[] = [];
  for (const t of g.truthMap) {
    const sample = correctedByRaw.get(t.raw);
    if (!sample) continue;
    const e = Math.abs(sample.mileage - t.truth);
    if (sample.lowConfidence) bandErrors.push(e);
    else normalErrors.push(e);
  }
  normalErrors.sort((a, b) => a - b);
  bandErrors.sort((a, b) => a - b);
  for (const e of normalErrors) normalErrorsAll.push(e);
  for (const e of bandErrors) bandErrorsAll.push(e);
  const pct = (arr: number[], q: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))];

  report.push({
    batch: g.batch.id,
    direction: g.batch.direction === 'up' ? '上行' : '下行',
    samples: g.rows.length,
    anchors: s.total,
    anchorMax: s.maxResidual,
    normalP95: Number(pct(normalErrors, 0.95).toFixed(3)),
    normalMax: Number(normalErrors[normalErrors.length - 1].toFixed(3)),
    within05: `${((normalErrors.filter((e) => e < 0.5).length / normalErrors.length) * 100).toFixed(1)}%`,
    lowConf: bandErrors.length,
    pass: anchorPass,
  });

  // 导出原始 CSV（带漂移），供页面"导入检测车 CSV"功能测试
  writeFileSync(join(outDir, `${g.batch.id}.csv`), rowsToCsv(g.rows), 'utf-8');

  // 真值对照（仅测试用）
  const truthLines = ['rawMileage,truthMileage,correctedMileage,lowConfidence'];
  for (const t of g.truthMap) {
    const sample = correctedByRaw.get(t.raw);
    if (sample) {
      truthLines.push(`${t.raw.toFixed(2)},${t.truth.toFixed(2)},${sample.mileage.toFixed(2)},${sample.lowConfidence ? 1 : 0}`);
    }
  }
  writeFileSync(join(outDir, `${g.batch.id}.truth.csv`), truthLines.join('\n'), 'utf-8');

  // 预埋缺陷清单
  const defectLines = ['truthMileage,poleId,metric,deviationMm,month'];
  for (const d of g.defects) {
    defectLines.push(`${formatMileage(d.truthMileage)},${d.poleId},${d.metric},${d.deviationMm},${d.month}`);
  }
  writeFileSync(join(outDir, `${g.batch.id}.defects.csv`), defectLines.join('\n'), 'utf-8');
}

normalErrorsAll.sort((a, b) => a - b);
bandErrorsAll.sort((a, b) => a - b);
const pctAll = (arr: number[], q: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))];

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('  接触网检测里程对齐精度验证报告（50km 双线 × 3 批次，含漂移/跳变/断点）');
console.log('═══════════════════════════════════════════════════════════════════════');
console.table(report);
console.log('───────────────────────────────────────────────────────────────────────');
console.log('【验收项】支柱定位点（杆号锚点级）对齐残差');
console.log(`  全部批次最大残差: ${globalAnchorMax.toFixed(3)} m   阈值 0.500 m   结论: ${allAnchorPass ? '✅ 通过' : '❌ 未通过'}`);
console.log('───────────────────────────────────────────────────────────────────────');
console.log('【参考项】逐采样点（0.25m 间距）真值误差');
console.log(`  正常区段 n=${normalErrorsAll.length}: P50=${pctAll(normalErrorsAll, 0.5).toFixed(3)}m  P95=${pctAll(normalErrorsAll, 0.95).toFixed(3)}m  P99=${pctAll(normalErrorsAll, 0.99).toFixed(3)}m  Max=${normalErrorsAll[normalErrorsAll.length - 1].toFixed(3)}m`);
console.log(`  正常区 <0.5m 占比: ${((normalErrorsAll.filter((e) => e < 0.5).length / normalErrorsAll.length) * 100).toFixed(2)}%`);
console.log(`  跳变/断点过渡带 n=${bandErrorsAll.length}（系统已标 lowConfidence，不参与超限判定）: P50=${pctAll(bandErrorsAll, 0.5).toFixed(3)}m Max=${bandErrorsAll[bandErrorsAll.length - 1].toFixed(3)}m`);
console.log('───────────────────────────────────────────────────────────────────────');
console.log(`CSV/真值/缺陷文件已输出: ${outDir}`);
console.log('═══════════════════════════════════════════════════════════════════════');

if (!allAnchorPass) process.exit(1);
