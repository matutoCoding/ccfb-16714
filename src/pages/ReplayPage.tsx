import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, saveSettings } from '../core/db';
import { CatenaryScene, sampleRunAt } from '../three/CatenaryScene';
import MileageChart from '../components/MileageChart';
import { Badge, LevelBadge, Empty } from '../components/ui';
import { useUi } from '../state/ui';
import { fmtMileage } from '../core/format';
import { nearestPole } from '../core/archive';
import type { TrackId } from '../core/types';

const SPEEDS = [1, 4, 16, 64];

export default function ReplayPage() {
  const vpRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CatenaryScene | null>(null);
  const readyRef = useRef(false);
  const pendingJump = useRef<{ m: number; batchId?: string; track?: TrackId } | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const replayReq = useUi((s) => s.replay);

  const settings = useLiveQuery(() => db.settings.get('settings'));
  const line = useLiveQuery(() => db.line.get('line'));
  const poles = useLiveQuery(() => db.poles.toArray());
  const locators = useLiveQuery(() => db.locators.toArray());
  const droppers = useLiveQuery(() => db.droppers.toArray());
  const curves = useLiveQuery(() => db.curves.toArray());
  const tunnels = useLiveQuery(() => db.tunnels.toArray());
  const batches = useLiveQuery(() => db.batches.orderBy('date').toArray());
  const runs = useLiveQuery(() => db.runs.toArray());
  const allDefects = useLiveQuery(() => db.defects.toArray());
  const allDefectsRef = useRef(allDefects);
  allDefectsRef.current = allDefects;

  const sortedBatches = useMemo(() => [...(batches ?? [])].sort((a, b) => b.date.localeCompare(a.date)), [batches]);
  const [batchId, setBatchId] = useState<string>('');
  const [track, setTrack] = useState<TrackId>('up');
  const [mileage, setMileage] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [selectedDefect, setSelectedDefect] = useState<string | null>(null);
  const [chartOpen, setChartOpen] = useState(true);
  const bootReady = !!(settings && line);

  // 默认最新批次
  useEffect(() => {
    if (!batchId && sortedBatches.length) setBatchId(sortedBatches[0].id);
  }, [sortedBatches, batchId]);

  const run = useMemo(
    () => runs?.find((r) => r.batchId === batchId && r.track === track) ?? null,
    [runs, batchId, track],
  );
  const runDefects = useMemo(
    () => (allDefects ?? []).filter((d) => d.runId === run?.id).sort((a, b) => a.mileage - b.mileage),
    [allDefects, run?.id],
  );
  const trackPoles = useMemo(() => (poles ?? []).filter((p) => p.track === track), [poles, track]);

  // 初始化场景：必须等 settings/line 就绪、viewport div 真正挂载后再执行
  useEffect(() => {
    if (!bootReady || !vpRef.current) return;
    const scene = new CatenaryScene(vpRef.current);
    scene.onMileage = (m) => setMileage(m);
    scene.onPlayEnd = () => setPlaying(false);
    scene.onDefectClick = (id) => {
      setSelectedDefect(id);
      const d = allDefectsRef.current?.find((x) => x.id === id);
      if (d) scene.jumpTo(d.mileage);
      document.getElementById(`defect-row-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
      readyRef.current = false;
      setSceneReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootReady]);

  // 保持最新视图引用，供档案就绪回调读取
  const viewRef = useRef({ track, run, defects: runDefects });
  viewRef.current = { track, run, defects: runDefects };

  useEffect(() => {
    if (!sceneRef.current || readyRef.current) return;
    if (!line || !poles || !curves || !tunnels || !locators || !droppers || !settings) return;
    sceneRef.current.setArchive({ line, poles, curves, tunnels, locators, droppers }, settings);
    readyRef.current = true;
    sceneRef.current.setView({ track: viewRef.current.track, run: viewRef.current.run, defects: viewRef.current.defects });
    setSceneReady(true);
    // 初始取景由下方“定位消费”effect 统一处理（可能存在跨页待跳转点）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line, poles, curves, tunnels, locators, droppers, settings]);

  // 设置变化
  useEffect(() => {
    if (sceneRef.current && settings) sceneRef.current.setSettings(settings);
  }, [settings]);

  // run / 缺陷 / 线别 → 重建动态几何（不改变镜头位置）
  useEffect(() => {
    if (!sceneRef.current || !readyRef.current) return;
    sceneRef.current.setView({ track, run, defects: runDefects });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, track, runDefects]);

  /** 仅当待跳转点的批次/线别与当前 run 匹配时消费；返回是否已消费 */
  const consumePending = useCallback((): boolean => {
    const p = pendingJump.current;
    const scene = sceneRef.current;
    if (!p || !scene || !readyRef.current) return false;
    if (p.batchId && (!run || run.batchId !== p.batchId)) return false;
    if (p.track && track !== p.track) return false;
    pendingJump.current = null;
    requestAnimationFrame(() => scene.jumpTo(p.m));
    setMileage(p.m);
    return true;
  }, [run, track]);

  // run / 场景就绪变化：匹配则跳转，否则（用户手动切换 run）回到起点
  useEffect(() => {
    if (!sceneReady || !run) return;
    if (pendingJump.current) {
      if (!consumePending()) return; // 等目标批次/线别的 run
    } else {
      sceneRef.current?.seek(0, true);
      setMileage(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, sceneReady]);

  const consumeRef = useRef(consumePending);
  consumeRef.current = consumePending;

  // 跨页跳转请求：解析 defectId → 里程/批次/线别，设置带匹配约束的待跳转点。
  useEffect(() => {
    if (!replayReq) return;
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | undefined;

    const arm = (m: number, b?: string, t?: TrackId) => {
      pendingJump.current = { m, batchId: b, track: t };
      if (!consumeRef.current()) {
        let tries = 0;
        poll = setInterval(() => {
          if (cancelled) { if (poll) clearInterval(poll); return; }
          if (consumeRef.current()) {
            if (poll) clearInterval(poll);
          } else if (++tries > 80) {
            if (poll) clearInterval(poll);
            const p = pendingJump.current;
            if (p && sceneRef.current) {
              pendingJump.current = null;
              sceneRef.current.jumpTo(p.m);
              setMileage(p.m);
            }
          }
        }, 100);
      }
    };

    (async () => {
      let m = replayReq.mileage;
      let b = replayReq.batchId;
      let t = replayReq.track;
      if (replayReq.defectId) {
        const d = await db.defects.get(replayReq.defectId);
        if (cancelled) return;
        if (d) {
          m = d.mileage;
          b = d.batchId;
          t = d.track;
          setSelectedDefect(d.id);
        }
      }
      if (cancelled || m == null) return;
      if (b) setBatchId(b);
      if (t) setTrack(t);
      arm(m, b, t);
    })();

    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayReq?.nonce]);

  // 播放控制同步
  useEffect(() => {
    sceneRef.current?.setPlaying(playing);
  }, [playing]);
  useEffect(() => {
    sceneRef.current?.setSpeedMul(speed);
  }, [speed]);

  const currentSample = run ? sampleRunAt(run, mileage) : null;
  const pole = nearestPole(trackPoles, mileage);
  const nearDefect = runDefects.find((d) => Math.abs(d.mileage - mileage) < 6 && d.level === 2)
    ?? runDefects.find((d) => Math.abs(d.mileage - mileage) < 6);

  const seek = (m: number) => {
    sceneRef.current?.seek(m, false);
    setMileage(m);
  };
  const jump = (m: number) => {
    sceneRef.current?.jumpTo(m);
    setMileage(m);
  };

  const setExag = async (key: 'verticalExaggeration' | 'lateralExaggeration', v: number) => {
    if (!settings) return;
    const next = { ...settings, [key]: v };
    sceneRef.current?.setSettings(next);
    // 轻量防抖落库
    window.clearTimeout((setExag as unknown as { _t?: number })._t);
    (setExag as unknown as { _t?: number })._t = window.setTimeout(() => saveSettings({ [key]: v }), 250);
  };

  if (!settings || !line) return <div className="empty"><div className="big">⏳</div>三维场景数据加载中…</div>;

  return (
    <div className="replay-wrap">
      <div className="replay-body">
        <div className="replay-main-col">
          <div className="viewport" ref={vpRef}>
            {/* HUD */}
            <div className="vp-hud">
              <div className="hud-panel">
                <div className="hud-grid">
                  <span className="k">修正里程</span>
                  <span className="val mono" style={{ color: '#7dd3fc' }}>{fmtMileage(mileage)}</span>
                  <span className="k">最近支柱</span>
                  <span className="val mono">{pole?.code ?? '—'}</span>
                  <span className="k">实测导高</span>
                  <span className={`val mono ${currentSample && Math.abs(currentSample.height - line.designHeight) >= settings.limits.heightLevel1 ? (Math.abs(currentSample.height - line.designHeight) >= settings.limits.heightLevel2 ? 'bad' : 'warn') : ''}`}>
                    {currentSample ? currentSample.height.toFixed(0) : '—'} mm
                  </span>
                  <span className="k">实测拉出值</span>
                  <span className={`val mono ${currentSample && Math.abs(currentSample.pull) >= settings.limits.pullLevel1 ? (Math.abs(currentSample.pull) >= settings.limits.pullLevel2 ? 'bad' : 'warn') : ''}`}>
                    {currentSample ? currentSample.pull.toFixed(0) : '—'} mm
                  </span>
                  <span className="k">检测车速</span>
                  <span className="val mono">{currentSample ? currentSample.speed.toFixed(0) : '—'} km/h</span>
                  <span className="k">当前预警</span>
                  <span className="val">{nearDefect ? <LevelBadge level={nearDefect.level} /> : <Badge kind="ok">正常</Badge>}</span>
                </div>
              </div>
              <div className="hud-panel" style={{ fontSize: 11.5, color: '#8fb2dd', padding: '7px 12px' }}>
                垂直放大 <b style={{ color: '#fbbf24' }}>{settings.verticalExaggeration}×</b> · 横向放大 <b style={{ color: '#c4b5fd' }}>{settings.lateralExaggeration}×</b>
                <span style={{ marginLeft: 8, color: '#5f7ea8' }}>偏差示意，非真实比例</span>
              </div>
            </div>

            <div className="vp-tools">
              <button className="btn sm" onClick={() => sceneRef.current?.jumpTo(mileage)}>🎯 重新取景</button>
              <button
                className={`btn sm ${settings.followCamera ? 'active' : ''}`}
                onClick={() => {
                  const v = !settings.followCamera;
                  sceneRef.current?.setFollow(v);
                  saveSettings({ followCamera: v });
                }}
              >
                {settings.followCamera ? '🎥 跟随中' : '🎥 自由视角'}
              </button>
              <button className="btn sm" onClick={() => setChartOpen((v) => !v)}>{chartOpen ? '📉 收起里程图' : '📈 展开里程图'}</button>
            </div>

            <div className="vp-legend hud-panel" style={{ display: 'flex', gap: 14, fontSize: 11.5, padding: '7px 12px' }}>
              <span><i style={{ color: '#fbbf24' }}>━</i> 实测接触线</span>
              <span><i style={{ color: '#94a3b8' }}>━</i> 承力索</span>
              <span><i style={{ color: '#67e8f9' }}>╱</i> 吊弦/定位器</span>
              <span><i style={{ color: '#60a5fa' }}>━</i> 设计之字线</span>
              <span><i style={{ color: '#ef4444' }}>●</i> 二级</span>
              <span><i style={{ color: '#f59e0b' }}>●</i> 一级</span>
            </div>
          </div>

          {/* 播放条 */}
          <div className="playbar">
            <div className="controls">
              <button className="play-btn" onClick={() => setPlaying((p) => !p)} title="播放/暂停">
                {playing ? '⏸' : '▶'}
              </button>
              <span className="mono" style={{ fontSize: 13, minWidth: 92 }}>{fmtMileage(mileage)}</span>
              <input
                className="scrub"
                type="range"
                min={0}
                max={line.totalLength}
                step={1}
                value={mileage}
                onChange={(e) => seek(parseFloat(e.target.value))}
              />
              <span className="mono dim" style={{ fontSize: 11.5 }}>K50+000</span>
              <div className="speed-seg">
                {SPEEDS.map((s) => (
                  <button key={s} className={speed === s ? 'active' : ''} onClick={() => setSpeed(s)}>{s}×</button>
                ))}
              </div>
            </div>
          </div>

          {/* 里程图 */}
          {chartOpen && run && (
            <div className="chart-dock">
              <div className="dock-hd">
                <strong style={{ fontSize: 12.5 }}>里程波形与超限标记</strong>
                <span className="dim" style={{ fontSize: 11.5 }}>点击/拖动定位 · 红橙三角为超限簇</span>
                <span className="spacer" />
                <select
                  className="input"
                  style={{ width: 230, padding: '3px 8px', fontSize: 12 }}
                  value={batchId}
                  onChange={(e) => setBatchId(e.target.value)}
                >
                  {sortedBatches.map((b) => <option key={b.id} value={b.id}>{b.name}（{b.date}）</option>)}
                </select>
                <div className="seg">
                  <button className={track === 'up' ? 'active' : ''} onClick={() => setTrack('up')}>上行</button>
                  <button className={track === 'down' ? 'active' : ''} onClick={() => setTrack('down')}>下行</button>
                </div>
              </div>
              <MileageChart
                run={run}
                defects={runDefects}
                mileage={mileage}
                limits={settings.limits}
                designHeight={line.designHeight}
                totalLength={line.totalLength}
                onSeek={seek}
              />
            </div>
          )}
        </div>

        {/* 右侧栏 */}
        <aside className="replay-side">
          <div className="card-hd" style={{ borderBottom: '1px solid var(--line-soft)' }}>
            <h3>超限点（{runDefects.length}）</h3>
            <span className="sub">点击三维标记/列表联动</span>
          </div>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-soft)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field">
              <label>检测批次</label>
              <select className="input" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                {sortedBatches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>线别</label>
              <div className="seg" style={{ width: '100%' }}>
                <button style={{ flex: 1 }} className={track === 'up' ? 'active' : ''} onClick={() => setTrack('up')}>上行</button>
                <button style={{ flex: 1 }} className={track === 'down' ? 'active' : ''} onClick={() => setTrack('down')}>下行</button>
              </div>
            </div>
            <div className="field">
              <label>高低垂直放大 <b className="mono">{settings.verticalExaggeration}×</b></label>
              <input className="slider" type="range" min={1} max={40} step={1} value={settings.verticalExaggeration}
                onChange={(e) => setExag('verticalExaggeration', parseInt(e.target.value))} />
            </div>
            <div className="field">
              <label>之字横向放大 <b className="mono">{settings.lateralExaggeration}×</b></label>
              <input className="slider" type="range" min={1} max={20} step={1} value={settings.lateralExaggeration}
                onChange={(e) => setExag('lateralExaggeration', parseInt(e.target.value))} />
            </div>
            <div style={{ gridColumn: '1/3' }}>
              {([
                ['showDesignWire', '设计之字线'],
                ['showMessenger', '承力索'],
                ['showDroppers', '吊弦/定位器'],
                ['showLabels', '隧道标牌'],
              ] as const).map(([key, label]) => (
                <label className="layer-row" key={key}>
                  <span className="switch">
                    <input type="checkbox" checked={!!settings[key]} onChange={(e) => saveSettings({ [key]: e.target.checked } as Partial<typeof settings>)} />
                    <span className="track" />
                  </span>
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="table-wrap" style={{ flex: 1 }}>
            {runDefects.length === 0 && <Empty icon="✅" text="该批次/线别未发现超限" />}
            {runDefects.map((d) => (
              <div
                key={d.id}
                id={`defect-row-${d.id}`}
                onClick={() => {
                  setSelectedDefect(d.id);
                  jump(d.mileage);
                }}
                style={{
                  padding: '9px 14px', borderBottom: '1px solid var(--line-soft)', cursor: 'pointer',
                  background: selectedDefect === d.id ? '#eaf3ff' : undefined,
                  borderLeft: `3px solid ${d.level === 2 ? 'var(--l2)' : 'var(--l1)'}`,
                }}
              >
                <div className="row" style={{ gap: 8 }}>
                  <LevelBadge level={d.level} />
                  <strong style={{ fontSize: 12.8 }}>{d.metric === 'height' ? '导高' : '拉出值'}</strong>
                  <span className="spacer" />
                  <span className="mono" style={{ fontWeight: 700, color: d.level === 2 ? 'var(--l2)' : '#b96f00' }}>
                    {d.value}{d.metric === 'height' ? '' : ''}
                  </span>
                </div>
                <div className="dim mono" style={{ fontSize: 11.8, marginTop: 3 }}>
                  {fmtMileage(d.mileage)} · {d.poleCode ?? '杆号—'} · {d.anchorCode ?? ''}
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
