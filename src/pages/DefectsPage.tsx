import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, createWorkOrder } from '../core/db';
import type { Defect } from '../core/types';
import { Badge, LevelBadge, Stat, Modal, Empty } from '../components/ui';
import { useUi } from '../state/ui';
import { fmtMileage, downloadText } from '../core/format';
import { defectsReportCsv } from '../core/exporter';

export default function DefectsPage() {
  const defects = useLiveQuery(() => db.defects.toArray());
  const batches = useLiveQuery(() => db.batches.toArray());
  const workOrders = useLiveQuery(() => db.workOrders.toArray());
  const gotoReplay = useUi((s) => s.gotoReplay);
  const navigate = useUi((s) => s.navigate);
  const showToast = useUi((s) => s.showToast);

  const [batchId, setBatchId] = useState('all');
  const [track, setTrack] = useState<'all' | 'up' | 'down'>('all');
  const [level, setLevel] = useState<'all' | 1 | 2>('all');
  const [metric, setMetric] = useState<'all' | 'height' | 'pull'>('all');
  const [status, setStatus] = useState<'all' | Defect['status']>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [orderOpen, setOrderOpen] = useState(false);
  const [assignee, setAssignee] = useState('宁州接触网一工区');
  const [plannedDate, setPlannedDate] = useState('');

  const list = useMemo(() => {
    return (defects ?? [])
      .filter((d) => batchId === 'all' || d.batchId === batchId)
      .filter((d) => track === 'all' || d.track === track)
      .filter((d) => level === 'all' || d.level === level)
      .filter((d) => metric === 'all' || d.metric === metric)
      .filter((d) => status === 'all' || d.status === status)
      .sort((a, b) => a.mileage - b.mileage);
  }, [defects, batchId, track, level, metric, status]);

  const l2 = defects?.filter((d) => d.level === 2).length ?? 0;
  const open = defects?.filter((d) => d.status === 'open').length ?? 0;
  const verified = defects?.filter((d) => d.status === 'verified').length ?? 0;

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const allChecked = list.length > 0 && list.every((d) => selected.has(d.id));
  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(list.map((d) => d.id)));
  };

  const exportCsv = () => {
    if (!list.length) return showToast('当前筛选无记录', 'err');
    const woMap = new Map((workOrders ?? []).map((w) => [w.id, w.code]));
    const csv = defectsReportCsv(list, { batches: batches ?? [], workOrderCode: (id) => (id ? woMap.get(id) ?? '' : '') });
    downloadText(`超限报表_${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8');
    showToast(`已导出 ${list.length} 条超限记录`, 'ok');
  };

  const submitOrder = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    const id = await createWorkOrder({ defectIds: ids, assignee, plannedDate: plannedDate || undefined });
    setOrderOpen(false);
    setSelected(new Set());
    showToast('工单已生成，可在维修工单页登记处理结果', 'ok');
    void id;
  };

  return (
    <div>
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <Stat label="超限点总数" value={defects?.length ?? 0} unit="处" bar="#1d6fe0" />
        <Stat label="二级超限" value={l2} unit="处" tone="bad" bar="#dc2626" />
        <Stat label="待处理" value={open} unit="处" tone="warn" bar="#f59e0b" />
        <Stat label="下次检测复核已修复" value={verified} unit="处" tone="good" bar="#0a9d6c" />
      </div>

      <div className="toolbar">
        <select className="input" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
          <option value="all">全部批次</option>
          {(batches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <div className="seg">
          {(['all', 'up', 'down'] as const).map((t) => (
            <button key={t} className={track === t ? 'active' : ''} onClick={() => setTrack(t)}>
              {t === 'all' ? '双線' : t === 'up' ? '上行' : '下行'}
            </button>
          ))}
        </div>
        <div className="seg">
          {(['all', 2, 1] as const).map((l) => (
            <button key={String(l)} className={level === l ? 'active' : ''} onClick={() => setLevel(l)}>
              {l === 'all' ? '全部等级' : l === 2 ? '二级' : '一级'}
            </button>
          ))}
        </div>
        <select className="input" value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)}>
          <option value="all">全部项目</option>
          <option value="height">导高</option>
          <option value="pull">拉出值</option>
        </select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">全部状态</option>
          <option value="open">未处理</option>
          <option value="ordered">已派单</option>
          <option value="processing">处理中</option>
          <option value="resolved">待复核</option>
          <option value="verified">已修复</option>
        </select>
        <span className="spacer" />
        <button className="btn" onClick={exportCsv}>⬇ 导出超限报表 CSV</button>
        <button className="btn primary" disabled={!selected.size} onClick={() => setOrderOpen(true)}>
          📋 生成维修工单{selected.size ? `（${selected.size}）` : ''}
        </button>
      </div>

      <div className="card">
        <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 300px)' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 36 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} /></th>
                <th>等级</th><th>项目</th><th>线别</th><th>峰值里程</th><th>支柱/锚段</th>
                <th className="num">峰值</th><th className="num">异常偏差</th><th className="num">阈值</th>
                <th>状态</th><th className="right">联动</th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id} className="clickable" onClick={() => gotoReplay({ defectId: d.id, mileage: d.mileage, batchId: d.batchId, track: d.track })}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} /></td>
                  <td><LevelBadge level={d.level} /></td>
                  <td>{d.metric === 'height' ? '导高' : '拉出值'}</td>
                  <td>{d.track === 'up' ? '上行' : '下行'}</td>
                  <td className="mono"><strong>{fmtMileage(d.mileage)}</strong><div className="dim" style={{ fontSize: 11 }}>长 {d.length.toFixed(1)}m</div></td>
                  <td><span className="mono">{d.poleCode ?? '—'}</span><div className="dim" style={{ fontSize: 11 }}>{d.anchorCode ?? ''}</div></td>
                  <td className="num mono" style={{ fontWeight: 800, color: d.level === 2 ? 'var(--l2)' : '#b96f00' }}>{d.value}</td>
                  <td className="num mono">{d.deviation > 0 && d.metric === 'pull' ? '+' : ''}{d.deviation}</td>
                  <td className="num mono dim">{d.limitUsed}</td>
                  <td><StatusBadge d={d} /></td>
                  <td className="right" onClick={(e) => e.stopPropagation()}>
                    <button className="btn sm" onClick={(e) => { e.stopPropagation(); gotoReplay({ defectId: d.id, mileage: d.mileage, batchId: d.batchId, track: d.track }); }}>🛰 三维定位</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.length && <Empty icon="🎉" text="当前筛选条件下没有超限记录" />}
        </div>
      </div>

      {orderOpen && (
        <Modal
          title={`由 ${selected.size} 个超限点生成维修工单`}
          onClose={() => setOrderOpen(false)}
          footer={<>
            <button className="btn" onClick={() => setOrderOpen(false)}>取消</button>
            <button className="btn primary" onClick={submitOrder}>生成工单</button>
          </>}
        >
          <div className="grid" style={{ gap: 14 }}>
            <div className="field"><label>责任工区/负责人</label><input className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)} /></div>
            <div className="field"><label>计划处理日期（天窗）</label><input className="input" type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} /></div>
            <div className="dim" style={{ fontSize: 12.5 }}>
              工单生成后可在「维修工单」页登记处理措施与结果；下一次月度检测入库后，系统会按同里程窗口自动核对是否修好。
            </div>
            <button className="btn ghost" onClick={() => navigate('workorders')}>前往维修工单页 →</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function StatusBadge({ d }: { d: Defect }) {
  switch (d.status) {
    case 'open': return <Badge kind="l2">未处理</Badge>;
    case 'ordered': return <Badge kind="l1">已派单</Badge>;
    case 'processing': return <Badge kind="info">处理中</Badge>;
    case 'resolved': return <Badge kind="purple">待下次检测复核</Badge>;
    case 'verified': return <Badge kind="ok">✓ 复核已修复</Badge>;
  }
}
