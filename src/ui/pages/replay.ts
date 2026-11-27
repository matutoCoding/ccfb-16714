import { h } from '../dom';
import { store } from '../../lib/store';
import { SceneManager, type CameraMode, type HudState } from '../../three/SceneManager';
import { formatMileage, fmtMm } from '../../lib/geometry';
import type { Direction, InspectionBatch } from '../../types';

let manager: SceneManager | null = null;

export function renderReplay() {
  const view = document.getElementById('view')!;
  const { profile: maybeProfile, batches, exceeds, settings } = store.state;
  if (!maybeProfile) return;
  const profile = maybeProfile;

  const directions: Direction[] = ['up', 'down'];
  const dirBatches = (d: Direction) => batches.filter((b) => b.direction === d);
  let direction: Direction = 'up';
  let currentBatches = dirBatches(direction);
  let selectedBatch: InspectionBatch | undefined = currentBatches[currentBatches.length - 1];

  const viewerCard = h('div', { class: 'card viewer-card' });
  const hud = h('div', { class: 'hud' });
  viewerCard.append(hud);

  const sidePanel = h('div', { class: 'side-panel' });

  const layout = h('div', { class: 'replay-layout' }, [viewerCard, sidePanel]);
  view.append(
    h('div', { class: 'page-head' }, [
      h('h2', { class: 'page-title' }, ['🛤 三维回放与弓网核查']),
      h('p', { class: 'page-desc' }, [
        '按实测导高/拉出值重建接触线与承力索，毫米级偏差经放大显示；受电弓沿线走行，接触点实时追踪。',
      ]),
    ]),
    layout,
  );

  // ---------- 侧栏：选择与控制 ----------
  const dirSel = h('select', {}, [
    ...directions.map((d) => h('option', { value: d }, [d === 'up' ? '上行' : '下行'])),
  ]) as HTMLSelectElement;
  const batchSel = h('select', { style: 'flex:1' }) as HTMLSelectElement;
  const vScaleInput = rangeInput(1, 20, settings.verticalExaggeration, 0.5);
  const sScaleInput = rangeInput(1, 15, settings.staggerExaggeration, 0.5);
  const speedSel = h('select', {}, [
    ...settings.replaySpeeds.map((v) => h('option', { value: String(v) }, [`${v} m/s`])),
  ]) as HTMLSelectElement;
  speedSel.value = '15';
  const camSel = h('select', {}, [
    h('option', { value: 'orbit' }, ['自由视角']),
    h('option', { value: 'follow' }, ['随车跟随']),
    h('option', { value: 'top' }, ['俯视总览']),
  ]) as HTMLSelectElement;

  const vVal = h('span', { class: 'mono text-accent' }, [`×${settings.verticalExaggeration}`]);
  const sVal = h('span', { class: 'mono text-accent' }, [`×${settings.staggerExaggeration}`]);

  sidePanel.append(
    h('div', { class: 'card' }, [
      h('div', { class: 'card-title' }, ['数据选择']),
      field('线路方向', dirSel),
      field('检测批次', batchSel),
    ]),
    h('div', { class: 'card' }, [
      h('div', { class: 'card-title' }, ['偏差放大（毫米偏差可视化）']),
      field('导高放大', h('div', { class: 'row' }, [vScaleInput, vVal])),
      field('拉出值放大', h('div', { class: 'row' }, [sScaleInput, sVal])),
    ]),
    h('div', { class: 'card' }, [
      h('div', { class: 'card-title' }, ['回放控制']),
      field('走行速度', speedSel),
      field('相机模式', camSel),
    ]),
  );

  // 超限点列表
  const exceedList = h('div', { class: 'exceed-marker-list' });
  const exceedCard = h('div', { class: 'card' }, [
    h('div', { class: 'card-title' }, ['超限点（点击定位）']),
    exceedList,
  ]);
  sidePanel.append(exceedCard);

  // ---------- 底部走行控制条 ----------
  const playBtn = h('button', { class: 'btn btn-primary btn-sm' }, ['▶ 播放']);
  const mileageRange = h('input', {
    type: 'range',
    class: 'mileage-track',
    min: '0',
    max: String(profile.totalLength),
    step: '10',
    value: '0',
  }) as HTMLInputElement;
  const mileageLabel = h('span', { class: 'mono text-accent' }, [formatMileage(0)]);
  const controlStrip = h('div', { class: 'control-strip' }, [
    playBtn,
    h('button', {
      class: 'btn btn-sm',
      onClick: () => {
        manager?.seek(0);
        mileageRange.value = '0';
      },
    }, ['⏮ 起点']),
    mileageRange,
    mileageLabel,
  ]);
  viewerCard.append(controlStrip);

  function fillBatchOptions() {
    currentBatches = dirBatches(direction);
    batchSel.replaceChildren(
      ...currentBatches.map((b) => h('option', { value: b.id }, [`${b.inspectDate} ${b.name}`])),
    );
    selectedBatch = currentBatches[currentBatches.length - 1];
    if (selectedBatch) batchSel.value = selectedBatch.id;
  }

  function fillExceedList() {
    const list = selectedBatch
      ? exceeds.filter((e) => e.batchId === selectedBatch!.id)
      : [];
    exceedList.replaceChildren(
      ...list.slice(0, 40).map((e) =>
        h('div', {
          class: 'mini-exceed',
          onClick: () => {
            manager?.focusExceed(e.mileage);
            mileageRange.value = String(e.mileage);
            mileageLabel.textContent = formatMileage(e.mileage);
          },
        }, [
          h('div', { class: 'row jcsb' }, [
            h('span', { class: e.level === 2 ? 'text-danger' : 'text-warn' }, [
              `${e.level === 2 ? '二级' : '一级'} · ${e.metric === 'height' ? '导高' : '拉出值'}`,
            ]),
            h('span', { class: 'mono muted' }, [formatMileage(e.mileage)]),
          ]),
          h('div', { class: 'muted mt8 mono' }, [
            `实测 ${e.value}mm / 偏差 ${fmtMm(e.deviation)}mm`,
          ]),
        ]),
      ),
    );
    if (!list.length) exceedList.append(h('div', { class: 'muted', style: 'padding:8px' }, ['该批次无超限点']));
  }

  async function loadBatchIntoScene() {
    if (!manager || !selectedBatch) return;
    const samples = await store.loadSamples(selectedBatch.id);
    manager.setBatch(samples, selectedBatch, exceeds);
    manager.setExaggeration(Number(vScaleInput.value), Number(sScaleInput.value));
    manager.seek(0);
    fillExceedList();
  }

  function renderHud(state: HudState) {
    const pole = nearestPoleLabel(state.mileage);
    hud.replaceChildren(
      hudRow('里程', formatMileage(state.mileage)),
      hudRow('就近杆号', pole),
      hudRow('导高(mm)', String(state.height)),
      hudRow('拉出值(mm)', fmtMm(state.stagger)),
      hudRow('设计导高(mm)', String(state.designHeight)),
      hudRow('区段', state.inTunnel ? '隧道内' : '露天'),
    );
  }
  function nearestPoleLabel(m: number): string {
    const poles = profile.poles.filter((p) => p.direction === direction);
    let best = poles[0];
    let bd = Infinity;
    for (const p of poles) {
      const d = Math.abs(p.mileage - m);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best ? `${best.poleNo}（Δ${bd.toFixed(1)}m）` : '—';
  }

  // ---------- 事件 ----------
  dirSel.addEventListener('change', async () => {
    direction = dirSel.value as Direction;
    fillBatchOptions();
    manager?.loadLine(profile, direction);
    await loadBatchIntoScene();
  });
  batchSel.addEventListener('change', async () => {
    selectedBatch = currentBatches.find((b) => b.id === batchSel.value);
    await loadBatchIntoScene();
  });
  vScaleInput.addEventListener('input', () => {
    vVal.textContent = `×${vScaleInput.value}`;
    manager?.setExaggeration(Number(vScaleInput.value), Number(sScaleInput.value));
  });
  sScaleInput.addEventListener('input', () => {
    sVal.textContent = `×${sScaleInput.value}`;
    manager?.setExaggeration(Number(vScaleInput.value), Number(sScaleInput.value));
  });
  speedSel.addEventListener('change', () => manager?.setSpeed(Number(speedSel.value)));
  camSel.addEventListener('change', () => manager?.setCameraMode(camSel.value as CameraMode));
  playBtn.addEventListener('click', () => {
    if (!manager) return;
    if (manager.isPlaying) {
      manager.pause();
      playBtn.textContent = '▶ 播放';
    } else {
      manager.play();
      playBtn.textContent = '⏸ 暂停';
    }
  });
  mileageRange.addEventListener('input', () => {
    const m = Number(mileageRange.value);
    manager?.seek(m);
    mileageLabel.textContent = formatMileage(m);
  });

  // ---------- 初始化三维 ----------
  fillBatchOptions();
  requestAnimationFrame(async () => {
    manager = new SceneManager(viewerCard);
    manager.onHudUpdate((s) => {
      renderHud(s);
      mileageRange.value = String(Math.round(s.mileage));
      mileageLabel.textContent = formatMileage(s.mileage);
      if (!s.playing) playBtn.textContent = '▶ 播放';
    });
    manager.loadLine(profile, direction);
    manager.setSpeed(Number(speedSel.value));
    await loadBatchIntoScene();
  });

  // 页面卸载时释放
  const observer = new MutationObserver(() => {
    if (!document.body.contains(view)) {
      manager?.dispose();
      manager = null;
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function field(label: string, control: HTMLElement) {
  return h('div', { class: 'field' }, [h('label', {}, [label]), control]);
}
function rangeInput(min: number, max: number, value: number, step: number) {
  return h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) }) as HTMLInputElement;
}
function hudRow(k: string, v: string) {
  return h('div', { class: 'hud-row' }, [h('span', { class: 'k' }, [k]), h('span', {}, [v])]);
}
