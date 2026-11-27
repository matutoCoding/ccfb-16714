import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../core/db';
import type { AnchorSection, CurveInfo, DropperInfo, LocatorInfo, Pole, TunnelInfo } from '../core/types';
import { TRACK_LABEL } from '../core/types';
import { Badge, Modal, Empty } from '../components/ui';
import { useUi } from '../state/ui';
import { fmtMileage, downloadBlob, uid } from '../core/format';
import { anchorGeometrySvg, anchorAlbumHtml } from '../core/exporter';

type Tab = 'poles' | 'anchors' | 'curves' | 'locators' | 'droppers' | 'geometry';

export default function ArchivePage() {
  const [tab, setTab] = useState<Tab>('poles');
  const tabs: Array<[Tab, string, string]> = [
    ['poles', '支柱/跨距', '⚑'],
    ['anchors', '锚段', '▰'],
    ['curves', '曲线/隧道', '〰'],
    ['locators', '定位器', '⊙'],
    ['droppers', '吊弦', '⋮⋮'],
    ['geometry', '锚段几何图', '📐'],
  ];
  return (
    <div>
      <div className="seg" style={{ marginBottom: 16, background: '#dde6f2' }}>
        {tabs.map(([k, label, ico]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)} style={{ padding: '7px 18px' }}>
            {ico} {label}
          </button>
        ))}
      </div>
      {tab === 'poles' && <PolesTab />}
      {tab === 'anchors' && <AnchorsTab />}
      {tab === 'curves' && <CurvesTunnelsTab />}
      {tab === 'locators' && <LocatorsTab />}
      {tab === 'droppers' && <DroppersTab />}
      {tab === 'geometry' && <GeometryTab />}
    </div>
  );
}

