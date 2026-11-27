import { Component, useEffect, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, ensureSeeded } from './core/db';
import { useUi, type PageKey } from './state/ui';
import { ToastHost } from './components/ui';
import BatchesPage from './pages/BatchesPage';
import ArchivePage from './pages/ArchivePage';
import ReplayPage from './pages/ReplayPage';
import DefectsPage from './pages/DefectsPage';
import WorkOrdersPage from './pages/WorkOrdersPage';
import TrendsPage from './pages/TrendsPage';
import SettingsPage from './pages/SettingsPage';

const NAV: Array<{ key: PageKey; label: string; ico: string }> = [
  { key: 'batches', label: '检测批次', ico: '📥' },
  { key: 'archive', label: '线路档案', ico: '🗺️' },
  { key: 'replay', label: '三维回放', ico: '🛰️' },
  { key: 'defects', label: '超限管理', ico: '🚨' },
  { key: 'workorders', label: '维修工单', ico: '📋' },
  { key: 'trends', label: '趋势对比', ico: '📈' },
  { key: 'settings', label: '设置', ico: '⚙️' },
];

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('页面渲染异常：', error);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="empty" style={{ paddingTop: 80 }}>
          <div className="big">⚠️</div>
          <h3>该页面渲染时出现异常</h3>
          <pre style={{ maxWidth: 720, margin: '10px auto', textAlign: 'left', background: '#fdecec', color: '#b91c1c', padding: 12, borderRadius: 8, fontSize: 12, whiteSpace: 'pre-wrap' }}>
            {this.state.error.message}
          </pre>
          <button className="btn primary" onClick={() => location.reload()}>刷新页面</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const TITLES: Record<PageKey, { t: string; c: string }> = {
  batches: { t: '检测批次', c: '导入检测车 CSV · 里程/杆号对齐 · 跳变断点修正' },
  archive: { t: '线路档案', c: '支柱 · 跨距 · 锚段 · 曲线半径 · 隧道 · 定位器/吊弦' },
  replay: { t: '三维回放', c: '实测导高与拉出值重建 · 受电弓弓网接触 · 超限联动定位' },
  defects: { t: '超限管理', c: '限界值自动分级 · 三维/里程图联动 · 超限报表导出' },
  workorders: { t: '维修工单', c: '超限点派单 · 处理结果 · 下次检测自动核对' },
  trends: { t: '趋势对比', c: '多月检测叠加 · 定位点持续变化识别' },
  settings: { t: '设置', c: '限界阈值 · 显示放大 · 数据管理' },
};

export default function App() {
  const page = useUi((s) => s.page);
  const navigate = useUi((s) => s.navigate);
  const [boot, setBoot] = useState<{ loading: boolean; msg: string }>({ loading: true, msg: '正在初始化 IndexedDB…' });

  useEffect(() => {
    let alive = true;
    ensureSeeded((msg) => alive && setBoot({ loading: true, msg }))
      .then(() => alive && setBoot({ loading: false, msg: '' }))
      .catch((e) => {
        console.error(e);
        alive && setBoot({ loading: false, msg: '' });
        useUi.getState().showToast(`初始化失败：${(e as Error).message}`, 'err');
      });
    return () => {
      alive = false;
    };
  }, []);

  // 调试 / 自动化验证钩子
  useEffect(() => {
    (window as unknown as { __CATENARY__?: unknown }).__CATENARY__ = {
      db,
      ready: !boot.loading,
    };
  }, [boot.loading]);

  const openDefectCount = useLiveQuery(async () => {
    return db.defects.filter((d) => d.status === 'open' || d.status === 'ordered' || d.status === 'processing').count();
  }, []);

  if (boot.loading) {
    return (
      <div className="loading-screen">
        <div className="loading-card">
          <div className="spinner" />
          <h2>接触网几何检测回放与三维核查系统</h2>
          <p>{boot.msg}</p>
        </div>
      </div>
    );
  }

  const meta = TITLES[page];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">
            <div className="logo-mark">弓</div>
            <div>
              <h1>接触网三维核查</h1>
              <p>CATENARY 3D REVIEW</p>
            </div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <button key={n.key} className={`nav-item ${page === n.key ? 'active' : ''}`} onClick={() => navigate(n.key)}>
              <span className="ico">{n.ico}</span>
              {n.label}
              {n.key === 'defects' && !!openDefectCount && openDefectCount > 0 && (
                <span className="dot">{openDefectCount > 99 ? '99+' : openDefectCount}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div><span className="ok-dot" />IndexedDB 本地存储</div>
          <div style={{ marginTop: 4, paddingLeft: 13 }}>云岭线 · K0—K50 · 双线</div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <h2>{meta.t}</h2>
          <span className="crumb">{meta.c}</span>
          <div className="right" id="topbar-right" />
        </header>
        <div className={`content ${page === 'replay' ? 'flush' : ''}`}>
          <ErrorBoundary key={page}>
            {page === 'batches' && <BatchesPage />}
            {page === 'archive' && <ArchivePage />}
            {page === 'replay' && <ReplayPage />}
            {page === 'defects' && <DefectsPage />}
            {page === 'workorders' && <WorkOrdersPage />}
            {page === 'trends' && <TrendsPage />}
            {page === 'settings' && <SettingsPage />}
          </ErrorBoundary>
        </div>
      </main>
      <ToastHost />
    </div>
  );
}
