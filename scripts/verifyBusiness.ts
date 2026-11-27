/**
 * 业务闭环集成验证（Node）
 */
import { buildLineProfile } from '../src/lib/lineGenerator';
import { generateBatch } from '../src/lib/inspectionGenerator';
import { alignInspection } from '../src/lib/alignment';
import { detectExceeds, recheckExceed, DEFAULT_LIMITS } from '../src/lib/exceed';
import { nearestPole } from '../src/lib/catenary';

const profile = buildLineProfile();
const dir = 'up' as const;
const months = [0, 1, 2].map((m) => {
  const g = generateBatch(profile, dir, m, 20260901);
  const aligned = alignInspection(g.rows, profile, dir, g.batch.id);
  const exceed = detectExceeds(aligned.samples, g.batch, profile, DEFAULT_LIMITS);
  return { g, aligned, exceed };
});

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name} ${detail}`);
  ok ? pass++ : fail++;
};

console.log('════════ 1. 趋势渐变定位点 ════════');
const trendPole = nearestPole(profile.poles.filter((p) => p.direction === dir), 7400);
const series = months.map(({ aligned }) => {
  const near = aligned.samples.filter((s) => Math.abs(s.mileage - trendPole.mileage) < 5);
  return Math.min(...near.map((s) => s.contactHeight));
});
console.log('杆号', trendPole.poleNo, '定位点导高:', series, '逐月差:', series.slice(1).map((v, i) => v - series[i]));
check('K7.4 定位点三个月导高单调下沉', series[1] < series[0] && series[2] < series[1]);

console.log('\n════════ 2. 工单复核闭环 ════════');
const firstStagger = months[0].exceed.points.find((p) => p.metric === 'stagger' && Math.abs(p.mileage - 12600) < 200);
check('首月 K12.6 拉出二级超限可检出', !!firstStagger && firstStagger.level === 2, firstStagger ? `value=${firstStagger.value}` : '');
if (firstStagger) {
  const r3 = recheckExceed(firstStagger, months[2].aligned.samples, DEFAULT_LIMITS, profile);
  check('已修复缺陷第 3 月复核通过', r3.passed, JSON.stringify(r3));
}
// K20.3 预埋导高缺陷 72mm（+发展约 78mm），介于一级50/二级100 之间，应稳定检出一级且偏差显著
const heightNear = months[0].exceed.points
  .filter((p) => p.metric === 'height' && Math.abs(p.mileage - 20300) < 300)
  .sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation))[0];
check('K20.3 显著导高超限可检出', !!heightNear && Math.abs(heightNear.deviation) >= 70, heightNear ? `dev=${heightNear.deviation} L${heightNear.level}` : '');
if (heightNear) {
  const r3 = recheckExceed(heightNear, months[2].aligned.samples, DEFAULT_LIMITS, profile);
  check('持续缺陷第 3 月复核不通过', !r3.passed, JSON.stringify(r3));
}

console.log('\n════════ 3. 采集断点数据空缺 ════════');
for (const { g, aligned } of months) {
  const core = aligned.samples.filter((s) => s.mileage >= 41300 && s.mileage < 41700);
  check(`${g.batch.id} 断点核心区无数据`, core.length === 0, `采样=${core.length}`);
}

console.log('\n════════ 4. 超限点本身不来自低置信采样 ════════');
// detectExceeds 逐采样跳过 lowConfidence，故登记的 worst 采样必为高置信；
// 直接验证每个超限里程最近的采样里，最差点不带 lowConfidence 标记
let leak = 0;
for (const { aligned, exceed } of months) {
  for (const p of exceed.points) {
    const closest = aligned.samples.reduce((best, cur) =>
      Math.abs(cur.mileage - p.mileage) < Math.abs(best.mileage - p.mileage) ? cur : best,
    );
    if (closest.lowConfidence) leak++;
  }
}
check('超限点对应最近采样为高置信', leak === 0, `泄漏=${leak}`);

console.log(`\n════════ 结果：${pass} 通过 / ${fail} 失败 ════════`);
if (fail) process.exit(1);
