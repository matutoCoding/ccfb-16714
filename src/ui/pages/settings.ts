import { h, toast, showLoading, hideLoading, showModal } from '../dom';
import { store } from '../../lib/store';
import { seedDemoData } from '../../lib/seed';
import { anchorGeometryCsv, downloadText } from '../../lib/csv';
import { formatMileage } from '../../lib/geometry';
import type { AppSettings } from '../../types';

export function renderSettings() {
  const view = document.getElementById('view')!;
  const { settings, profile, batches, seeded } = store.state;
  const draft: AppSettings = JSON.parse(JSON.stringify(settings));

  view.append(
    h('div', { class: 'page-head' }, [
      h('h2', { class: 'page-title' }, ['⚙️ 系统设置']),
      h('p', { class: 'page-desc' }, ['限界值、可视化放大系数与数据管理。设置保存在 IndexedDB，刷新不丢失']),
    ]),
  );

  // ---- 限界 ----
  const numField = (label: string, key: keyof AppSettings['limits'], unit: string) => {
    const input = h('input', { type: 'number', value: String(draft.limits[key]) }) as HTMLInputElement;
    input.addEventListener('input', () => {
      draft.limits[key] = Number(input.value);
    });
    return h('div', { class: 'field' }, [h('label', {}, [`${label}（${unit}）`]), input]);
  };
  const limitsCard = h('div', { class: 'card' }, [
    h('div', { class: 'card-title' }, ['超限判别限界']),
    h('div', { class: 'grid grid-3' }, [
      numField('导高一级限界（偏差）', 'heightWarn', 'mm'),
      numField('导高二级限界（偏差）', 'heightSerious', 'mm'),
      numField('相邻定位点导高差', 'adjacentHeightDiff', 'mm'),
      numField('拉出值一级限界（绝对值）', 'staggerWarn', 'mm'),
      numField('拉出值二级限界（绝对值）', 'staggerSerious', 'mm'),
    ]),
    h('p', { class: 'muted', style: 'font-size:12px' }, ['调整限界后需在批次页重新导入/重判，或点击下方「按新限界重新判定全部超限」']),
    h('button', { class: 'btn mt8', id: 'btn-rejudge' }, ['按新限界重新判定全部超限']),
  ]);

  // ---- 可视化 ----
  const vInput = h('input', { type: 'number', value: String(draft.verticalExaggeration), min: '1', max: '30', step: '0.5' }) as HTMLInputElement;
  const sInput = h('input', { type: 'number', value: String(draft.staggerExaggeration), min: '1', max: '20', step: '0.5' }) as HTMLInputElement;
  vInput.addEventListener('input', () => (draft.verticalExaggeration = Number(vInput.value)));
  sInput.addEventListener('input', () => (draft.staggerExaggeration = Number(sInput.value)));
  const visualCard = h('div', { class: 'card' }, [
    h('div', { class: 'card-title' }, ['三维可视化放大系数']),
    h('div', { class: 'grid grid-2' }, [
      h('div', { class: 'field' }, [h('label', {}, ['导高（高低）放大倍数']), vInput, h('span', { class: 'muted', style: 'font-size:12px' }, ['跨距几十米、偏差几毫米，放大后才能看见'])]),
      h('div', { class: 'field' }, [h('label', {}, ['拉出值（之字形）放大倍数']), sInput]),
    ]),
  ]);

  // ---- 数据管理 ----
  const dataCard = h('div', { class: 'card' }, [
    h('div', { class: 'card-title' }, ['演示数据管理']),
    h('div', { class: 'row aic', style: 'gap:20px' }, [
      h('div', {}, [
        h('div', { class: 'muted', style: 'font-size:12px' }, ['当前状态']),
        h('div', { class: 'mono mt8' }, [seeded ? `已载入 ${batches.length} 个批次` : '空库']),
      ]),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn btn-primary', id: 'btn-reseed' }, [seeded ? '重新生成演示数据' : '载入演示数据（50km 双线 / 3 批次）']),
      h('button', { class: 'btn btn-danger', id: 'btn-reset' }, ['清空全部数据']),
    ]),
    h('div', { class: 'muted mt16', style: 'font-size:12px' }, [
      '演示数据：50km 双线、8 处平曲线、4 座隧道；三个月 × 上下行 6 批次；预埋 18m 缓漂移、K28 −12m 跳变、K36 人工重置、K41.2~41.8 断点，以及持续劣化定位点与缺陷。',
    ]),
  ]);

  // ---- 锚段几何图导出 ----
  const exportCard = h('div', { class: 'card' }, [
    h('div', { class: 'card-title' }, ['锚段几何图导出']),
    anchorExportPanel(),
  ]);

  view.append(
    h('div', { style: 'display:flex;gap:14px;flex-direction:column' }, [
      limitsCard,
      visualCard,
      exportCard,
      dataCard,
      h('div', { class: 'row', style: 'justify-content:flex-end' }, [
        h('button', { class: 'btn', id: 'btn-restore' }, ['恢复默认']),
        h('button', { class: 'btn btn-primary', id: 'btn-save' }, ['保存设置']),
      ]),
    ]),
  );

  document.getElementById('btn-save')!.addEventListener('click', async () => {
    await store.saveSettings(draft);
    toast('设置已保存到 IndexedDB', 'ok');
  });
  document.getElementById('btn-restore')!.addEventListener('click', () => {
    toast('已恢复表单默认值，记得点保存', 'info');
    renderSettings();
  });
  document.getElementById('btn-rejudge')!.addEventListener('click', rejudgeAll);
  document.getElementById('btn-reseed')!.addEventListener('click', reseed);
  document.getElementById('btn-reset')!.addEventListener('click', resetAll);
}

