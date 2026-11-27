import { h, toast, showModal, showLoading, hideLoading } from '../dom';
import { store } from '../../lib/store';
import { parseCsv } from '../../lib/csv';
import { alignInspection, type AlignResult } from '../../lib/alignment';
import { detectExceeds } from '../../lib/exceed';
import { formatMileage } from '../../lib/geometry';
import { LineChart } from '../chart';
import type { InspectionBatch, RawCsvRow } from '../../types';

export function renderBatches() {
  const view = document.getElementById('view')!;
  const { profile, batches } = store.state;
  if (!profile) return;

  view.append(
    h('div', { class: 'page-head jcsb flex aic' }, [
      h('div', {}, [
        h('h2', { class: 'page-title' }, ['📦 检测批次与里程对齐']),
        h('p', { class: 'page-desc' }, ['导入检测车 CSV，按杆号锚点自动识别里程漂移/跳变/断点并保形修正']),
      ]),
      h('div', { class: 'row' }, [
        h('button', { class: 'btn', id: 'btn-template', onClick: downloadTemplate }, ['下载 CSV 模板']),
        h('button', { class: 'btn btn-primary', id: 'btn-import' }, ['导入检测车 CSV']),
      ]),
    ]),
  );

  // 统计卡
  const totalSamples = batches.reduce((s, b) => s + b.sampleCount, 0);
  const issueCount = batches.reduce((s, b) => s + b.mileageIssues.length, 0);
  const passCount = batches.filter((b) => (b.alignSummary?.maxResidual ?? 1) < 0.5).length;
  view.append(
    h('div', { class: 'grid grid-4 mb12' }, [
      statCard('批次总数', String(batches.length), '上下行 × 三个月'),
      statCard('采样点总量', totalSamples.toLocaleString(), '0.25m 间距'),
      statCard('识别里程问题', String(issueCount), '漂移/跳变/断点'),
      statCard('对齐达标批次', `${passCount}/${batches.length}`, '残差 < 0.5m'),
    ]),
  );

  // 批次表
  const tableWrap = h('div', { class: 'table-wrap' });
  view.append(tableWrap);
  tableWrap.append(buildBatchTable(batches));

  // 隐藏文件输入
  const fileInput = h('input', {
    type: 'file',
    accept: '.csv,text/csv',
    style: 'display:none',
  }) as HTMLInputElement;
  fileInput.addEventListener('change', () => handleImport(fileInput));
  view.append(fileInput);
  document.getElementById('btn-import')!.addEventListener('click', () => fileInput.click());
}

function buildBatchTable(batches: InspectionBatch[]) {
  const { exceeds } = store.state;
  const rows = [...batches].sort((a, b) => b.inspectDate.localeCompare(a.inspectDate));
  return h('table', {}, [
    h('thead', {}, [
      h('tr', {}, [
        h('th', {}, ['批次']),
        h('th', {}, ['方向']),
        h('th', {}, ['检测日期']),
        h('th', { class: 'num' }, ['采样点']),
        h('th', {}, ['里程问题']),
        h('th', { class: 'num' }, ['最大残差(m)']),
        h('th', { class: 'num' }, ['<0.5m 锚点']),
        h('th', { class: 'num' }, ['超限点']),
        h('th', {}, ['对齐详情']),
      ]),
    ]),
    h('tbody', {}, [
      ...rows.map((b) => {
        const ex = exceeds.filter((e) => e.batchId === b.id).length;
        const summary = b.alignSummary;
        return h('tr', {}, [
          h('td', {}, [b.name]),
          h('td', {}, [h('span', { class: 'badge badge-info' }, [b.direction === 'up' ? '上行' : '下行'])]),
          h('td', { class: 'mono' }, [b.inspectDate]),
          h('td', { class: 'num' }, [b.sampleCount.toLocaleString()]),
          h('td', {}, [
            h('div', { class: 'row gap8' }, [
              ...b.mileageIssues.slice(0, 3).map((i) =>
                h('span', { class: `badge tag-${i.kind}` }, [issueLabel(i.kind)]),
              ),
              ...(b.mileageIssues.length > 3 ? [h('span', { class: 'muted' }, [`+${b.mileageIssues.length - 3}`])] : []),
            ]),
          ]),
          h('td', { class: `num mono ${(summary?.maxResidual ?? 1) < 0.5 ? 'text-ok' : 'text-danger'}` }, [
            summary ? summary.maxResidual.toFixed(3) : '—',
          ]),
          h('td', { class: 'num mono' }, [
            summary ? `${summary.within05}/${summary.total}` : '—',
          ]),
          h('td', { class: 'num' }, [String(ex)]),
          h('td', {}, [
            h('button', { class: 'btn btn-sm', onClick: () => showAlignDetail(b) }, ['查看对齐']),
          ]),
        ]);
      }),
    ]),
  ]);
}