// ---------------- 支柱 ----------------
function PolesTab() {
  const poles = useLiveQuery(() => db.poles.toArray());
  const [track, setTrack] = useState<'up' | 'down'>('up');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Partial<Pole> | null>(null);
  const showToast = useUi((s) => s.showToast);

  const list = useMemo(() => (poles ?? [])
    .filter((p) => p.track === track)
    .filter((p) => !q || p.code.toLowerCase().includes(q.toLowerCase()) || String(Math.round(p.mileage)).includes(q))
    .sort((a, b) => a.mileage - b.mileage), [poles, track, q]);

  const save = async () => {
    if (!editing?.code || editing.mileage == null) return showToast('杆号与里程必填', 'err');
    const pole: Pole = {
      id: editing.id ?? uid('pole'),
      track,
      code: editing.code,
      mileage: Number(editing.mileage),
      side: editing.side ?? 'left',
      anchorCode: editing.anchorCode,
    };
    await db.poles.put(pole);
    // 重算该线别跨距
    const all = await db.poles.where('track').equals(track).sortBy('mileage');
    for (let i = 0; i < all.length; i++) {
      all[i].spanNext = i < all.length - 1 ? Math.round((all[i + 1].mileage - all[i].mileage) * 10) / 10 : undefined;
      await db.poles.put(all[i]);
    }
    showToast('支柱已保存，跨距已重算', 'ok');
    setEditing(null);
  };

  return (
    <div className="card">
      <div className="card-hd">
        <div className="seg">
          <button className={track === 'up' ? 'active' : ''} onClick={() => setTrack('up')}>上行</button>
          <button className={track === 'down' ? 'active' : ''} onClick={() => setTrack('down')}>下行</button>
        </div>
        <input className="input" placeholder="搜索杆号/里程" style={{ width: 200 }} value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="sub">共 {list.length} 根 · 跨距 {list[0]?.spanNext ? '约 46–54m' : ''}</span>
        <span className="spacer" />
        <button className="btn primary sm" onClick={() => setEditing({ track, side: 'left', mileage: 0 })}>＋ 新增支柱</button>
      </div>
      <div className="table-wrap fixed-head">
        <table className="tbl">
          <thead><tr><th>杆号</th><th className="num">档案里程(m)</th><th>里程</th><th>侧别</th><th>锚段</th><th className="num">后跨距(m)</th><th className="right">操作</th></tr></thead>
          <tbody>
            {list.slice(0, 600).map((p) => (
              <tr key={p.id}>
                <td className="mono"><strong>{p.code}</strong></td>
                <td className="num mono">{p.mileage.toFixed(2)}</td>
                <td className="mono dim">{fmtMileage(p.mileage)}</td>
                <td>{p.side === 'left' ? '左侧' : '右侧'}</td>
                <td><Badge kind="info">{p.anchorCode ?? '—'}</Badge></td>
                <td className="num mono">{p.spanNext?.toFixed(1) ?? '—'}</td>
                <td className="right">
                  <button className="btn sm" onClick={() => setEditing(p)}>编辑</button>
                  <button className="btn sm danger" style={{ marginLeft: 6 }} onClick={async () => { await db.poles.delete(p.id); showToast('已删除', 'ok'); }}>删</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length > 600 && <div className="dim center" style={{ padding: 8, fontSize: 12 }}>仅显示前 600 条，请用搜索缩小范围</div>}
      </div>
      {editing && (
        <EditModal title={editing.id ? '编辑支柱' : '新增支柱'} onClose={() => setEditing(null)} onSave={save}>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field"><label>杆号</label><input className="input" value={editing.code ?? ''} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></div>
            <div className="field"><label>档案里程 (m)</label><input className="input mono" type="number" step={0.01} value={editing.mileage ?? 0} onChange={(e) => setEditing({ ...editing, mileage: parseFloat(e.target.value) })} /></div>
            <div className="field"><label>侧别</label>
              <select className="input" value={editing.side} onChange={(e) => setEditing({ ...editing, side: e.target.value as Pole['side'] })}>
                <option value="left">左侧</option><option value="right">右侧</option>
              </select>
            </div>
            <div className="field"><label>锚段编号</label><input className="input" value={editing.anchorCode ?? ''} onChange={(e) => setEditing({ ...editing, anchorCode: e.target.value })} /></div>
          </div>
        </EditModal>
      )}
    </div>
  );
}

// ---------------- 锚段 ----------------
function AnchorsTab() {
  const anchors = useLiveQuery(() => db.anchors.toArray());
  const [track, setTrack] = useState<'up' | 'down'>('up');
  const [editing, setEditing] = useState<Partial<AnchorSection> | null>(null);
  const showToast = useUi((s) => s.showToast);
  const list = (anchors ?? []).filter((a) => a.track === track).sort((a, b) => a.fromMileage - b.fromMileage);

  const save = async () => {
    if (!editing?.code || editing.fromMileage == null || editing.toMileage == null) return showToast('编号与起讫里程必填', 'err');
    const a: AnchorSection = {
      id: editing.id ?? uid('anc'),
      track,
      code: editing.code,
      fromPoleCode: editing.fromPoleCode ?? '',
      toPoleCode: editing.toPoleCode ?? '',
      fromMileage: Number(editing.fromMileage),
      toMileage: Number(editing.toMileage),
      spanCount: Number(editing.spanCount ?? 0),
      length: Number(editing.toMileage) - Number(editing.fromMileage),
      tensionKN: Number(editing.tensionKN ?? 20),
    };
    await db.anchors.put(a);
    showToast('锚段已保存', 'ok');
    setEditing(null);
  };

  return (
    <div className="card">
      <div className="card-hd">
        <div className="seg">
          <button className={track === 'up' ? 'active' : ''} onClick={() => setTrack('up')}>上行</button>
          <button className={track === 'down' ? 'active' : ''} onClick={() => setTrack('down')}>下行</button>
        </div>
        <span className="sub">{list.length} 个锚段 · 平均长度 {list.length ? (list.reduce((s, a) => s + a.length, 0) / list.length).toFixed(0) : 0}m</span>
        <span className="spacer" />
        <button className="btn primary sm" onClick={() => setEditing({ track, tensionKN: 21 })}>＋ 新增锚段</button>
      </div>
      <div className="table-wrap fixed-head">
        <table className="tbl">
          <thead><tr><th>锚段号</th><th>起杆</th><th>止杆</th><th className="num">起点</th><th className="num">终点</th><th className="num">跨数</th><th className="num">长度(m)</th><th className="num">张力(kN)</th><th className="right">操作</th></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id}>
                <td><Badge kind="purple">{a.code}</Badge></td>
                <td className="mono">{a.fromPoleCode}</td>
                <td className="mono">{a.toPoleCode}</td>
                <td className="num mono">{fmtMileage(a.fromMileage)}</td>
                <td className="num mono">{fmtMileage(a.toMileage)}</td>
                <td className="num">{a.spanCount}</td>
                <td className="num mono">{a.length.toFixed(0)}</td>
                <td className="num mono">{a.tensionKN ?? '—'}</td>
                <td className="right">
                  <button className="btn sm" onClick={() => setEditing(a)}>编辑</button>
                  <button className="btn sm danger" style={{ marginLeft: 6 }} onClick={async () => { await db.anchors.delete(a.id); }}>删</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <EditModal title={editing.id ? '编辑锚段' : '新增锚段'} onClose={() => setEditing(null)} onSave={save}>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div className="field"><label>锚段号</label><input className="input" value={editing.code ?? ''} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></div>
            <div className="field"><label>起杆号</label><input className="input" value={editing.fromPoleCode ?? ''} onChange={(e) => setEditing({ ...editing, fromPoleCode: e.target.value })} /></div>
            <div className="field"><label>止杆号</label><input className="input" value={editing.toPoleCode ?? ''} onChange={(e) => setEditing({ ...editing, toPoleCode: e.target.value })} /></div>
            <div className="field"><label>起点里程(m)</label><input className="input mono" type="number" value={editing.fromMileage ?? 0} onChange={(e) => setEditing({ ...editing, fromMileage: parseFloat(e.target.value) })} /></div>
            <div className="field"><label>终点里程(m)</label><input className="input mono" type="number" value={editing.toMileage ?? 0} onChange={(e) => setEditing({ ...editing, toMileage: parseFloat(e.target.value) })} /></div>
            <div className="field"><label>跨数</label><input className="input mono" type="number" value={editing.spanCount ?? 0} onChange={(e) => setEditing({ ...editing, spanCount: parseInt(e.target.value) })} /></div>
            <div className="field"><label>补偿张力(kN)</label><input className="input mono" type="number" value={editing.tensionKN ?? 20} onChange={(e) => setEditing({ ...editing, tensionKN: parseFloat(e.target.value) })} /></div>
          </div>
        </EditModal>
      )}
    </div>
  );
}

