import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, saveSettings, rejudgeAll, resetAllAndReseed } from '../core/db';
import { Stat, Badge } from '../components/ui';
import { useUi } from '../state/ui';

export default function SettingsPage() {
  const settings = useLiveQuery(() => db.settings.get('settings'));
  const counts = useLiveQuery(async () => ({
    poles: await db.poles.count(),
    runs: await db.runs.count(),
    defects: await db.defects.count(),
    orders: await db.workOrders.count(),
    droppers: await db.droppers.count(),
  }));
  const showToast = useUi((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [storageEst, setStorageEst] = useState<string>('—');

  useState(() => {
    navigator.storage?.estimate?.().then((e) => {
      if (e.usage) setStorageEst(`${(e.usage / 1024 / 1024).toFixed(1)} MB`);
    });
  });

  if (!settings) return null;
  const setL = (key: keyof typeof settings.limits, v: number) =>
    saveSettings({ limits: { ...settings.limits, [key]: v } });

  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
      <div className="card">
        <div className="card-hd"><h3>限界值与分级阈值</h3><span className="sub">修改后点击“按新阈值重判全部超限”</span></div>
        <div className="card-bd">
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <NumField label="导高偏差 · 一级 (mm)" value={settings.limits.heightLevel1} onChange={(v) => setL('heightLevel1', v)} />
            <NumField label="导高偏差 · 二级 (mm)" value={settings.limits.heightLevel2} onChange={(v) => setL('heightLevel2', v)} />
            <NumField label="拉出值绝对值 · 一级 (mm)" value={settings.limits.pullLevel1} onChange={(v) => setL('pullLevel1', v)} />
            <NumField label="拉出值绝对值 · 二级 (mm)" value={settings.limits.pullLevel2} onChange={(v) => setL('pullLevel2', v)} />
            <NumField label="对齐精度承诺 (m)" step={0.1} value={settings.limits.alignTolerance} onChange={(v) => setL('alignTolerance', v)} />
            <NumField label="工单复核窗口 (m)" value={settings.limits.verifyWindow} onChange={(v) => setL('verifyWindow', v)} />
            <NumField label="复核通过所需降幅 (%)" value={settings.limits.verifyReductionPct} onChange={(v) => setL('verifyReductionPct', v)} />
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn primary" disabled={busy} onClick={async () => {
              setBusy(true);
              try {
                const n = await rejudgeAll(settings.limits);
                showToast(`已按当前阈值重新判定，共 ${n} 条超限`, 'ok');
              } finally { setBusy(false); }
            }}>{busy ? '重判中…' : '⚖ 按新阈值重判全部超限'}</button>
            <span className="dim" style={{ fontSize: 12 }}>重判会重建超限记录，工单关联保留在工单上。</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-hd"><h3>三维显示默认值</h3></div>
        <div className="card-bd">
          <div className="field" style={{ marginBottom: 14 }}>
            <label>高低垂直放大：{settings.verticalExaggeration}×</label>
            <input type="range" min={1} max={40} value={settings.verticalExaggeration}
              onChange={(e) => saveSettings({ verticalExaggeration: +e.target.value })} />
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>之字横向放大：{settings.lateralExaggeration}×</label>
            <input type="range" min={1} max={20} value={settings.lateralExaggeration}
              onChange={(e) => saveSettings({ lateralExaggeration: +e.target.value })} />
          </div>
          {([
            ['followCamera', '播放时相机跟随受电弓'],
            ['showDesignWire', '显示设计之字线'],
            ['showMessenger', '显示承力索'],
            ['showDroppers', '显示吊弦/定位器'],
            ['showLabels', '显示隧道标牌'],
          ] as const).map(([k, label]) => (
            <label className="layer-row" key={k}>
              <span className="switch">
                <input type="checkbox" checked={!!settings[k]} onChange={(e) => saveSettings({ [k]: e.target.checked } as Partial<typeof settings>)} />
                <span className="track" />
              </span>
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-hd"><h3>IndexedDB 数据管理</h3></div>
        <div className="card-bd">
          <div className="stat-grid" style={{ marginBottom: 16 }}>
            <Stat label="支柱" value={counts?.poles ?? '—'} unit="根" />
            <Stat label="吊弦" value={counts?.droppers ?? '—'} unit="根" />
            <Stat label="检测 run" value={counts?.runs ?? '—'} unit="条" />
            <Stat label="超限" value={counts?.defects ?? '—'} unit="处" />
            <Stat label="工单" value={counts?.orders ?? '—'} unit="张" />
            <Stat label="本地存储占用" value={storageEst} />
          </div>
          {!confirmReset ? (
            <button className="btn danger" onClick={() => setConfirmReset(true)}>↻ 清空并重新生成 50km 演示数据</button>
          ) : (
            <div className="row" style={{ background: 'var(--l2-bg)', padding: 12, borderRadius: 8 }}>
              <strong style={{ color: 'var(--l2)' }}>确认清空全部本地数据并重新播种？此操作不可撤销。</strong>
              <span className="spacer" />
              <button className="btn" onClick={() => setConfirmReset(false)}>取消</button>
              <button className="btn danger" onClick={async () => {
                setBusy(true);
                try {
                  await resetAllAndReseed();
                  showToast('已重新生成演示数据，刷新页面后生效', 'ok');
                  setTimeout(() => location.reload(), 900);
                } finally { setBusy(false); }
              }}>确认清空重建</button>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-hd"><h3>里程对齐正确性与自检</h3></div>
        <div className="card-bd">
          <p style={{ marginTop: 0 }}>
            对齐引擎以线路档案支柱里程为权威，按 <strong>杆号匹配 → 跳变/断点识别 → 分段稳健修正 → 留一杆交叉验证</strong> 工作。
            演示数据（含尺度漂移、平滑游走、3–4 处跳变、主机重置与数据缺口）的实测精度：
          </p>
          <ul className="checklist" style={{ paddingLeft: 18, lineHeight: 1.9 }}>
            <li>留一杆交叉验证最大误差 <Badge kind="ok">0.22 m</Badge></li>
            <li>全采样点对生成真值的最大误差 <Badge kind="ok">0.16 m</Badge></li>
            <li>承诺阈值 <Badge kind="info">&lt; 0.5 m</Badge>，每个 run 的批次页可查逐杆残差</li>
            <li>命令行复跑：<code className="mono" style={{ background: '#eef2f7', padding: '2px 7px', borderRadius: 5 }}>npm run check:align</code></li>
          </ul>
          <p className="dim" style={{ fontSize: 12.5, marginBottom: 0 }}>
            导入真实检测车 CSV 时，请确保「杆号」列与档案杆号编码一致；无杆号记录时系统会给出未知/漏杆状态，可在对齐详情中做整体偏移与系数微调。
          </p>
        </div>
      </div>
    </div>
  );
}

function NumField({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input className="input mono" type="number" step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} />
    </div>
  );
}
