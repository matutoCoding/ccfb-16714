import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../core/db';
import { sampleRunAt } from '../three/CatenaryScene';
import { Badge, Empty } from '../components/ui';
import { useUi } from '../state/ui';
import { fmtMileage } from '../core/format';
import type { MetricType, Pole, TrackId } from '../core/types';

const MONTH_COLORS = ['#38bdf8', '#7c3aed', '#dc2626'];

interface TrendRow {
  pole: Pole;
  values: [number, number, number];
  delta: number;
  monotonic: boolean;
  worsening: boolean;
}

export default function TrendsPage() {
  const batches = useLiveQuery(() => db.batches.orderBy('date').toArray());
  const runs = useLiveQuery(() => db.runs.toArray());
  const polesAll = useLiveQuery(() => db.poles.toArray());
  const anchorsAll = useLiveQuery(() => db.anchors.toArray());
  const line = useLiveQuery(() => db.line.get('line'));
  const limits = useLiveQuery(() => db.settings.get('settings'));
  const gotoReplay = useUi((s) => s.gotoReplay);

  const [track, setTrack] = useState<TrackId>('up');
  const [metric, setMetric] = useState<MetricType>('pull');
  const [anchorCode, setAnchorCode] = useState<string>('');

  const months = useMemo(() => [...(batches ?? [])].sort((a, b) => a.date.localeCompare(b.date)), [batches]);
  const trackPoles = useMemo(() => (polesAll ?? []).filter((p) => p.track === track).sort((a, b) => a.mileage - b.mileage), [polesAll, track]);
  const trackAnchors = useMemo(() => (anchorsAll ?? []).filter((a) => a.track === track).sort((a, b) => a.fromMileage - b.fromMileage), [anchorsAll, track]);

  const runs3 = useMemo(
    () => months.map((b) => runs?.find((r) => r.batchId === b.id && r.track === track) ?? null),
    [months, runs, track],
  );

  // 持续变化定位点排行
  const rows: TrendRow[] = useMemo(() => {
    if (!line || runs3.every((r) => !r)) return [];
    const out: TrendRow[] = [];
    for (const p of trackPoles) {
      const vals = runs3.map((r) => {
        if (!r) return null;
        const s = sampleRunAt(r, p.mileage);
        return metric === 'height' ? s.height - line.designHeight : s.pull;
      }) as Array<number | null>;
      if (vals.some((v) => v == null || !Number.isFinite(v))) continue;
      const v = vals as [number, number, number];
      const delta = v[2] - v[0];
      const monotonic = (v[1] - v[0]) * (v[2] - v[1]) >= -1e-6 && Math.sign(v[1] - v[0]) === Math.sign(delta || 1);
      // 恶化方向：高度偏差绝对值增大；拉出值绝对值增大
      const absGrow = Math.abs(v[2]) - Math.abs(v[0]);
      out.push({ pole: p, values: v, delta, monotonic, worsening: absGrow > 12 });
    }
    return out
      .filter((r) => r.monotonic && r.worsening && Math.abs(r.delta) >= (metric === 'pull' ? 20 : 12))
      .sort((a, b) => Math.abs(b.values[2]) - Math.abs(b.values[0]) - (Math.abs(a.values[2]) - Math.abs(a.values[0])))
      .slice(0, 14);
  }, [trackPoles, runs3, line, metric]);

  const activeAnchor = useMemo(() => {
    if (anchorCode) return trackAnchors.find((a) => a.code === anchorCode) ?? trackAnchors[0];
    // 默认包含第一个趋势点的锚段，否则第一个
    const firstTrend = rows[0];
    if (firstTrend) return trackAnchors.find((a) => firstTrend.pole.mileage >= a.fromMileage && firstTrend.pole.mileage <= a.toMileage) ?? trackAnchors[0];
    return trackAnchors[0];
  }, [anchorCode, trackAnchors, rows]);

  if (!line || !limits) return null;

  return (
    <div className="grid" style={{ gridTemplateColumns: '340px 1fr', alignItems: 'start' }}>
      {/* 左：持续变化定位点 */}
      <div className="card">
        <div className="card-hd">
          <h3>持续变化定位点</h3>
        </div>
        <div className="card-bd" style={{ borderBottom: '1px solid var(--line-soft)' }}>
          <div className="row">
            <div className="seg">
              <button className={track === 'up' ? 'active' : ''} onClick={() => setTrack('up')}>上行</button>
              <button className={track === 'down' ? 'active' : ''} onClick={() => setTrack('down')}>下行</button>
            </div>
            <div className="seg">
              <button className={metric === 'pull' ? 'active' : ''} onClick={() => setMetric('pull')}>拉出值</button>
              <button className={metric === 'height' ? 'active' : ''} onClick={() => setMetric('height')}>导高偏差</button>
            </div>
          </div>
          <p className="dim" style={{ fontSize: 12, margin: '10px 0 0' }}>
            按支柱/定位点提取三个月测值，筛选连续两月同向且偏差绝对值持续增大的点，按恶化量排序。
          </p>
        </div>
        <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 330px)' }}>
          {rows.length === 0 && <Empty icon="📈" text="未识别到持续变化点" />}
          {rows.map((r, i) => {
            const anchor = trackAnchors.find((a) => r.pole.mileage >= a.fromMileage && r.pole.mileage <= a.toMileage);
            return (
              <div
                key={r.pole.id}
                onClick={() => {
                  setAnchorCode(anchor?.code ?? '');
                  gotoReplay({ track, mileage: r.pole.mileage });
                }}
                style={{ padding: '10px 16px', borderBottom: '1px solid var(--line-soft)', cursor: 'pointer' }}
                className="trend-row"
              >
                <div className="row">
                  <span style={{
                    width: 22, height: 22, borderRadius: 6, background: i < 3 ? 'var(--l2-bg)' : '#eef2f7',
                    color: i < 3 ? 'var(--l2)' : 'var(--text-2)', fontWeight: 800, fontSize: 12,
                    display: 'grid', placeItems: 'center',
                  }}>{i + 1}</span>
                  <strong className="mono">{r.pole.code}</strong>
                  <span className="dim mono" style={{ fontSize: 11.5 }}>{fmtMileage(r.pole.mileage)}</span>
                  <span className="spacer" />
                  <Badge kind={Math.abs(r.values[2]) >= (metric === 'pull' ? limits.limits.pullLevel1 : limits.limits.heightLevel1) ? 'l2' : 'l1'}>
                    {metric === 'pull' ? `${r.values[2].toFixed(0)}` : `${r.values[2] > 0 ? '+' : ''}${r.values[2].toFixed(0)}`}
                  </Badge>
                </div>
                <div className="row" style={{ marginTop: 6, gap: 8 }}>
                  <Sparkline values={r.values} />
                  <span className="mono dim" style={{ fontSize: 11 }}>
                    {r.values.map((v) => (metric === 'height' ? `${v > 0 ? '+' : ''}${v.toFixed(0)}` : v.toFixed(0))).join(' → ')} mm
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--l2)', fontWeight: 700 }}>
                    恶化 +{(Math.abs(r.values[2]) - Math.abs(r.values[0])).toFixed(0)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 右：锚段多月叠加 */}
      <div className="card">
        <div className="card-hd">
          <h3>同区段多月叠加</h3>
          <select className="input" style={{ width: 200 }} value={activeAnchor?.code ?? ''} onChange={(e) => setAnchorCode(e.target.value)}>
            {trackAnchors.map((a) => <option key={a.id} value={a.code}>{a.code} · {fmtMileage(a.fromMileage, false)}~{fmtMileage(a.toMileage, false)}</option>)}
          </select>
          <span className="spacer" />
          {activeAnchor && (
            <button className="btn sm primary" onClick={() => gotoReplay({ track, mileage: (activeAnchor.fromMileage + activeAnchor.toMileage) / 2 })}>
              🛰 三维查看本锚段
            </button>
          )}
        </div>
        <div className="card-bd">
          <div className="trend-legend" style={{ marginBottom: 8 }}>
            {months.map((b, i) => (
              <span className="li" key={b.id}><i className="sw" style={{ background: MONTH_COLORS[i] }} />{b.name}（{b.date}）</span>
            ))}
            <span className="li"><i className="sw" style={{ background: '#dc2626', height: 0, borderTop: '2px dashed #dc2626' }} />二级限界</span>
            <span className="li"><i className="sw" style={{ background: '#f59e0b', height: 0, borderTop: '2px dashed #f59e0b' }} />一级限界</span>
          </div>
          {activeAnchor && runs3.some(Boolean) ? (
            <TrendSvg
              anchorFrom={activeAnchor.fromMileage}
              anchorTo={activeAnchor.toMileage}
              runs={runs3}
              colors={MONTH_COLORS}
              metric={metric}
              designHeight={line.designHeight}
              limits={limits.limits}
              poles={trackPoles}
            />
          ) : (
            <Empty text="暂无趋势数据" />
          )}
        </div>
      </div>
    </div>
  );
}

function Sparkline({ values }: { values: [number, number, number] }) {
  const w = 74;
  const h = 22;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / 2) * w + 2},${h - 3 - ((v - min) / span) * (h - 6)}`).join(' ');
  return (
    <svg width={w} height={h}>
      <polyline points={pts} fill="none" stroke="#1d6fe0" strokeWidth={1.8} />
      {values.map((v, i) => (
        <circle key={i} cx={(i / 2) * w + 2} cy={h - 3 - ((v - min) / span) * (h - 6)} r={2.4} fill={MONTH_COLORS[i]} />
      ))}
    </svg>
  );
}

function TrendSvg(props: {
  anchorFrom: number;
  anchorTo: number;
  runs: Array<ReturnType<typeof useLiveQuery<unknown>> | any>;
  colors: string[];
  metric: MetricType;
  designHeight: number;
  limits: { heightLevel1: number; heightLevel2: number; pullLevel1: number; pullLevel2: number };
  poles: Pole[];
}) {
  const W = 1040;
  const H = 380;
  const ML = 56;
  const MR = 20;
  const MT = 16;
  const MB = 40;
  const PW = W - ML - MR;
  const PH = H - MT - MB;
  const m0 = props.anchorFrom - 2;
  const m1 = props.anchorTo + 2;
  const X = (m: number) => ML + ((m - m0) / (m1 - m0)) * PW;

  // 计算所有序列点与值域
  const series = props.runs.map((run) => {
    if (!run) return null;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < run.pointCount; i++) {
      const m = run.fixedMileage[i];
      if (m < m0 || m > m1) continue;
      const v = props.metric === 'height' ? run.height[i] - props.designHeight : run.pull[i];
      pts.push([m, v]);
    }
    return pts;
  });

  let vmin = Infinity;
  let vmax = -Infinity;
  for (const s of series) for (const [, v] of s ?? []) {
    if (v < vmin) vmin = v;
    if (v > vmax) vmax = v;
  }
  if (!Number.isFinite(vmin)) {
    vmin = props.metric === 'height' ? -120 : -520;
    vmax = props.metric === 'height' ? 120 : 520;
  }
  // 纳入阈值
  const th = props.metric === 'height'
    ? [props.limits.heightLevel2, props.limits.heightLevel1, -props.limits.heightLevel1, -props.limits.heightLevel2, 0]
    : [props.limits.pullLevel2, props.limits.pullLevel1, -props.limits.pullLevel1, -props.limits.pullLevel2, 0];
  for (const t of th) { vmin = Math.min(vmin, t); vmax = Math.max(vmax, t); }
  const pad = (vmax - vmin) * 0.08;
  vmin -= pad;
  vmax += pad;
  const Y = (v: number) => MT + (1 - (v - vmin) / (vmax - vmin)) * PH;

  const yTicks = 5;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => vmin + ((vmax - vmin) * i) / yTicks);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      <rect x={ML} y={MT} width={PW} height={PH} fill="#f8fafc" stroke="#dbe3ee" rx={8} />
      {tickVals.map((v, i) => (
        <g key={i}>
          <line x1={ML} x2={ML + PW} y1={Y(v)} y2={Y(v)} stroke="#e8eef6" />
          <text x={ML - 8} y={Y(v) + 3.5} textAnchor="end" fontSize={10.5} fill="#8296b0" className="mono">{v.toFixed(0)}</text>
        </g>
      ))}
      {/* 阈值 */}
      {th.map((v, i) => {
        const isZero = v === 0;
        const color = Math.abs(v) === (props.metric === 'height' ? props.limits.heightLevel2 : props.limits.pullLevel2) ? '#dc2626' : isZero ? '#16a34a' : '#f59e0b';
        return (
          <line key={i} x1={ML} x2={ML + PW} y1={Y(v)} y2={Y(v)} stroke={color} strokeWidth={1.2}
            strokeDasharray={isZero ? undefined : '6 4'} opacity={0.75} />
        );
      })}
      {/* 月份曲线 */}
      {series.map((pts, si) => {
        if (!pts || pts.length < 2) return null;
        // 抽稀到 ~1200 点
        const stride = Math.max(1, Math.floor(pts.length / 1200));
        let d = '';
        pts.forEach(([m, v], i) => {
          if (i % stride !== 0 && i !== pts.length - 1) return;
          d += `${d ? 'L' : 'M'}${X(m).toFixed(1)},${Y(v).toFixed(1)} `;
        });
        return <path key={si} d={d} fill="none" stroke={props.colors[si]} strokeWidth={si === 2 ? 2.2 : 1.5} opacity={si === 2 ? 1 : 0.85} />;
      })}
      {/* 支柱（标签抽稀，避免重叠） */}
      {(() => {
        const ps = props.poles.filter((p) => p.mileage >= m0 && p.mileage <= m1);
        const step = Math.max(1, Math.ceil(ps.length / 13));
        return ps.map((p, pi) => (
          <g key={p.id}>
            <line x1={X(p.mileage)} x2={X(p.mileage)} y1={MT} y2={MT + PH} stroke="#0f172a" strokeOpacity={0.18} />
            {pi % step === 0 && (
              <text x={X(p.mileage)} y={MT + PH + 16} textAnchor="middle" fontSize={10} fill="#48607e" fontWeight={700}>{p.code}</text>
            )}
          </g>
        ));
      })()}
      {/* x 里程 */}
      <text x={ML} y={H - 6} fontSize={11} fill="#8296b0">{fmtMileage(m0 + 2)}</text>
      <text x={ML + PW} y={H - 6} textAnchor="end" fontSize={11} fill="#8296b0">{fmtMileage(m1 - 2)}</text>
      <text x={14} y={MT + 10} fontSize={11} fill="#48607e" fontWeight={700}>
        {props.metric === 'height' ? '导高偏差 mm（相对 6000）' : '拉出值 mm'}
      </text>
    </svg>
  );
}