function issueLabel(kind: string) {
  return kind === 'drift' ? '漂移' : kind === 'jump' ? '跳变' : '断点';
}

function statCard(label: string, num: string, sub: string) {
  return h('div', { class: 'card stat' }, [
    h('span', { class: 'stat-label' }, [label]),
    h('span', { class: 'stat-num' }, [num]),
    h('span', { class: 'stat-sub muted' }, [sub]),
  ]);
}

function showAlignDetail(batch: InspectionBatch) {
  const profile = store.state.profile!;
  store.loadSamples(batch.id).then((samples) => {
    // 用原始/对齐里程重算控制点（从批次缓存不可得，这里用采样自身的 raw/mileage 画对照）
    const step = Math.max(1, Math.floor(samples.length / 4000));
    const rawPts = samples.filter((_, i) => i % step === 0).map((s) => ({ x: s.mileage, y: s.rawMileage - s.mileage }));
    const residualPts = (batch.alignSummary?.poleResiduals ?? []).map((r) => {
      const pole = profile.poles.find((p) => p.id === r.poleId);
      return { x: pole?.mileage ?? 0, y: r.residual };
    });

    const offsetChart = new LineChart(
      [{ name: '里程偏移 raw−corrected (m)', color: '#8b5cf6', points: rawPts, width: 2 }],
      { height: 220, yUnit: 'm', markers: buildIssueMarkers(batch) },
    );
    const residualChart = new LineChart(
      [{ name: '锚点对齐残差 (m)', color: '#22c55e', points: residualPts, width: 2 }],
      { height: 180, yUnit: 'm', yRefs: [{ y: 0.5, color: '#ef4444', label: '验收 0.5m' }] },
    );

    const content = h('div', {}, [
      summaryBlock(batch),
      h('div', { class: 'card-title mt16' }, ['里程偏移曲线（漂移/跳变/断点形态）']),
      offsetChart.element,
      h('div', { class: 'card-title mt16' }, ['支柱锚点对齐残差']),
      residualChart.element,
      h('div', { class: 'card-title mt16' }, ['识别出的里程问题']),
      ...batch.mileageIssues.map((i) =>
        h('div', { class: 'mini-exceed mb12' }, [
          h('div', { class: 'row jcsb' }, [
            h('span', { class: `badge tag-${i.kind}` }, [issueLabel(i.kind)]),
            h('span', { class: 'mono muted' }, [
              `${formatMileage(i.rawStartMileage)} → ${formatMileage(i.rawEndMileage)}`,
            ]),
          ]),
          h('div', { class: 'dim mt8' }, [i.detail]),
        ]),
      ),
    ]);
    showModal(`对齐详情 · ${batch.name}`, content, { width: 820 });
  });
}

function buildIssueMarkers(batch: InspectionBatch) {
  const colorOf = (k: string) => (k === 'jump' ? '#ef4444' : k === 'gap' ? '#f59e0b' : '#8b5cf6');
  return batch.mileageIssues.map((i) => ({
    x: i.rawStartMileage,
    color: colorOf(i.kind),
    label: issueLabel(i.kind),
  }));
}

