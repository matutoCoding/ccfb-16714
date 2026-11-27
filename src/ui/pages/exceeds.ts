import { h, toast, showModal } from '../dom';
import { store } from '../../lib/store';
import { LineChart, type ChartMarker } from '../chart';
import { formatMileage, fmtMm } from '../../lib/geometry';
import { recheckExceed } from '../../lib/exceed';
import type { ExceedPoint, WorkOrder } from '../../types';
import { navigate } from '../router';

export function renderExceeds() {
  const view = document.getElementById('view')!;
  const { profile: maybeProfile, batches, exceeds, workOrders } = store.state;
  if (!maybeProfile) return;
  const profile = maybeProfile;

  let direction: 'up' | 'down' = 'up';
  let metricFilter = 'all';
  let levelFilter = 'all';
  let statusFilter = 'all';

  view.append(
    h('div', { class: 'page-head' }, [
      h('h2', { class: 'page-title' }, ['⚠️ 超限管理与维修工单']),
      h('p', { class: 'page-desc' }, ['按限界自动判级（一级警示/二级严重），超限点可生成工单，下次检测自动复核闭环']),
    ]),
  );

  const l1 = exceeds.filter((e) => e.level === 1).length;
  const l2 = exceeds.filter((e) => e.level === 2).length;
  const handled = exceeds.filter((e) => e.handled).length;
  const openWo = workOrders.filter((w) => w.status !== 'done').length;
  view.append(
    h('div', { class: 'grid grid-4 mb12' }, [
      stat('一级超限', String(l1), '警示', 'warn'),
      stat('二级超限', String(l2), '严重', 'danger'),
      stat('已处理', `${handled}/${exceeds.length}`, '闭环率', 'ok'),
      stat('进行中工单', String(openWo), '待处理', 'accent'),
    ]),
  );

  // 筛选条
  const dirSel = h('select', {}, [
    h('option', { value: 'up' }, ['上行']),
    h('option', { value: 'down' }, ['下行']),
  ]) as HTMLSelectElement;
  const metricSel = h('select', {}, [
    h('option', { value: 'all' }, ['全部指标']),
    h('option', { value: 'height' }, ['导高']),
    h('option', { value: 'stagger' }, ['拉出值']),
  ]) as HTMLSelectElement;
  const levelSel = h('select', {}, [
    h('option', { value: 'all' }, ['全部等级']),
    h('option', { value: '1' }, ['一级']),
    h('option', { value: '2' }, ['二级']),
  ]) as HTMLSelectElement;
  const statusSel = h('select', {}, [
    h('option', { value: 'all' }, ['全部状态']),
    h('option', { value: 'open' }, ['未处理']),
    h('option', { value: 'handled' }, ['已处理']),
  ]) as HTMLSelectElement;
  const exportBtn = h('button', { class: 'btn', id: 'btn-export-exceed' }, ['导出超限报表 CSV']);

  view.append(
    h('div', { class: 'card mb12' }, [
      h('div', { class: 'row' }, [
        inlineField('方向', dirSel),
        inlineField('指标', metricSel),
        inlineField('等级', levelSel),
        inlineField('状态', statusSel),
        h('div', { class: 'spacer' }),
        exportBtn,
      ]),
    ]),
  );

  // 里程分布图
  const chartCard = h('div', { class: 'card mb12' }, [
    h('div', { class: 'card-title' }, ['超限里程分布图（点击标记定位到三维）']),
    h('div', { id: 'exceed-chart' }),
  ]);
  view.append(chartCard);

  const tableWrap = h('div', { class: 'table-wrap' });
  view.append(tableWrap);

  function filtered(): ExceedPoint[] {
    return exceeds
      .filter((e) => e.direction === direction)
      .filter((e) => metricFilter === 'all' || e.metric === metricFilter)
      .filter((e) => levelFilter === 'all' || String(e.level) === levelFilter)
      .filter((e) => (statusFilter === 'all' ? true : statusFilter === 'handled' ? e.handled : !e.handled))
      .sort((a, b) => b.level - a.level || a.mileage - b.mileage);
  }

  function renderChart() {
    const host = document.getElementById('exceed-chart')!;
    host.replaceChildren();
    const list = filtered();
    // 以批次最新一条为基准画导高/拉出曲线（降采样），叠加超限标记
    const latestBatch = [...batches].filter((b) => b.direction === direction).pop();
    const markers: ChartMarker[] = list.map((e) => ({
      x: e.mileage,
      color: e.level === 2 ? '#ef4444' : '#f59e0b',
      data: e,
    }));
    if (!latestBatch) return;
    store.loadSamples(latestBatch.id).then((samples) => {
      const step = Math.max(1, Math.floor(samples.length / 3000));
      const heightPts = samples.filter((_, i) => i % step === 0).map((s) => ({ x: s.mileage, y: s.contactHeight }));
      const staggerPts = samples.filter((_, i) => i % step === 0).map((s) => ({ x: s.mileage, y: s.stagger + 6000 }));
      const chart = new LineChart(
        [
          { name: '导高(mm)', color: '#4f9cf9', points: heightPts },
          { name: '拉出值(mm)+6000 偏置', color: '#14b8a6', points: staggerPts },
        ],
        {
          height: 230,
          markers,
          onMarkerClick: (m) => {
            const e = m.data as ExceedPoint;
            toast(`定位到 ${formatMileage(e.mileage)} 的${e.metric === 'height' ? '导高' : '拉出值'}超限`, 'info');
            navigate('replay');
          },
        },
      );
      host.append(chart.element);
    });
  }

  function renderTable() {
    const list = filtered();
    const poleMap = new Map(profile.poles.map((p) => [p.id, p]));
    const batchMap = new Map(batches.map((b) => [b.id, b]));
    tableWrap.replaceChildren(
      h('table', {}, [
        h('thead', {}, [
          h('tr', {}, [
            h('th', {}, ['等级']),
            h('th', {}, ['指标']),
            h('th', {}, ['里程']),
            h('th', {}, ['杆号']),
            h('th', {}, ['批次/日期']),
            h('th', { class: 'num' }, ['实测']),
            h('th', { class: 'num' }, ['设计']),
            h('th', { class: 'num' }, ['偏差']),
            h('th', { class: 'num' }, ['限界']),
            h('th', {}, ['状态']),
            h('th', {}, ['操作']),
          ]),
        ]),
        h('tbody', {}, [
          ...list.slice(0, 300).map((e) => {
            const pole = poleMap.get(e.nearestPoleId);
            const batch = batchMap.get(e.batchId);
            return h('tr', { class: 'clickable', onClick: () => showExceedDetail(e) }, [
              h('td', {}, [h('span', { class: `badge ${e.level === 2 ? 'badge-l2' : 'badge-l1'}` }, [e.level === 2 ? '二级' : '一级'])]),
              h('td', {}, [e.metric === 'height' ? '导高' : '拉出值']),
              h('td', { class: 'mono' }, [formatMileage(e.mileage)]),
              h('td', { class: 'mono' }, [pole?.poleNo ?? '—']),
              h('td', { class: 'dim' }, [batch ? `${batch.inspectDate}` : e.batchId]),
              h('td', { class: 'num mono' }, [String(e.value)]),
              h('td', { class: 'num mono muted' }, [String(e.design)]),
              h('td', { class: `num mono ${Math.abs(e.deviation) >= e.limit ? 'text-danger' : 'text-warn'}` }, [fmtMm(e.deviation)]),
              h('td', { class: 'num mono muted' }, [String(e.limit)]),
              h('td', {}, [e.handled ? h('span', { class: 'badge badge-ok' }, ['已处理']) : h('span', { class: 'badge badge-muted' }, ['未处理'])]),
              h('td', {}, [
                h('button', {
                  class: 'btn btn-sm',
                  onClick: (ev) => { ev.stopPropagation(); showExceedDetail(e); },
                }, [e.workOrderId ? '看工单' : '处理']),
              ]),
            ]);
          }),
        ]),
      ]),
    );
    if (list.length > 300) tableWrap.append(h('div', { class: 'muted', style: 'padding:10px;text-align:center' }, [`显示前 300 / 共 ${list.length} 条`]));
  }

  function showExceedDetail(e: ExceedPoint) {
    const pole = profile.poles.find((p) => p.id === e.nearestPoleId);
    const wo = workOrders.find((w) => w.exceedId === e.id);
    const desc = h('textarea', { rows: 3, placeholder: '描述缺陷现象、处理措施…', style: 'width:100%' }) as HTMLTextAreaElement;
    const handler = h('input', { placeholder: '处理人', style: 'width:100%' }) as HTMLInputElement;
    const result = h('textarea', { rows: 2, placeholder: '处理结果（完成后填写）', style: 'width:100%' }) as HTMLTextAreaElement;

    const content = h('div', {}, [
      h('div', { class: 'grid grid-3 mb12' }, [
        kv('里程', formatMileage(e.mileage)),
        kv('杆号', pole?.poleNo ?? '—'),
        kv('等级', e.level === 2 ? '二级（严重）' : '一级（警示）'),
        kv('指标', e.metric === 'height' ? '导高' : '拉出值'),
        kv('实测/设计', `${e.value} / ${e.design} mm`),
        kv('偏差/限界', `${fmtMm(e.deviation)} / ${e.limit} mm`),
      ]),
      wo ? renderWorkOrderBlock(wo, e) : null,
      h('div', { class: 'field mt16' }, [h('label', {}, ['缺陷描述']), desc]),
      h('div', { class: 'field' }, [h('label', {}, ['处理人']), handler]),
      h('div', { class: 'field' }, [h('label', {}, ['处理结果']), result]),
      h('div', { class: 'row', style: 'justify-content:flex-end' }, [
        h('button', {
          class: 'btn btn-primary',
          onClick: async () => {
            const order: WorkOrder = wo ?? {
              id: `WO-${Date.now()}`,
              exceedId: e.id,
              batchId: e.batchId,
              createdAt: Date.now(),
              mileage: e.mileage,
              poleNo: pole?.poleNo ?? '',
              metric: e.metric,
              description: desc.value || `${e.metric === 'height' ? '导高' : '拉出值'}超限处理`,
              status: 'open',
            };
            order.description = desc.value || order.description;
            order.handler = handler.value || order.handler;
            if (result.value) {
              order.result = result.value;
              order.status = 'done';
              order.handledAt = Date.now();
              e.handled = true;
              e.workOrderId = order.id;
              await store.updateExceed(e);
            } else {
              order.status = order.status === 'done' ? 'done' : 'processing';
              e.workOrderId = order.id;
              await store.updateExceed(e);
            }
            await store.putWorkOrder(order);
            toast('工单已保存', 'ok');
            close();
            renderExceeds();
          },
        }, [wo ? '更新工单' : '生成并派单']),
      ]),
    ]);
    const close = showModal('超限点详情与工单', content, { width: 720 });
  }

  function renderWorkOrderBlock(wo: WorkOrder, e: ExceedPoint) {
    const recheck = wo.recheck;
    return h('div', { class: 'card' }, [
      h('div', { class: 'card-title' }, ['关联工单', h('span', { class: `badge ${wo.status === 'done' ? 'badge-ok' : 'badge-l1'}` }, [statusText(wo.status)])]),
      h('div', { class: 'timeline' }, [
        h('div', { class: 'timeline-item' }, [h('strong', {}, ['工单创建']), h('div', { class: 'muted' }, [new Date(wo.createdAt).toLocaleString('zh-CN')])]),
        wo.handledAt
          ? h('div', { class: 'timeline-item done' }, [
              h('strong', {}, ['处理完成']),
              h('div', { class: 'dim' }, [`处理人：${wo.handler ?? '—'}`]),
              h('div', { class: 'dim' }, [`结果：${wo.result ?? '—'}`]),
            ])
          : null,
        recheck
          ? h('div', { class: `timeline-item ${recheck.passed ? 'done' : 'fail'}` }, [
              h('strong', {}, [recheck.passed ? '下次检测复核通过 ✅' : '下次检测复核未通过 ❌']),
              h('div', { class: 'dim' }, [`复核值 ${recheck.value}mm，偏差 ${fmtMm(recheck.deviation)}mm`]),
            ])
          : h('div', { class: 'timeline-item' }, [h('strong', { class: 'muted' }, ['等待下次检测自动复核'])]),
      ]),
      h('button', {
        class: 'btn btn-sm mt8',
        onClick: () => manualRecheck(wo, e),
      }, ['立即用最新批次复核']),
    ]);
  }

  async function manualRecheck(wo: WorkOrder, e: ExceedPoint) {
    const later = batches
      .filter((b) => b.direction === e.direction && b.inspectDate > (batches.find((x) => x.id === e.batchId)?.inspectDate ?? ''))
      .sort((a, b) => b.inspectDate.localeCompare(a.inspectDate))[0];
    if (!later) {
      toast('没有更新的检测批次可用于复核', 'warn');
      return;
    }
    const samples = await store.loadSamples(later.id);
    const r = recheckExceed(e, samples, store.state.settings.limits, profile);
    wo.recheck = { batchId: later.id, value: r.value, deviation: r.deviation, passed: r.passed, at: Date.now() };
    await store.putWorkOrder(wo);
    toast(r.passed ? `复核通过：偏差降至 ${r.deviation}mm` : `复核未通过：偏差仍有 ${r.deviation}mm`, r.passed ? 'ok' : 'err', 5000);
    renderExceeds();
  }

  // 事件
  dirSel.addEventListener('change', () => { direction = dirSel.value as 'up' | 'down'; renderChart(); renderTable(); });
  metricSel.addEventListener('change', () => { metricFilter = metricSel.value; renderChart(); renderTable(); });
  levelSel.addEventListener('change', () => { levelFilter = levelSel.value; renderChart(); renderTable(); });
  statusSel.addEventListener('change', () => { statusFilter = statusSel.value; renderTable(); });
  exportBtn.addEventListener('click', () => {
    import('../../lib/csv').then(({ exceedReportCsv, downloadText }) => {
      const csv = exceedReportCsv(filtered(), batches, profile);
      downloadText(`超限报表_${direction}_${new Date().toISOString().slice(0, 10)}.csv`, csv);
      toast('超限报表已导出', 'ok');
    });
  });

  renderChart();
  renderTable();
}

function statusText(s: WorkOrder['status']) {
  return s === 'done' ? '已完成' : s === 'processing' ? '处理中' : '待处理';
}
function kv(k: string, v: string) {
  return h('div', {}, [h('div', { class: 'muted', style: 'font-size:12px' }, [k]), h('div', { class: 'mono' }, [v])]);
}
function inlineField(label: string, control: HTMLElement) {
  return h('div', { class: 'field', style: 'margin:0' }, [h('label', {}, [label]), control]);
}
function stat(label: string, num: string, sub: string, tone: string) {
  const color = tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : 'text-accent';
  return h('div', { class: 'card stat' }, [
    h('span', { class: 'stat-label' }, [label]),
    h('span', { class: `stat-num ${color}` }, [num]),
    h('span', { class: 'stat-sub muted' }, [sub]),
  ]);
}
