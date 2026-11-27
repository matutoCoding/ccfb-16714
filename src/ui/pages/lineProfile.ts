import { h } from '../dom';
import { store } from '../../lib/store';
import { formatMileage } from '../../lib/geometry';
import type { Direction, Pole } from '../../types';

export function renderLineProfile() {
  const view = document.getElementById('view')!;
  const { profile: maybeProfile } = store.state;
  if (!maybeProfile) return;
  const profile = maybeProfile;

  let direction: Direction = 'up';
  let keyword = '';

  view.append(
    h('div', { class: 'page-head' }, [
      h('h2', { class: 'page-title' }, ['🗂 线路档案']),
      h('p', { class: 'page-desc' }, [
        `${profile.name}（${profile.code}）全长 ${(profile.totalLength / 1000).toFixed(0)}km，标准导高 ${profile.designHeight}mm，标准拉出值 ±${profile.designStagger}mm，标称跨距 ${profile.spanNominal}m`,
      ]),
    ]),
  );

  // 总览卡
  const upPoles = profile.poles.filter((p) => p.direction === 'up');
  const downPoles = profile.poles.filter((p) => p.direction === 'down');
  const avgSpan = (poles: Pole[]) => {
    const sorted = [...poles].sort((a, b) => a.mileage - b.mileage);
    const diffs = sorted.slice(1).map((p, i) => p.mileage - sorted[i].mileage);
    return (diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(1);
  };
  view.append(
    h('div', { class: 'grid grid-4 mb12' }, [
      stat('锚段', String(profile.anchors.length / 2), `单方向 ${profile.anchors.length / 2} 个`),
      stat('支柱', String(profile.poles.length), `上行 ${upPoles.length} / 下行 ${downPoles.length}`),
      stat('平均跨距', `${avgSpan(upPoles)}m`, '曲线段加密'),
      stat('隧道 / 曲线', `${profile.tunnels.length} / ${profile.curves.length / 2}`, '平曲线含缓和过渡'),
    ]),
  );

  // 筛选
  const dirSel = h('select', {}, [
    h('option', { value: 'up' }, ['上行']),
    h('option', { value: 'down' }, ['下行']),
  ]) as HTMLSelectElement;
  const search = h('input', { placeholder: '搜索杆号 / K 标，如 128# 或 K12+300', style: 'width:280px' }) as HTMLInputElement;
  const anchorSel = h('select', { style: 'width:220px' }) as HTMLSelectElement;
  view.append(
    h('div', { class: 'card mb12' }, [
      h('div', { class: 'row' }, [
        h('div', { class: 'field', style: 'margin:0;min-width:120px' }, [h('label', {}, ['方向']), dirSel]),
        h('div', { class: 'field', style: 'margin:0' }, [h('label', {}, ['检索']), search]),
        h('div', { class: 'field', style: 'margin:0' }, [h('label', {}, ['锚段']), anchorSel]),
        h('div', { class: 'spacer' }),
        h('div', { class: 'legend' }, [
          h('span', {}, [h('span', { class: 'dot', style: 'background:#8b5cf6' }), '曲线段支柱']),
          h('span', {}, [h('span', { class: 'dot', style: 'background:#f59e0b' }), '隧道内支柱']),
        ]),
      ]),
    ]),
  );

  const tableWrap = h('div', { class: 'table-wrap' });
  view.append(tableWrap);

  // 锚段/曲线/隧道信息卡
  const infoRow = h('div', { class: 'grid grid-3 mt16' });
  view.append(infoRow);

  function fillAnchors() {
    const anchors = profile.anchors.filter((a) => a.direction === direction);
    anchorSel.replaceChildren(h('option', { value: '' }, ['全部锚段']), ...anchors.map((a) => h('option', { value: a.id }, [a.name])));
  }

  function inCurve(m: number) {
    return profile.curves.some((c) => c.direction === direction && m >= c.startMileage && m < c.endMileage);
  }

  function renderTable() {
    keyword = search.value.trim();
    const anchorId = anchorSel.value;
    let poles = profile.poles.filter((p) => p.direction === direction);
    if (anchorId) poles = poles.filter((p) => p.anchorId === anchorId);
    if (keyword) {
      poles = poles.filter((p) => p.poleNo.includes(keyword) || formatMileage(p.mileage).includes(keyword.toUpperCase()));
    }
    const sorted = [...poles].sort((a, b) => a.mileage - b.mileage);
    // 跨距 = 与前一柱之差
    const withSpan = sorted.map((p, i) => ({ p, span: i === 0 ? 0 : p.mileage - sorted[i - 1].mileage }));
    const display = withSpan.slice(0, 400);
    tableWrap.replaceChildren(
      h('table', {}, [
        h('thead', {}, [
          h('tr', {}, [
            h('th', {}, ['杆号']),
            h('th', {}, ['里程']),
            h('th', { class: 'num' }, ['跨距(m)']),
            h('th', { class: 'num' }, ['设计导高(mm)']),
            h('th', { class: 'num' }, ['设计拉出(mm)']),
            h('th', {}, ['定位器']),
            h('th', {}, ['环境']),
            h('th', {}, ['所属锚段']),
          ]),
        ]),
        h('tbody', {}, [
          ...display.map(({ p, span }) => {
            const tunnel = profile.tunnels.some((t) => p.mileage >= t.startMileage && p.mileage < t.endMileage);
            const curve = inCurve(p.mileage);
            return h('tr', {}, [
              h('td', { class: 'mono' }, [p.poleNo]),
              h('td', { class: 'mono' }, [formatMileage(p.mileage)]),
              h('td', { class: 'num mono' }, [span ? span.toFixed(1) : '—']),
              h('td', { class: 'num mono' }, [String(p.designHeight)]),
              h('td', { class: 'num mono' }, [String(p.designStagger)]),
              h('td', {}, [p.hasRegistrator ? h('span', { class: 'badge badge-ok' }, ['有']) : h('span', { class: 'badge badge-muted' }, ['无'])]),
              h('td', {}, [
                h('div', { class: 'row gap8' }, [
                  curve ? h('span', { class: 'badge tag-drift' }, ['曲线']) : null,
                  tunnel ? h('span', { class: 'badge badge-l1' }, ['隧道']) : null,
                  !curve && !tunnel ? h('span', { class: 'badge badge-muted' }, ['直线/露天']) : null,
                ]),
              ]),
              h('td', { class: 'dim' }, [profile.anchors.find((a) => a.id === p.anchorId)?.name ?? '—']),
            ]);
          }),
        ]),
      ]),
    );
    if (sorted.length > display.length) {
      tableWrap.append(h('div', { class: 'muted', style: 'padding:10px;text-align:center' }, [`仅显示前 400 条，共 ${sorted.length} 条，请用锚段或关键词过滤`]));
    }
  }

  function renderInfo() {
    const anchors = profile.anchors.filter((a) => a.direction === direction);
    const curves = profile.curves.filter((c) => c.direction === direction);
    infoRow.replaceChildren(
      h('div', { class: 'card' }, [
        h('div', { class: 'card-title' }, [`锚段（${anchors.length}）`]),
        h('div', { style: 'max-height:280px;overflow:auto' }, [
          ...anchors.map((a, i) =>
            h('div', { class: 'mini-exceed' }, [
              h('div', { class: 'row jcsb' }, [h('strong', {}, [`#${i + 1}`]), h('span', { class: 'mono dim' }, [a.name])]),
              h('div', { class: 'muted mt8 mono' }, [`长度 ${(a.endMileage - a.startMileage).toFixed(0)}m`]),
            ]),
          ),
        ]),
      ]),
      h('div', { class: 'card' }, [
        h('div', { class: 'card-title' }, [`平曲线（${curves.length}）`]),
        h('div', { style: 'max-height:280px;overflow:auto' }, [
          ...curves.map((c) =>
            h('div', { class: 'mini-exceed' }, [
              h('div', { class: 'row jcsb' }, [
                h('span', { class: 'badge tag-drift' }, [c.type === 'left' ? '左偏' : '右偏']),
                h('span', { class: 'mono dim' }, [`R=${c.radius}m`]),
              ]),
              h('div', { class: 'muted mt8 mono' }, [`${formatMileage(c.startMileage)} ~ ${formatMileage(c.endMileage)}，长 ${c.endMileage - c.startMileage}m`]),
            ]),
          ),
        ]),
      ]),
      h('div', { class: 'card' }, [
        h('div', { class: 'card-title' }, [`隧道（${profile.tunnels.length}）`]),
        h('div', { style: 'max-height:280px;overflow:auto' }, [
          ...profile.tunnels.map((t) =>
            h('div', { class: 'mini-exceed' }, [
              h('div', { class: 'row jcsb' }, [h('strong', {}, [t.name]), h('span', { class: 'mono dim' }, [`${t.endMileage - t.startMileage}m`])]),
              h('div', { class: 'muted mt8 mono' }, [`${formatMileage(t.startMileage)} ~ ${formatMileage(t.endMileage)}`]),
            ]),
          ),
        ]),
      ]),
    );
  }

  dirSel.addEventListener('change', () => {
    direction = dirSel.value as Direction;
    fillAnchors();
    renderTable();
    renderInfo();
  });
  anchorSel.addEventListener('change', renderTable);
  search.addEventListener('input', renderTable);

  fillAnchors();
  renderTable();
  renderInfo();
}

function stat(label: string, num: string, sub: string) {
  return h('div', { class: 'card stat' }, [
    h('span', { class: 'stat-label' }, [label]),
    h('span', { class: 'stat-num' }, [num]),
    h('span', { class: 'stat-sub muted' }, [sub]),
  ]);
}