function summaryBlock(batch: InspectionBatch) {
  const s = batch.alignSummary;
  if (!s) return h('div', { class: 'muted' }, ['无对齐摘要']);
  return h('div', { class: 'grid grid-4' }, [
    statCard('最大残差', `${s.maxResidual.toFixed(3)}m`, '验收 < 0.5m'),
    statCard('平均残差', `${s.meanResidual.toFixed(3)}m`, '锚点级'),
    statCard('RMS 残差', `${s.rmsResidual.toFixed(3)}m`, ''),
    statCard('达标锚点', `${s.within05}/${s.total}`, `${((s.within05 / s.total) * 100).toFixed(1)}%`),
  ]);
}

async function handleImport(input: HTMLInputElement) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const profile = store.state.profile!;
  try {
    const text = await file.text();
    const rows: RawCsvRow[] = parseCsv(text);
    // 从数据无法直接知道方向，弹窗选择
    const direction = await askDirection();
    if (!direction) return;
    showLoading('解析 CSV 并执行里程对齐…', 1, 4);

    const batchId = `B-${direction}-${Date.now()}`;
    let result: AlignResult;
    try {
      result = alignInspection(rows, profile, direction, batchId);
    } catch (e) {
      hideLoading();
      toast(`对齐失败：${(e as Error).message}`, 'err', 6000);
      return;
    }
    showLoading('保存批次与采样…', 2, 4);
    const batch: InspectionBatch = {
      id: batchId,
      name: `${direction === 'up' ? '上行' : '下行'}导入 ${new Date().toLocaleDateString('zh-CN')}`,
      lineId: profile.id,
      direction,
      inspectDate: new Date().toISOString().slice(0, 10),
      importedAt: Date.now(),
      sampleStep: 0.25,
      sampleCount: result.samples.length,
      mileageIssues: result.issues,
      alignSummary: result.summary,
      note: `来源文件：${file.name}`,
    };
    await store.persistBatch(batch, result.samples);
    showLoading('超限自动判定…', 3, 4);
    const exceed = detectExceeds(result.samples, batch, profile, store.state.settings.limits);
    await store.persistExceeds(exceed.points);
    hideLoading();
    toast(`导入完成：${result.samples.length} 采样，${result.issues.length} 个里程问题，最大锚点残差 ${result.summary.maxResidual.toFixed(3)}m`, 'ok', 5000);
    renderBatches();
  } catch (e) {
    hideLoading();
    toast(`CSV 解析失败：${(e as Error).message}`, 'err', 6000);
  }
}

function askDirection(): Promise<'up' | 'down' | null> {
  return new Promise((resolve) => {
    const sel = h('select', {}, [h('option', { value: 'up' }, ['上行']), h('option', { value: 'down' }, ['下行'])]);
    const close = showModal(
      '选择检测方向',
      h('div', {}, [
        h('p', { class: 'dim' }, ['CSV 不含方向字段，请选择本批次对应的线路方向：']),
        h('div', { class: 'field' }, [sel]),
        h('div', { class: 'row', style: 'justify-content:flex-end' }, [
          h('button', { class: 'btn', onClick: () => { close(); resolve(null); } }, ['取消']),
          h('button', {
            class: 'btn btn-primary',
            onClick: () => { close(); resolve(sel.value as 'up' | 'down'); },
          }, ['确定']),
        ]),
      ]),
    );
  });
}

function downloadTemplate() {
  const header = '里程(m),杆号,导高(mm),拉出值(mm),隧道标记\n';
  const sample = [
    '100.00,1#,6002,15,0',
    '100.25,,6001,16,0',
    '155.40,2#,5998,-298,0',
  ].join('\n');
  const blob = new Blob(['﻿' + header + sample], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '检测车CSV模板.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