// ---------------- 曲线 / 隧道 ----------------
function CurvesTunnelsTab() {
  const curves = useLiveQuery(() => db.curves.toArray());
  const tunnels = useLiveQuery(() => db.tunnels.toArray());
  const [curveEdit, setCurveEdit] = useState<Partial<CurveInfo> | null>(null);
  const [tunnelEdit, setTunnelEdit] = useState<Partial<TunnelInfo> | null>(null);
  const showToast = useUi((s) => s.showToast);

  return (
    <div className="grid" style={{ gridTemplateColumns: '1.3fr 1fr', alignItems: 'start' }}>
      <div className="card">
        <div className="card-hd"><h3>曲线半径档案</h3><span className="spacer" />
          <button className="btn primary sm" onClick={() => setCurveEdit({ direction: 'left', tracks: 'both', radius: 1500 })}>＋ 新增曲线</button></div>
        <div className="table-wrap" style={{ maxHeight: 520 }}>
          <table className="tbl">
            <thead><tr><th>曲线号</th><th className="num">起点</th><th className="num">终点</th><th className="num">半径(m)</th><th>方向</th><th className="right">操作</th></tr></thead>
            <tbody>
              {(curves ?? []).map((c) => (
                <tr key={c.id}>
                  <td><Badge kind="info">{c.code}</Badge></td>
                  <td className="mono">{fmtMileage(c.start)}</td>
                  <td className="mono">{fmtMileage(c.end)}</td>
                  <td className="num mono" style={{ fontWeight: 700 }}>R{c.radius}</td>
                  <td>{c.direction === 'left' ? '左曲' : '右曲'}</td>
                  <td className="right">
                    <button className="btn sm" onClick={() => setCurveEdit(c)}>编</button>
                    <button className="btn sm danger" style={{ marginLeft: 6 }} onClick={() => db.curves.delete(c.id)}>删</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <div className="card-hd"><h3>隧道</h3><span className="spacer" />
          <button className="btn primary sm" onClick={() => setTunnelEdit({})}>＋ 新增隧道</button></div>
        <div className="table-wrap" style={{ maxHeight: 520 }}>
          <table className="tbl">
            <thead><tr><th>名称</th><th className="num">起点</th><th className="num">终点</th><th className="num">长度(m)</th><th /></tr></thead>
            <tbody>
              {(tunnels ?? []).map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.name}</strong></td>
                  <td className="mono">{fmtMileage(t.start)}</td>
                  <td className="mono">{fmtMileage(t.end)}</td>
                  <td className="num mono">{(t.end - t.start).toFixed(0)}</td>
                  <td className="right"><button className="btn sm" onClick={() => setTunnelEdit(t)}>编</button>
                    <button className="btn sm danger" style={{ marginLeft: 6 }} onClick={() => db.tunnels.delete(t.id)}>删</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {curveEdit && (
        <EditModal title="曲线" onClose={() => setCurveEdit(null)} onSave={async () => {
          if (curveEdit.start == null || curveEdit.end == null || !curveEdit.radius) return showToast('起讫里程与半径必填', 'err');
          await db.curves.put({ id: curveEdit.id ?? uid('cv'), code: curveEdit.code ?? `Q${Date.now() % 100}`, start: +curveEdit.start, end: +curveEdit.end, radius: +curveEdit.radius, direction: curveEdit.direction ?? 'left', tracks: 'both' });
          setCurveEdit(null); showToast('曲线已保存', 'ok');
        }}>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field"><label>曲线号</label><input className="input" value={curveEdit.code ?? ''} onChange={(e) => setCurveEdit({ ...curveEdit, code: e.target.value })} /></div>
            <div className="field"><label>半径 (m)</label><input className="input mono" type="number" value={curveEdit.radius ?? 1500} onChange={(e) => setCurveEdit({ ...curveEdit, radius: +e.target.value })} /></div>
            <div className="field"><label>起点里程 (m)</label><input className="input mono" type="number" value={curveEdit.start ?? 0} onChange={(e) => setCurveEdit({ ...curveEdit, start: +e.target.value })} /></div>
            <div className="field"><label>终点里程 (m)</label><input className="input mono" type="number" value={curveEdit.end ?? 0} onChange={(e) => setCurveEdit({ ...curveEdit, end: +e.target.value })} /></div>
            <div className="field"><label>方向</label><select className="input" value={curveEdit.direction} onChange={(e) => setCurveEdit({ ...curveEdit, direction: e.target.value as CurveInfo['direction'] })}><option value="left">左曲</option><option value="right">右曲</option></select></div>
          </div>
        </EditModal>
      )}
      {tunnelEdit && (
        <EditModal title="隧道" onClose={() => setTunnelEdit(null)} onSave={async () => {
          if (!tunnelEdit.name || tunnelEdit.start == null || tunnelEdit.end == null) return showToast('名称与起讫里程必填', 'err');
          await db.tunnels.put({ id: tunnelEdit.id ?? uid('tn'), name: tunnelEdit.name, start: +tunnelEdit.start, end: +tunnelEdit.end });
          setTunnelEdit(null); showToast('隧道已保存', 'ok');
        }}>
          <div className="grid" style={{ gap: 12 }}>
            <div className="field"><label>隧道名称</label><input className="input" value={tunnelEdit.name ?? ''} onChange={(e) => setTunnelEdit({ ...tunnelEdit, name: e.target.value })} /></div>
            <div className="row">
              <div className="field" style={{ flex: 1 }}><label>起点里程 (m)</label><input className="input mono" type="number" value={tunnelEdit.start ?? 0} onChange={(e) => setTunnelEdit({ ...tunnelEdit, start: +e.target.value })} /></div>
              <div className="field" style={{ flex: 1 }}><label>终点里程 (m)</label><input className="input mono" type="number" value={tunnelEdit.end ?? 0} onChange={(e) => setTunnelEdit({ ...tunnelEdit, end: +e.target.value })} /></div>
            </div>
          </div>
        </EditModal>
      )}
    </div>
  );
}

// ---------------- 定位器 ----------------
function LocatorsTab() {
  const locators = useLiveQuery(() => db.locators.toArray());
  const [track, setTrack] = useState<'up' | 'down'>('up');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Partial<LocatorInfo> | null>(null);
  const showToast = useUi((s) => s.showToast);
  const list = (locators ?? []).filter((l) => l.track === track && (!q || l.poleCode.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => a.mileage - b.mileage);

  return (
    <div className="card">
      <div className="card-hd">
        <div className="seg"><button className={track === 'up' ? 'active' : ''} onClick={() => setTrack('up')}>上行</button><button className={track === 'down' ? 'active' : ''} onClick={() => setTrack('down')}>下行</button></div>
        <input className="input" placeholder="按杆号筛选" style={{ width: 180 }} value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="sub">{list.length} 个定位器</span><span className="spacer" />
        <button className="btn primary sm" onClick={() => setEditing({ track, type: '限位定位器', designStagger: 250 })}>＋ 新增定位器</button>
      </div>
      <div className="table-wrap fixed-head">
        <table className="tbl">
          <thead><tr><th>杆号</th><th className="num">里程</th><th>类型</th><th className="num">设计拉出(mm)</th><th className="right">操作</th></tr></thead>
          <tbody>
            {list.slice(0, 800).map((l) => (
              <tr key={l.id}>
                <td className="mono"><strong>{l.poleCode}</strong></td>
                <td className="mono">{fmtMileage(l.mileage)}</td>
                <td>{l.type}</td>
                <td className="num mono" style={{ color: l.designStagger >= 0 ? 'var(--primary)' : 'var(--purple)', fontWeight: 700 }}>{l.designStagger > 0 ? '+' : ''}{l.designStagger}</td>
                <td className="right"><button className="btn sm" onClick={() => setEditing(l)}>编</button>
                  <button className="btn sm danger" style={{ marginLeft: 6 }} onClick={() => db.locators.delete(l.id)}>删</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <EditModal title="定位器" onClose={() => setEditing(null)} onSave={async () => {
          if (!editing.poleCode || editing.mileage == null) return showToast('杆号与里程必填', 'err');
          await db.locators.put({ id: editing.id ?? uid('loc'), track, poleCode: editing.poleCode, mileage: +editing.mileage, type: editing.type ?? '限位定位器', designStagger: +(editing.designStagger ?? 0) });
          setEditing(null); showToast('定位器已保存', 'ok');
        }}>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field"><label>安装杆号</label><input className="input" value={editing.poleCode ?? ''} onChange={(e) => setEditing({ ...editing, poleCode: e.target.value })} /></div>
            <div className="field"><label>里程(m)</label><input className="input mono" type="number" value={editing.mileage ?? 0} onChange={(e) => setEditing({ ...editing, mileage: +e.target.value })} /></div>
            <div className="field"><label>类型</label><input className="input" value={editing.type ?? ''} onChange={(e) => setEditing({ ...editing, type: e.target.value })} /></div>
            <div className="field"><label>设计拉出值 (mm，带符号)</label><input className="input mono" type="number" value={editing.designStagger ?? 250} onChange={(e) => setEditing({ ...editing, designStagger: +e.target.value })} /></div>
          </div>
        </EditModal>
      )}
    </div>
  );
}

// ---------------- 吊弦 ----------------
function DroppersTab() {
  const droppers = useLiveQuery(() => db.droppers.toArray());
  const [track, setTrack] = useState<'up' | 'down'>('up');
  const [spanPole, setSpanPole] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<DropperInfo>>({ indexInSpan: 1 });
  const showToast = useUi((s) => s.showToast);
  const list = (droppers ?? []).filter((d) => d.track === track && (!spanPole || d.spanFromPole.toLowerCase().includes(spanPole.toLowerCase()))).sort((a, b) => a.mileage - b.mileage);

  return (
    <div className="card">
      <div className="card-hd">
        <div className="seg"><button className={track === 'up' ? 'active' : ''} onClick={() => setTrack('up')}>上行</button><button className={track === 'down' ? 'active' : ''} onClick={() => setTrack('down')}>下行</button></div>
        <input className="input" placeholder="按跨距前杆号筛选，如 S0420" style={{ width: 220 }} value={spanPole} onChange={(e) => setSpanPole(e.target.value)} />
        <span className="sub">{list.length} 根吊弦</span><span className="spacer" />
        <button className="btn primary sm" onClick={() => setAdding(true)}>＋ 新增吊弦位置</button>
      </div>
      <div className="table-wrap fixed-head">
        <table className="tbl">
          <thead><tr><th>所属跨（前杆）</th><th>锚段</th><th className="num">跨内序号</th><th className="num">里程</th><th>里程标</th><th className="right">操作</th></tr></thead>
          <tbody>
            {list.slice(0, 800).map((d) => (
              <tr key={d.id}>
                <td className="mono"><strong>{d.spanFromPole}</strong></td>
                <td><Badge kind="info">{d.anchorCode ?? '—'}</Badge></td>
                <td className="num">{d.indexInSpan}</td>
                <td className="num mono">{d.mileage.toFixed(2)}</td>
                <td className="mono dim">{fmtMileage(d.mileage)}</td>
                <td className="right"><button className="btn sm danger" onClick={() => db.droppers.delete(d.id)}>删除</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && (
        <EditModal title="新增吊弦位置" onClose={() => setAdding(false)} onSave={async () => {
          if (!draft.spanFromPole || draft.mileage == null) return showToast('前杆号与里程必填', 'err');
          await db.droppers.put({ id: uid('drp'), track, spanFromPole: draft.spanFromPole, anchorCode: draft.anchorCode, mileage: +draft.mileage, indexInSpan: +(draft.indexInSpan ?? 1) });
          setAdding(false); showToast('吊弦已添加', 'ok');
        }}>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field"><label>跨距前杆号</label><input className="input" value={draft.spanFromPole ?? ''} onChange={(e) => setDraft({ ...draft, spanFromPole: e.target.value })} /></div>
            <div className="field"><label>锚段号</label><input className="input" value={draft.anchorCode ?? ''} onChange={(e) => setDraft({ ...draft, anchorCode: e.target.value })} /></div>
            <div className="field"><label>里程(m)</label><input className="input mono" type="number" step={0.01} value={draft.mileage ?? 0} onChange={(e) => setDraft({ ...draft, mileage: +e.target.value })} /></div>
            <div className="field"><label>跨内序号</label><input className="input mono" type="number" value={draft.indexInSpan ?? 1} onChange={(e) => setDraft({ ...draft, indexInSpan: +e.target.value })} /></div>
          </div>
        </EditModal>
      )}
    </div>
  );
}

// ---------------- 锚段几何图 ----------------
function GeometryTab() {
  const anchors = useLiveQuery(() => db.anchors.toArray());
  const runs = useLiveQuery(() => db.runs.toArray());
  const batches = useLiveQuery(() => db.batches.toArray());
  const poles = useLiveQuery(() => db.poles.toArray());
  const droppers = useLiveQuery(() => db.droppers.toArray());
  const defects = useLiveQuery(() => db.defects.toArray());
  const line = useLiveQuery(() => db.line.get('line'));
  const settings = useLiveQuery(() => db.settings.get('settings'));
  const showToast = useUi((s) => s.showToast);

  const [track, setTrack] = useState<'up' | 'down'>('up');
  const [batchId, setBatchId] = useState('');
  const trackAnchors = (anchors ?? []).filter((a) => a.track === track).sort((a, b) => a.fromMileage - b.fromMileage);
  const sortedBatches = [...(batches ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const bid = batchId || sortedBatches[0]?.id || '';
  const run = runs?.find((r) => r.batchId === bid && r.track === track) ?? null;
  const [code, setCode] = useState('');
  const anchor = trackAnchors.find((a) => a.code === code) ?? trackAnchors[0];

  const svg = useMemo(() => {
    if (!anchor || !line || !settings || !poles || !droppers) return '';
    return anchorGeometrySvg({
      anchor,
      run,
      poles: poles.filter((p) => p.track === track),
      droppers: droppers.filter((d) => d.track === track),
      defects: (defects ?? []).filter((d) => d.runId === run?.id && d.anchorCode === anchor.code),
      designHeight: line.designHeight,
      heightL1: settings.limits.heightLevel1,
      heightL2: settings.limits.heightLevel2,
      pullL1: settings.limits.pullLevel1,
      pullL2: settings.limits.pullLevel2,
    });
  }, [anchor, line, settings, poles, droppers, defects, run, track]);

  const downloadSvg = () => {
    if (!anchor) return;
    const full = `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`;
    downloadBlob(`锚段几何图_${anchor.code}.svg`, new Blob([full], { type: 'image/svg+xml;charset=utf-8' }));
  };

  const exportAlbum = () => {
    if (!line || !settings || !poles || !droppers || !bid) return;
    const svgs = trackAnchors.map((a) => ({
      code: a.code,
      svg: anchorGeometrySvg({
        anchor: a,
        run,
        poles: poles.filter((p) => p.track === track),
        droppers: droppers.filter((d) => d.track === track),
        defects: (defects ?? []).filter((d) => d.runId === run?.id && d.anchorCode === a.code),
        designHeight: line.designHeight,
        heightL1: settings.limits.heightLevel1,
        heightL2: settings.limits.heightLevel2,
        pullL1: settings.limits.pullLevel1,
        pullL2: settings.limits.pullLevel2,
      }),
    }));
    const batch = batches?.find((b) => b.id === bid);
    const html = anchorAlbumHtml({ lineName: line.name, batchName: batch?.name ?? '', trackLabel: TRACK_LABEL[track], svgs });
    downloadBlob(`${line.name}_${TRACK_LABEL[track]}_锚段几何图图册.html`, new Blob([html], { type: 'text/html;charset=utf-8' }));
    showToast(`已生成 ${svgs.length} 个锚段的几何图图册，浏览器打开后可打印为 PDF`, 'ok');
  };

  if (!anchor) return <div className="card"><Empty text="该线别暂无锚段档案" /></div>;

  return (
    <div className="card">
      <div className="card-hd">
        <div className="seg"><button className={track === 'up' ? 'active' : ''} onClick={() => setTrack('up')}>上行</button><button className={track === 'down' ? 'active' : ''} onClick={() => setTrack('down')}>下行</button></div>
        <select className="input" style={{ width: 230 }} value={bid} onChange={(e) => setBatchId(e.target.value)}>
          {sortedBatches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className="input" style={{ width: 260 }} value={anchor.code} onChange={(e) => setCode(e.target.value)}>
          {trackAnchors.map((a) => <option key={a.id} value={a.code}>{a.code} · {fmtMileage(a.fromMileage, false)}~{fmtMileage(a.toMileage, false)}</option>)}
        </select>
        <span className="spacer" />
        <button className="btn" onClick={downloadSvg}>⬇ 导出本锚段 SVG</button>
        <button className="btn primary" onClick={exportAlbum}>📚 导出全部锚段几何图（HTML/PDF）</button>
      </div>
      <div className="card-bd" style={{ background: '#e9eef5' }}>
        <div style={{ background: '#fff', borderRadius: 8, padding: 8, overflowX: 'auto' }} dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    </div>
  );
}

function EditModal({ title, children, onClose, onSave }: { title: string; children: React.ReactNode; onClose: () => void; onSave: () => void }) {
  return (
    <Modal title={title} onClose={onClose} footer={<><button className="btn" onClick={onClose}>取消</button><button className="btn primary" onClick={onSave}>保存</button></>}>
      {children}
    </Modal>
  );
}
