/**
 * CSV 导入往返自检：
 *   npm run check:csv
 * 用演示 run 生成“检测车原始 CSV（漂移里程 + 杆号列）”，
 * 再走与页面完全相同的 parseDetectionCsv + alignRun，断言精度 <0.5m。
 */
import { generateDataset } from '../src/core/seed';
import { runToRawCsv, parseDetectionCsv } from '../src/core/csv';
import { alignRun } from '../src/core/alignment';

const data = generateDataset();
const line = data.line;
let worstCv = 0;

for (const run of data.runs.slice(0, 2)) {
  const csv = runToRawCsv({
    rawMileage: run.rawMileage,
    height: run.height,
    pull: run.pull,
    speed: run.speed,
    poleMarks: run.poleMarks,
  });
  const parsed = parseDetectionCsv(csv);
  const archivePoles = data.poles.filter((p) => p.track === run.track);
  const { report } = alignRun({
    rawMileage: parsed.rawMileage,
    poleMarks: parsed.poleMarks,
    archivePoles,
    tolerance: 0.5,
  });
  worstCv = Math.max(worstCv, report.maxCvError);
  console.log(
    `${run.id}  CSV ${parsed.rowCount} 行, 杆号列=${parsed.hasPoleColumn}, 过杆 ${parsed.poleMarks.length}, ` +
      `匹配 ${report.matchedPoleCount}, CV最大 ${report.maxCvError.toFixed(3)}m, RMS ${report.rmsCvError.toFixed(3)}m`,
  );
  if (report.maxCvError >= 0.5) {
    console.error('❌ CSV 往返对齐精度未达 <0.5m');
    process.exit(1);
  }
}
console.log(`✅ CSV 导入往返对齐通过，全局最大 CV 误差 ${worstCv.toFixed(3)}m < 0.5m`);
