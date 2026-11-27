import { h, clear } from './dom';
import { store } from '../lib/store';
import { renderBatches } from './pages/batches';
import { renderLineProfile } from './pages/lineProfile';
import { renderReplay } from './pages/replay';
import { renderExceeds } from './pages/exceeds';
import { renderTrend } from './pages/trend';
import { renderSettings } from './pages/settings';

export type RouteKey = 'replay' | 'batches' | 'profile' | 'exceeds' | 'trend' | 'settings';

const NAV: Array<{ key: RouteKey; icon: string; label: string }> = [
  { key: 'replay', icon: '🛤', label: '三维回放' },
  { key: 'batches', icon: '📦', label: '检测批次' },
  { key: 'profile', icon: '🗂', label: '线路档案' },
  { key: 'exceeds', icon: '⚠️', label: '超限管理' },
  { key: 'trend', icon: '📈', label: '趋势对比' },
  { key: 'settings', icon: '⚙️', label: '设置' },
];

const view = document.getElementById('view')!;
const nav = document.getElementById('nav')!;

export function currentRoute(): RouteKey {
  const k = location.hash.replace('#/', '') as RouteKey;
  return NAV.some((n) => n.key === k) ? k : 'replay';
}

export function navigate(key: RouteKey) {
  location.hash = `#/${key}`;
}

export function renderRoute() {
  const route = currentRoute();
  nav.replaceChildren(
    ...NAV.map((n) =>
      h(
        'div',
        {
          class: `nav-item ${route === n.key ? 'active' : ''}`,
          onClick: () => navigate(n.key),
        },
        [h('span', { class: 'ico' }, [n.icon]), n.label],
      ),
    ),
  );
  clear(view);
  if (!store.state.profile && route !== 'settings') {
    renderEmptyState();
    return;
  }
  const renderers: Record<RouteKey, () => void> = {
    replay: renderReplay,
    batches: renderBatches,
    profile: renderLineProfile,
    exceeds: renderExceeds,
    trend: renderTrend,
    settings: renderSettings,
  };
  renderers[route]();
}

function renderEmptyState() {
  view.append(
    h('div', { class: 'empty', style: 'margin-top:80px' }, [
      h('div', { class: 'big' }, ['🚄']),
      h('div', { style: 'font-size:16px;margin-bottom:8px' }, ['尚未载入演示数据']),
      h('div', { class: 'muted mb12' }, ['点击左下角按钮，生成 50km 双线、三个月检测数据（含里程漂移/跳变/断点）']),
      h('button', {
        class: 'btn btn-primary',
        onClick: () => navigate('settings'),
      }, ['前往载入数据']),
    ]),
  );
}
