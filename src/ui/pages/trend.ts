import { h } from '../dom';
import { store } from '../../lib/store';
import { LineChart } from '../chart';
import { formatMileage, fmtMm } from '../../lib/geometry';
import type { Direction, InspectionSample, Pole } from '../../types';

interface PoleTrend {
  pole: Pole;
  values: Array<{ batchId: string; date: string; height: number; stagger: number }>;
  heightDelta: number; // 首末差
  staggerDelta: number;
  heightDrift: number; // 单调变化量（持续变化得分）
}

export function renderTrend() {
  const view = document.getElementById('view')!;
  const { profile: maybeProfile, batches, settings } = store.state;
  if (!maybeProfile) return;
  const profile = maybeProfile;

  let direction: Direction = 'up';
  let metric: 'height' | 'stagger' = 'height';
  let rangeFrom = 0;
  let rangeTo = 3000;

  view.append(
    h('div', { class: 'page-head' }, [
      h('h2', { class: 'page-title' }, ['📈 多批次趋势对比']),
      h('p', { class: 'page-desc' }, ['同一区段多个月检测数据叠加，识别持续变化的定位点，提前发现结构性劣化']),
    ]),
  );

  const dirSel = h('select', {}, [
    h('option', { value: 'up' }, ['上行']),
    h('option', { value: 'down' }, ['下行']),
  ]) as HTMLSelectElement;
  const metricSel = h('select', {}, [
    h('option', { value: 'height' }, ['接触线导高']),
    h('option', { value: 'stagger' }, ['之字形拉出值']),
  ]) as HTMLSelectElement;
  const fromInput = h('input', { type: 'number', value: '0', min: '0', style: 'width:110px' }) as HTMLInputElement;
  const toInput = h('input', { type: 'number', value: '3000', min: '0', style: 'width:110px' }) as HTMLInputElement;
  const winSel = h('select', {}, [
    h('option', { value: '3000' }, ['3 km 窗口']),
    h('option', { value: '5000' }, ['5 km 窗口']),
    h('option', { value: '10000' }, ['10 km 窗口']),
    h('option', { value: '50000' }, ['全线']),
  ]) as HTMLSelectElement;

  view.append(
    h('div', { class: 'card mb12' }, [
      h('div', { class: 'row aic' }, [
        inline('方向', dirSel),
        inline('指标', metricSel),
        inline('窗口起点(m)', fromInput),
        inline('窗口终点(m)', toInput),
        inline('快捷窗口', winSel),
        h('button', { class: 'btn btn-primary', id: 'btn-apply-trend' }, ['应用']),
      ]),
    ]),
  );

  const chartHost = h('div', { class: 'card mb12' }, [
    h('div', { class: 'card-title' }, ['区段曲线叠加']),
    h('div', { id: 'trend-chart' }),
    h('div', { id: 'trend-legend', class: 'mt8' }),
  ]);
  view.append(chartHost);

  const rankHost = h('div', { class: 'card' }, [
    h('div', { class: 'card-title' }, ['持续变化定位点排名（按首末检测差值）']),
    h('div', { id: 'trend-rank' }),
  ]);
  view.append(rankHost);

  const batchesOf = (d: Direction) => batches.filter((b) => b.direction === d).sort((a, b) => a.inspectDate.localeCompare(b.inspectDate));

  async function loadAll(d: Direction): Promise<Array<{ batchId: string; date: string; samples: InspectionSample[] }>> {
    const bs = batchesOf(d);
    const out = [];
    for (const b of bs) {
      out.push({ batchId: b.id, date: b.inspectDate, samples: await store.loadSamples(b.id) });
    }
    return out;
  }

  function valueAt(samples: InspectionSample[], m: number) {
    let lo = 0;
    let hi = samples.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].mileage < m) lo = mid + 1;
      else hi = mid;
    }
    return samples[lo];
  }

  async function render() {
    const all = await loadAll(direction);
    // 曲线叠加（窗口内降采样）
    const chartEl = document.getElementById('trend-chart')!;
    chartEl.replaceChildren();
    const series = all.map((entry, i) => {
      const inWindow = entry.samples.filter((s) => s.mileage >= rangeFrom && s.mileage <= rangeTo);
      const step = Math.max(1, Math.floor(inWindow.length / 1400));
      const points = inWindow
        .filter((_, idx) => idx % step === 0)
        .map((s) => ({ x: s.mileage, y: metric === 'height' ? s.contactHeight : s.stagger }));
      return { name: entry.date, color: settings.trendColors[i % settings.trendColors.length], points, width: 1.8 };
    });
    const refs =
      metric === 'height'
        ? [
            { y: profile.designHeight + settings.limits.heightWarn, color: '#f59e0b', label: '一级限界' },
            { y: profile.designHeight - settings.limits.heightWarn, color: '#f59e0b' },
          ]
        : [
            { y: settings.limits.staggerWarn, color: '#f59e0b', label: '一级限界' },
            { y: -settings.limits.staggerWarn, color: '#f59e0b' },
          ];
    const chart = new LineChart(series, { height: 300, yUnit: 'mm', yRefs: refs });
    chartEl.append(chart.element);
    document.getElementById('trend-legend')!.replaceChildren(
      h('div', { class: 'legend' }, series.map((s) => h('span', {}, [h('span', { class: 'dot', style: `background:${s.color}` }), s.name]))),
    );

    // 定位点级趋势
    const poles = profile.poles.filter((p) => p.direction === direction);
    const trends: PoleTrend[] = [];
    for (const pole of poles) {
      if (pole.mileage < rangeFrom || pole.mileage > rangeTo) continue;
      const values = all.map((entry) => {
        const s = valueAt(entry.samples, pole.mileage);
        return { batchId: entry.batchId, date: entry.date, height: s.contactHeight, stagger: s.stagger };
      });
      if (values.length < 2) continue;
      const heightDelta = values[values.length - 1].height - values[0].height;
      const staggerDelta = values[values.length - 1].stagger - values[0].stagger;
      // 单调得分：相邻差值同号占比 × 总变化
      const hSteps = values.slice(1).map((v, i) => v.height - values[i].height);
      const sameSign = hSteps.filter((d) => Math.sign(d) === Math.sign(heightDelta) && Math.sign(d) !== 0).length;
      const heightDrift = Math.abs(heightDelta) * (sameSign / Math.max(1, hSteps.length));
      trends.push({ pole, values, heightDelta, staggerDelta, heightDrift });
    }
    const key = metric === 'height' ? 'heightDrift' : 'staggerDelta';
    const ranked = [...trends].sort((a, b) => Math.abs(b[key] as number) - Math.abs(a[key] as number)).slice(0, 25);
    const rankEl = document.getElementById('trend-rank')!;
    rankEl.replaceChildren(
      h('div', { class: 'table-wrap' }, [
        h('table', {}, [
          h('thead', {}, [
            h('tr', {}, [
              h('th', {}, ['杆号']),
              h('th', {}, ['里程']),
              ...all.map((a) => h('th', { class: 'num' }, [a.date.slice(5)])),
              h('th', { class: 'num' }, ['首末差(mm)']),
              h('th', {}, ['趋势']),
            ]),
          ]),
          h('tbody', {}, [
            ...ranked.map((t) => {
              const delta = metric === 'height' ? t.heightDelta : t.staggerDelta;
              const vals = t.values.map((v) => (metric === 'height' ? v.height : v.stagger));
              const monotonic = vals.every((v, i) => i === 0 || (delta >= 0 ? v >= vals[i - 1] - 2 : v <= vals[i - 1] + 2));
              return h('tr', {}, [
                h('td', { class: 'mono' }, [t.pole.poleNo]),
                h('td', { class: 'mono dim' }, [formatMileage(t.pole.mileage)]),
                ...vals.map((v) => h('td', { class: 'num mono' }, [String(v)])),
                h('td', { class: `num mono ${Math.abs(delta) >= 10 ? 'text-warn' : ''}` }, [fmtMm(delta)]),
                h('td', {}, [monotonic ? h('span', { class: 'badge badge-l2' }, ['持续劣化']) : h('span', { class: 'badge badge-info' }, ['波动'])]),
              ]);
            }),
          ]),
        ]),
      ]),
    );
  }

  dirSel.addEventListener('change', () => { direction = dirSel.value as Direction; render(); });
  metricSel.addEventListener('change', () => { metric = metricSel.value as 'height' | 'stagger'; render(); });
  winSel.addEventListener('change', () => {
    const w = Number(winSel.value);
    rangeTo = Math.min(profile.totalLength, rangeFrom + w);
    fromInput.value = String(rangeFrom);
    toInput.value = String(rangeTo);
  });
  document.getElementById('btn-apply-trend')!.addEventListener('click', () => {
    rangeFrom = Math.max(0, Number(fromInput.value) || 0);
    rangeTo = Math.min(profile.totalLength, Number(toInput.value) || profile.totalLength);
    render();
  });

  render();
}

function inline(label: string, control: HTMLElement) {
  return h('div', { class: 'field', style: 'margin:0' }, [h('label', {}, [label]), control]);
}