function anchorExportPanel() {
  const { profile, batches } = store.state;
  if (!profile) return h('div', { class: 'muted' }, ['载入线路档案后可用']);
  const anchorSel = h('select', { style: 'min-width:320px' }) as HTMLSelectElement;
  const batchSel = h('select', {}) as HTMLSelectElement;
  const anchors = profile.anchors.filter((a) => a.direction === 'up');
  anchorSel.append(...anchors.map((a) => h('option', { value: a.id }, [`${a.name}（上行）`])));
  batchSel.append(...batches.filter((b) => b.direction === 'up').map((b) => h('option', { value: b.id }, [b.name])));
  const dirSel = h('select', {}, [h('option', { value: 'up' }, ['上行']), h('option', { value: 'down' }, ['下行'])]) as HTMLSelectElement;
  dirSel.addEventListener('change', () => {
    anchorSel.replaceChildren(...profile.anchors.filter((a) => a.direction === dirSel.value).map((a) => h('option', { value: a.id }, [a.name])));
    batchSel.replaceChildren(...batches.filter((b) => b.direction === dirSel.value).map((b) => h('option', { value: b.id }, [b.name])));
  });

  return h('div', {}, [
    h('div', { class: 'row aic' }, [
      h('div', { class: 'field', style: 'margin:0' }, [h('label', {}, ['方向']), dirSel]),
      h('div', { class: 'field', style: 'margin:0' }, [h('label', {}, ['锚段']), anchorSel]),
      h('div', { class: 'field', style: 'margin:0' }, [h('label', {}, ['批次']), batchSel]),
      h('button', {
        class: 'btn btn-primary',
        onClick: async () => {
          const anchor = profile.anchors.find((a) => a.id === anchorSel.value)!;
          const samples = await store.loadSamples(batchSel.value);
          const csv = anchorGeometryCsv(anchor, samples);
          downloadText(`锚段几何_${anchor.name.replace(/[~+]/g, '_')}.csv`, csv);
          toast(`已导出 ${formatMileage(anchor.startMileage)}~${formatMileage(anchor.endMileage)} 几何数据，可在 Excel 绘图`, 'ok', 4500);
        },
      }, ['导出锚段几何 CSV']),
    ]),
  ]);
}

async function rejudgeAll() {
  const { profile, batches, settings } = store.state;
  if (!profile) return;
  showLoading('按新限界重新判定全部批次…', 0, batches.length);
  const { detectExceeds } = await import('../../lib/exceed');
  const all = [];
  let i = 0;
  for (const b of batches) {
    const samples = await store.loadSamples(b.id);
    const r = detectExceeds(samples, b, profile, settings.limits);
    all.push(...r.points);
    i++;
    showLoading(`重新判定：${b.name}`, i, batches.length);
  }
  await store.persistExceeds(all);
  hideLoading();
  toast(`重新判定完成，共 ${all.length} 个超限点`, 'ok');
  renderSettings();
}

async function reseed() {
  if (store.state.seeded) {
    const ok = confirm('将清空现有批次/超限/工单并重新生成，是否继续？');
    if (!ok) return;
    await store.resetAll();
  }
  await seedDemoData((p) => showLoading(p.phase, p.current, p.total));
  hideLoading();
  toast('演示数据已重新生成', 'ok');
  renderSettings();
}

async function resetAll() {
  const ok = confirm('确定清空 IndexedDB 中的全部业务数据？此操作不可恢复。');
  if (!ok) return;
  await store.resetAll();
  toast('已清空全部数据', 'warn');
  renderSettings();
}
