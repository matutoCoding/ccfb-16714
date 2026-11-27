import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, importParsedCsv, getSettings } from '../core/db';
import { parseDetectionCsv, CSV_TEMPLATE, runToRawCsv } from '../core/csv';
import { alignRun } from '../core/alignment';
import { judgeRun } from '../core/judge';
import type { DetectionBatch, DetectionRun, TrackId } from '../core/types';
import { Badge, Modal, Stat, Empty } from '../components/ui';
import { useUi } from '../state/ui';
import { fmtMileage, downloadText } from '../core/format';

export default function BatchesPage() {
  const batches = useLiveQuery(() => db.batches.orderBy('date').toArray());
  const runs = useLiveQuery(() => db.runs.toArray());
  const defects = useLiveQuery(() => db.defects.toArray());
  const gotoReplay = useUi((s) => s.gotoReplay);
  const showToast = useUi((s) => s.showToast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [detailRunId, setDetailRunId] = useState<string | null>(null);
  const [importMeta, setImportMeta] = useState<{ name: string; date: string; track: TrackId; fileName: string; text: string } | null>(null);
  const [importing, setImporting] = useState(false);

  const sorted = useMemo(() => [...(batches ?? [])].sort((a, b) => b.date.localeCompare(a.date)), [batches]);
  const detailRun = runs?.find((r) => r.id === detailRunId) ?? null;

  const passCount = runs?.filter((r) => r.report.pass).length ?? 0;
  const totalPoles = runs?.[0]?.report.archivePoleCount ?? 0;

  const onPickFile = async (file: File) => {
    const text = await file.text();
    let parsed;
    try {
      parsed = parseDetectionCsv(text);
    } catch (e) {
      showToast(`CSV 解析失败：${(e as Error).message}`, 'err');
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    setImportMeta({
      name: `${file.name.replace(/\.csv$/i, '')} 导入批次`,
      date: today,
      track: 'up',
      fileName: file.name,
      text,
    });
    setImportOpen(true);
    void parsed;
  };

  const confirmImport = async () => {
    if (!importMeta) return;
    setImporting(true);
    try {
      const parsed = parseDetectionCsv(importMeta.text);
      const settings = await getSettings();
      const res = await importParsedCsv({
        parsed,
        batchName: importMeta.name,
        batchDate: importMeta.date,
        track: importMeta.track,
        fileName: importMeta.fileName,
        limits: settings.limits,
      });
      showToast(`导入对齐完成：${parsed.rowCount} 行，最大留一杆误差 ${res.maxCvError.toFixed(3)}m，超限 ${res.defectCount} 处`, res.maxCvError < 0.5 ? 'ok' : 'err');
      setImportOpen(false);
      setImportMeta(null);
    } catch (e) {
      showToast((e as Error).message, 'err');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const downloadSampleCsv = () => {
    const r = runs?.[0];
    if (!r) return;
    const csv = runToRawCsv({
      rawMileage: r.rawMileage,
      height: r.height,
      pull: r.pull,
      speed: r.speed,
      poleMarks: r.poleMarks,
    });
    downloadText(`检测车原始数据_含里程漂移_${r.id}.csv`, csv, 'text/csv;charset=utf-8');
    showToast('已下载带漂移的原始 CSV，可直接用“导入检测车 CSV”测试对齐', 'ok');
  };

  return (
    <div>
      <div className="toolbar">
        <button className="btn primary" onClick={() => fileRef.current?.click()}>📤 导入检测车 CSV</button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPickFile(f);
          }}
        />
        <button className="btn" onClick={downloadSampleCsv}>⬇ 下载演示 CSV（含漂移）</button>
        <button className="btn" onClick={() => downloadText('检测车CSV模板.csv', CSV_TEMPLATE, 'text/csv;charset=utf-8')}>📄 CSV 格式模板</button>
        <span className="spacer" />
        <span className="dim" style={{ fontSize: 12 }}>CSV 需含「里程」列与「杆号」列，系统按杆号对齐档案支柱</span>
      </div>

      <div className="stat-grid" style={{ marginBottom: 18 }}>
        <Stat label="检测批次" value={batches?.length ?? 0} unit="个" bar="#1d6fe0" />
        <Stat label="检测运行（批次×线别）" value={runs?.length ?? 0} unit="条" bar="#0891b2" />
        <Stat label="对齐精度达标（<0.5m）" value={`${passCount}/${runs?.length ?? 0}`} tone={passCount === (runs?.length ?? 0) && !!runs?.length ? 'good' : 'warn'} bar="#0a9d6c" />
        <Stat label="每线支柱档案" value={totalPoles} unit="根" foot="跨距 46–54m" bar="#7c3aed" />
        <Stat label="超限记录总数" value={defects?.length ?? 0} unit="处" tone="bad" bar="#dc2626" />
      </div>

      {!sorted.length && <div className="card"><Empty text="暂无检测批次" hint="点击右上角导入 CSV，或在设置中重新生成演示数据" /></div>}

      <div className="grid" style={{ gap: 16 }}>
        {sorted.map((b) => (
          <BatchCard
            key={b.id}
            batch={b}
            runs={(runs ?? []).filter((r) => r.batchId === b.id)}
            defectCount={(defects ?? []).filter((d) => d.batchId === b.id).length}
            onDetail={setDetailRunId}
            onReplay={(track) => gotoReplay({ batchId: b.id, track })}
          />
        ))}
      </div>

      {importOpen && importMeta && (
        <Modal
          title="导入检测车 CSV · 对齐设置"
          onClose={() => setImportOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setImportOpen(false)}>取消</button>
              <button className="btn primary" disabled={importing || !importMeta.name || !importMeta.date} onClick={confirmImport}>
                {importing ? '对齐与判定中…' : '开始对齐并入库'}
              </button>
            </>
          }
        >
          <div className="grid" style={{ gap: 14 }}>
            <div className="field"><label>批次名称</label><input className="input" value={importMeta.name} onChange={(e) => setImportMeta({ ...importMeta, name: e.target.value })} /></div>
            <div className="row">
              <div className="field" style={{ flex: 1 }}><label>检测日期</label><input className="input" type="date" value={importMeta.date} onChange={(e) => setImportMeta({ ...importMeta, date: e.target.value })} /></div>
              <div className="field" style={{ flex: 1 }}>
                <label>线别</label>
                <select className="input" value={importMeta.track} onChange={(e) => setImportMeta({ ...importMeta, track: e.target.value as TrackId })}>
                  <option value="up">上行</option>
                  <option value="down">下行</option>
                </select>
              </div>
            </div>
            <div className="dim" style={{ fontSize: 12.5 }}>
              文件：{importMeta.fileName}。导入后将自动：杆号匹配 → 识别里程跳变/断点 → 分段修正 → 按当前限界判定超限。
            </div>
          </div>
        </Modal>
      )}

      {detailRun && <AlignmentModal run={detailRun} onClose={() => setDetailRunId(null)} />}
    </div>
  );
}

function BatchCard(props: {
  batch: DetectionBatch;
  runs: DetectionRun[];
  defectCount: number;
  onDetail: (id: string) => void;
  onReplay: (track: TrackId) => void;
}) {
  const { batch, runs } = props;
  return (
    <div className="card">
      <div className="card-hd">
        <h3>{batch.name}</h3>
        <Badge kind="gray">{batch.date}</Badge>
        {batch.source === 'seed' ? <Badge kind="purple">演示数据</Badge> : <Badge kind="info">CSV 导入</Badge>}
        <span className="sub">{batch.note}</span>
        <span className="spacer" />
        <Badge kind={props.defectCount ? 'l2' : 'ok'}>{props.defectCount ? `超限 ${props.defectCount} 处` : '无超限'}</Badge>
      </div>
      <div className="card-bd tight">
        <table className="tbl">
          <thead>
            <tr>
              <th>线别</th><th>采样点数</th><th>杆号匹配</th><th>跳变</th><th>断点</th><th>分段</th>
              <th>最大留一杆误差</th><th>全采样真值误差</th><th>对齐结论</th><th className="right">操作</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.track === 'up' ? '上行' : '下行'}</strong><div className="dim" style={{ fontSize: 11 }}>{r.fileName}</div></td>
                <td className="num mono">{r.pointCount.toLocaleString()}</td>
                <td className="mono">{r.report.matchedPoleCount}/{r.report.archivePoleCount}
                  {r.report.unknownCodeCount > 0 && <Badge kind="l1"> 未知号 {r.report.unknownCodeCount}</Badge>}
                </td>
                <td>{r.report.jumps.length ? <Badge kind="l1">{r.report.jumps.length} 处</Badge> : <span className="dim">0</span>}</td>
                <td>{r.report.breaks.length ? <Badge kind="l1">{r.report.breaks.length} 处</Badge> : <span className="dim">0</span>}</td>
                <td className="num">{r.report.segments.length}</td>
                <td className="mono" style={{ fontWeight: 700, color: r.report.maxCvError < 0.5 ? 'var(--ok)' : 'var(--l2)' }}>
                  {r.report.maxCvError.toFixed(3)} m
                </td>
                <td className="mono" style={{ color: r.report.maxTrueError != null && r.report.maxTrueError < 0.5 ? 'var(--ok)' : r.report.maxTrueError != null ? 'var(--l2)' : 'var(--text-3)' }}>
                  {r.report.maxTrueError != null ? `${r.report.maxTrueError.toFixed(3)} m` : '—'}
                </td>
                <td>{r.report.pass ? <Badge kind="ok">✓ 偏差&lt;0.5m</Badge> : <Badge kind="l2">未达标</Badge>}</td>
                <td className="right nowrap">
                  <button className="btn sm" onClick={() => props.onDetail(r.id)}>对齐详情/修正</button>
                  <button className="btn sm primary" style={{ marginLeft: 6 }} onClick={() => props.onReplay(r.track)}>三维回放</button>
                </td>
              </tr>
            ))}
            {!runs.length && <tr><td colSpan={10}><Empty text="该批次暂无运行数据" /></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AlignmentModal({ run, onClose }: { run: DetectionRun; onClose: () => void }) {
  const showToast = useUi((s) => s.showToast);
  const [offset, setOffset] = useState(run.report.manualOffset ?? 0);
  const [scale, setScale] = useState(run.report.manualScale ?? 1);
  const [ignored, setIgnored] = useState<string[]>(
    run.report.jumps.filter((j) => !j.accepted).map((j) => j.id),
  );
  const [poleFilter, setPoleFilter] = useState('');
  const [busy, setBusy] = useState(false);

  const poles = useLiveQuery(() => db.poles.where('track').equals(run.track).sortBy('mileage'));
  const r = run.report;

  const recompute = async (nextIgnored = ignored, nextOffset = offset, nextScale = scale) => {
    if (!poles) return;
    setBusy(true);
    try {
      const { fixed, report } = alignRun({
        rawMileage: run.rawMileage,
        poleMarks: run.poleMarks,
        archivePoles: poles,
        truthMileage: run.truthMileage,
        tolerance: 0.5,
        ignoredJumpIds: nextIgnored,
        manualOffset: nextOffset,
        manualScale: nextScale,
      });
      // 重新判定超限（阈值取当前设置）
      const settings = await getSettings();
      const line = await db.line.get('line');
      const anchors = await db.anchors.where('track').equals(run.track).toArray();
      const updatedRun: DetectionRun = { ...run, fixedMileage: fixed, report };
      const defects = judgeRun({
        run: updatedRun,
        batchId: run.batchId,
        track: run.track,
        limits: settings.limits,
        poles,
        anchors,
        designHeight: line?.designHeight ?? 6000,
        designStagger: line?.designStagger ?? 250,
      });
      await db.transaction('rw', db.runs, db.defects, async () => {
        await db.runs.put(updatedRun);
        await db.defects.where('runId').equals(run.id).delete();
        if (defects.length) await db.defects.bulkPut(defects);
      });
      showToast(`已重新对齐：最大留一杆误差 ${report.maxCvError.toFixed(3)}m`, report.pass ? 'ok' : 'err');
    } finally {
      setBusy(false);
    }
  };

  const toggleJump = (id: string) => {
    const next = ignored.includes(id) ? ignored.filter((x) => x !== id) : [...ignored, id];
    setIgnored(next);
    recompute(next);
  };

  const filteredPoles = r.poleResults
    .filter((p) => !poleFilter || p.code.toLowerCase().includes(poleFilter.toLowerCase()))
    .slice(0, 400);

  return (
    <Modal lg title={`里程对齐详情 · ${run.id}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>关闭</button>
        <button className="btn primary" disabled={busy} onClick={() => recompute()}>{busy ? '重算中…' : '应用手动修正并重判超限'}</button></>}>
      <div className="grid" style={{ gap: 16 }}>
        <div className={`gauge-pass ${r.pass ? '' : 'gauge-fail'}`}>
          <div className="check">{r.pass ? '✓' : '!'}</div>
          <div>
            <div className="big" style={{ color: r.pass ? 'var(--ok)' : 'var(--l2)' }}>
              最大偏差 {r.maxCvError.toFixed(3)} m {r.pass ? '< 0.5 m 达标' : '≥ 0.5 m'}
            </div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              留一杆交叉验证 RMS {r.rmsCvError.toFixed(3)}m · 匹配支柱 {r.matchedPoleCount}/{r.archivePoleCount}
              {r.maxTrueError != null && ` · 演示数据全采样真值最大误差 ${r.maxTrueError.toFixed(3)}m`}
            </div>
          </div>
        </div>

        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ width: 170 }}>
            <label>整体里程偏移 (m)</label>
            <input className="input mono" type="number" step={0.1} value={offset} onChange={(e) => setOffset(parseFloat(e.target.value) || 0)} />
          </div>
          <div className="field" style={{ width: 170 }}>
            <label>里程系数微调（1=不调）</label>
            <input className="input mono" type="number" step={0.0001} value={scale} onChange={(e) => setScale(parseFloat(e.target.value) || 1)} />
          </div>
          <span className="dim" style={{ fontSize: 12 }}>用于现场复核后的整体平移/轮径系数修正，叠加在自动分段映射之上。</span>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <div className="section-title">里程跳变（{r.jumps.length}）</div>
            <div className="table-wrap" style={{ maxHeight: 210, border: '1px solid var(--line-soft)', borderRadius: 8 }}>
              <table className="tbl">
                <thead><tr><th>相邻杆</th><th className="num">跳变量</th><th>启用修正</th></tr></thead>
                <tbody>
                  {r.jumps.map((j) => (
                    <tr key={j.id}>
                      <td className="mono" style={{ fontSize: 11.5 }}>{j.betweenPoles?.[0]}~{j.betweenPoles?.[1]}</td>
                      <td className="num mono" style={{ color: Math.abs(j.discrepancy) > 10 ? 'var(--l2)' : 'var(--warn)', fontWeight: 700 }}>
                        {j.discrepancy > 0 ? '+' : ''}{j.discrepancy.toFixed(1)}m
                      </td>
                      <td><input type="checkbox" checked={!ignored.includes(j.id)} onChange={() => toggleJump(j.id)} /></td>
                    </tr>
                  ))}
                  {!r.jumps.length && <tr><td colSpan={3} className="dim center" style={{ padding: 16 }}>未识别到里程跳变</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <div className="section-title">断点 / 非单调（{r.breaks.length}）</div>
            <div className="table-wrap" style={{ maxHeight: 210, border: '1px solid var(--line-soft)', borderRadius: 8 }}>
              <table className="tbl">
                <thead><tr><th>类型</th><th>位置原始里程</th><th>说明</th></tr></thead>
                <tbody>
                  {r.breaks.map((b) => (
                    <tr key={b.id}>
                      <td><Badge kind={b.reason === 'data-gap' ? 'l1' : 'l2'}>
                        {b.reason === 'data-gap' ? '数据缺口' : b.reason === 'mileage-reset' ? '主机重置' : '非单调'}
                      </Badge></td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{fmtMileage(b.rawFrom)}</td>
                      <td style={{ fontSize: 11.5 }}>{b.note}</td>
                    </tr>
                  ))}
                  {!r.breaks.length && <tr><td colSpan={3} className="dim center" style={{ padding: 16 }}>无断点</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div>
          <div className="section-title">分段映射（{r.segments.length} 段）</div>
          <div className="pill-list">
            {r.segments.map((s) => (
              <span key={s.index} className="badge info" style={{ fontSize: 11.5 }}>
                段{s.index + 1}：{s.anchorCount} 锚点 · 系数 {s.scale.toFixed(5)} · {Number.isFinite(s.fixedStart) ? fmtMileage(s.fixedStart, false) : '?'}~{Number.isFinite(s.fixedEnd) ? fmtMileage(s.fixedEnd, false) : '?'}
              </span>
            ))}
          </div>
        </div>

        <div>
          <div className="section-title">支柱对齐残差（留一误差 / 拟合残差，单位 m）</div>
          <input className="input" placeholder="按杆号筛选，如 S016" value={poleFilter} onChange={(e) => setPoleFilter(e.target.value)} style={{ marginBottom: 8, width: 220 }} />
          <div className="table-wrap fixed-head" style={{ maxHeight: 260, border: '1px solid var(--line-soft)', borderRadius: 8 }}>
            <table className="tbl">
              <thead><tr><th>杆号</th><th className="num">档案里程</th><th className="num">CSV原始里程</th><th className="num">对齐后里程</th><th className="num">拟合残差</th><th className="num">留一误差</th><th>状态</th></tr></thead>
              <tbody>
                {filteredPoles.map((p, i) => (
                  <tr key={`${p.code}-${i}`}>
                    <td className="mono"><strong>{p.code}</strong></td>
                    <td className="num mono">{Number.isFinite(p.refMileage) ? p.refMileage.toFixed(2) : '—'}</td>
                    <td className="num mono dim">{Number.isFinite(p.rawMileage) ? p.rawMileage.toFixed(2) : '—'}</td>
                    <td className="num mono">{Number.isFinite(p.fixedMileage) ? p.fixedMileage.toFixed(2) : '—'}</td>
                    <td className="num mono" style={{ color: Math.abs(p.fitResidual) > 0.5 ? 'var(--l2)' : undefined }}>{Number.isFinite(p.fitResidual) ? p.fitResidual.toFixed(3) : '—'}</td>
                    <td className="num mono" style={{ fontWeight: 700, color: p.cvError != null && Math.abs(p.cvError) > 0.5 ? 'var(--l2)' : 'var(--ok)' }}>
                      {p.cvError != null ? p.cvError.toFixed(3) : '—'}
                    </td>
                    <td>
                      {p.status === 'matched' && <Badge kind="ok">匹配</Badge>}
                      {p.status === 'missing-in-csv' && <Badge kind="gray">CSV漏杆</Badge>}
                      {p.status === 'unknown-code' && <Badge kind="l1">未知杆号</Badge>}
                      {p.status === 'duplicate' && <Badge kind="l1">重复杆号</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
}
