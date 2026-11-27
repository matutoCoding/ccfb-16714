/**
 * 里程对齐精度自检：
 *   npm run check:align
 * 生成 50km 双线 × 3 个月演示数据（含漂移/跳变/断点），
 * 运行对齐引擎，输出每个 run 的留一杆交叉验证误差与全采样真值误差，
 * 强制断言两者最大值 < 0.5m。
 */
import { generateDataset } from '../src/core/seed';

const data = generateDataset();

console.log('============================================================');
console.log(' 接触网检测数据 · 里程对齐精度自检');
console.log('============================================================');
console.log(`线路: ${data.line.name}  长度 ${data.line.totalLength / 1000} km 双线`);
console.log(`支柱: ${data.poles.length} 根  锚段: ${data.anchors.length} 个`);
console.log(`吊弦: ${data.droppers.length} 根  批次: ${data.batches.length} 个`);
console.log(`缺陷总数: ${data.defects.length}  工单: ${data.workOrders.length}`);
console.log('------------------------------------------------------------');

let globalMaxCv = 0;
let globalMaxTrue = 0;
let fail = false;

for (const run of data.runs) {
  const r = run.report;
  globalMaxCv = Math.max(globalMaxCv, r.maxCvError);
  globalMaxTrue = Math.max(globalMaxTrue, r.maxTrueError ?? 0);
  const jumps = r.jumps.length;
  const breaks = r.breaks.length;
  const l2 = data.defects.filter((d) => d.runId === run.id && d.level === 2).length;
  const l1 = data.defects.filter((d) => d.runId === run.id && d.level === 1).length;
  console.log(
    `${run.id.padEnd(22)} 采样 ${String(run.pointCount).padStart(5)}  ` +
      `锚点 ${String(r.matchedPoleCount).padStart(4)}/${r.archivePoleCount}  ` +
      `跳变 ${jumps} 断点 ${breaks} 段 ${r.segments.length}  ` +
      `CV最大 ${r.maxCvError.toFixed(3)}m RMS ${r.rmsCvError.toFixed(3)}m  ` +
      `真值最大 ${(r.maxTrueError ?? NaN).toFixed(3)}m  ` +
      `超限 一${l1}/二${l2}  ${r.pass ? 'PASS' : 'FAIL'}`,
  );
  if (!r.pass) fail = true;
}

console.log('------------------------------------------------------------');
console.log(`全局最大留一杆误差 : ${globalMaxCv.toFixed(3)} m  (要求 < 0.5 m)`);
console.log(`全局最大真值误差   : ${globalMaxTrue.toFixed(3)} m  (要求 < 0.5 m)`);

// 工单复核结果
for (const wo of data.workOrders) {
  if (wo.verification) {
    console.log(
      `工单 ${wo.code} 复核: ${wo.verification.passed ? '通过' : '未过'} ` +
        `${wo.verification.beforeValue} → ${wo.verification.afterValue} (降幅 ${wo.verification.reductionPct}%)`,
    );
  }
}

if (globalMaxCv >= 0.5 || globalMaxTrue >= 0.5 || fail) {
  console.error('❌ 对齐精度未达到 <0.5m 要求');
  process.exit(1);
}
console.log('✅ 所有 run 对齐后支柱位置偏差 < 0.5m');
