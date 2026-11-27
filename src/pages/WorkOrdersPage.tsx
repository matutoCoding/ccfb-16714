import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, completeWorkOrder, verifyWorkOrder } from '../core/db';
import type { WorkOrder } from '../core/types';
import { Badge, Stat, Modal, Empty } from '../components/ui';
import { useUi } from '../state/ui';
import { fmtMileage, fmtDate } from '../core/format';
import { orderStatusMeta } from '../core/workorder';

export default function WorkOrdersPage() {
  const orders = useLiveQuery(() => db.workOrders.orderBy('createdAt').reverse().toArray());
  const defects = useLiveQuery(() => db.defects.toArray());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [measure, setMeasure] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const showToast = useUi((s) => s.showToast);
  const gotoReplay = useUi((s) => s.gotoReplay);

  const active = orders?.find((o) => o.id === activeId) ?? null;
  const activeDefects = useMemo(
    () => (active ? (defects ?? []).filter((d) => active.defectIds.includes(d.id)) : []),
    [active, defects],
  );

  const openCount = orders?.filter((o) => o.status !== 'done').length ?? 0;
  const passCount = orders?.filter((o) => o.verification?.passed).length ?? 0;
  const failCount = orders?.filter((o) => o.verification && !o.verification.passed).length ?? 0;

  const openComplete = (o: WorkOrder) => {
    setActiveId(o.id);
    setMeasure(o.measure ?? '');
    setResult(o.result ?? '');
  };

  const submitResult = async () => {
    if (!active) return;
    if (!measure.trim() || !result.trim()) {
      showToast('请填写处理措施与处理结果', 'err');
      return;
    }
    setBusy(true);
    try {
      const updated = await completeWorkOrder(active.id, { measure, result });
      if (updated?.verification) {
        showToast(updated.verification.passed ? '结果已登记，下次检测数据核对：确认修复 ✓' : `结果已登记，核对提示：${updated.verification.note}`, updated.verification.passed ? 'ok' : 'err');
      } else {
        showToast('结果已登记；尚无之后的检测批次，待下次检测后自动核对', 'ok');
      }
      setActiveId(null);
    } finally {
      setBusy(false);
    }
  };

  const reverify = async (id: string) => {
    const wo = await verifyWorkOrder(id);
    if (wo?.verification) showToast(wo.verification.note, wo.verification.passed ? 'ok' : 'err');
    else showToast('没有晚于工单完成时间的检测 run 可核对');
  };

  return (
    <div>
      <div className="stat-grid" style={{ marginBottom: 18 }}>
        <Stat label="工单总数" value={orders?.length ?? 0} unit="张" bar="#1d6fe0" />
        <Stat label="待处理/处理中" value={openCount} unit="张" tone="warn" bar="#f59e0b" />
        <Stat label="复核确认修复" value={passCount} unit="张" tone="good" bar="#0a9d6c" />
        <Stat label="复核未过/复发" value={failCount} unit="张" tone="bad" bar="#dc2626" />
      </div>

      <div className="card">
        <div className="card-hd"><h3>维修工单台账</h3><span className="sub">从超限点生成 · 下次检测自动核对</span></div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>工单号</th><th>标题/位置</th><th>工区</th><th>优先级</th><th>状态</th>
                <th>创建</th><th>计划天窗</th><th>复核结果</th><th className="right">操作</th>
              </tr>
            </thead>
            <tbody>
              {(orders ?? []).map((o) => {
                const meta = orderStatusMeta(o);
                return (
                  <tr key={o.id}>
                    <td className="mono"><strong>{o.code}</strong></td>
                    <td style={{ maxWidth: 340 }}>
                      <div style={{ fontWeight: 600 }}>{o.title}</div>
                      <div className="dim mono" style={{ fontSize: 11.5 }}>
                        {o.track === 'up' ? '上行' : '下行'} {fmtMileage(o.mileage)} · {o.poleCode ?? ''} · {o.anchorCode ?? ''} · {o.defectIds.length} 处
                      </div>
                    </td>
                    <td>{o.assignee}</td>
                    <td>{o.priority === 2 ? <Badge kind="l2">二级</Badge> : <Badge kind="l1">一级</Badge>}</td>
                    <td><span className="badge" style={{ background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}55` }}>{meta.label}</span></td>
                    <td className="dim nowrap" style={{ fontSize: 12 }}>{fmtDate(o.createdAt)}</td>
                    <td className="nowrap">{o.plannedDate ?? '—'}</td>
                    <td style={{ maxWidth: 260 }}>
                      {o.verification ? (
                        <span style={{ fontSize: 12, color: o.verification.passed ? 'var(--ok)' : 'var(--l2)' }}>
                          {o.verification.passed ? '✓' : '⚠'} {o.verification.beforeValue}→{o.verification.afterValue}（{o.verification.reductionPct}%）
                        </span>
                      ) : o.status === 'done' ? <span className="dim" style={{ fontSize: 12 }}>待新检测</span> : '—'}
                    </td>
                    <td className="right nowrap">
                      <button className="btn sm" onClick={() => gotoReplay({ mileage: o.mileage, track: o.track })}>三维</button>
                      {o.status !== 'done' && <button className="btn sm primary" style={{ marginLeft: 6 }} onClick={() => openComplete(o)}>登记结果</button>}
                      {o.status === 'done' && <button className="btn sm" style={{ marginLeft: 6 }} onClick={() => reverify(o.id)}>重新核对</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!orders?.length && <Empty icon="📋" text="还没有工单" hint="到超限管理页勾选超限点生成工单" />}
        </div>
      </div>

      {active && (
        <Modal
          lg
          title={`登记处理结果 · ${active.code}`}
          onClose={() => setActiveId(null)}
          footer={<>
            <button className="btn" onClick={() => setActiveId(null)}>取消</button>
            <button className="btn ok" disabled={busy} onClick={submitResult}>{busy ? '提交并核对中…' : '提交并由下次检测核对'}</button>
          </>}
        >
          <div className="grid" style={{ gap: 14 }}>
            <div className="card" style={{ boxShadow: 'none', background: '#f6f9fd' }}>
              <div className="card-bd" style={{ padding: 12 }}>
                <strong>{active.title}</strong>
                <div className="dim" style={{ fontSize: 12.5, marginTop: 4 }}>
                  {active.track === 'up' ? '上行' : '下行'} {fmtMileage(active.mileage)} · {active.poleCode} · 关联 {activeDefects.length} 个超限点
                </div>
              </div>
            </div>
            <div className="field"><label>处理措施</label><textarea className="input" value={measure} onChange={(e) => setMeasure(e.target.value)} placeholder="如：调整吊弦/定位器、更换部件、调整导高与拉出值…" /></div>
            <div className="field"><label>处理结果与复测数据</label><textarea className="input" value={result} onChange={(e) => setResult(e.target.value)} placeholder="记录更换部件、调整量、现场复测导高/拉出值…" /></div>
            {active.measure && active.status === 'done' && (
              <div className="dim" style={{ fontSize: 12.5 }}>
                <div>原措施：{active.measure}</div>
                <div>原结果：{active.result}</div>
              </div>
            )}
            <div className="dim" style={{ fontSize: 12.5 }}>
              提交后系统会自动寻找完成日期之后最早的同线别检测 run，在 {`±`}12m 窗口比较异常分量降幅并判定是否修好（阈值可在设置中调整）。
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
