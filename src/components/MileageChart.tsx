import { useEffect, useRef, useState, useCallback } from 'react';
import type { Defect, DetectionRun, LimitSettings } from '../core/types';
import { fmtMileage } from '../core/format';

interface Props {
  run: DetectionRun | null;
  defects: Defect[];
  mileage: number;
  limits: LimitSettings;
  designHeight: number;
  totalLength: number;
  onSeek: (m: number) => void;
  onDefectClick?: (id: string) => void;
}

const PAD_L = 52;
const PAD_R = 14;
const PAD_T = 18;
const PANEL_H = 78;
const GAP = 30;

export default function MileageChart(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(1000);
  const [hover, setHover] = useState<{ x: number; m: number } | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const ro = new ResizeObserver(() => {
      if (wrapRef.current) setWidth(wrapRef.current.clientWidth);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const xToM = useCallback((x: number) => {
    const w = width;
    const pw = w - PAD_L - PAD_R;
    const t = Math.max(0, Math.min(1, (x - PAD_L) / pw));
    return t * props.totalLength;
  }, [width, props.totalLength]);

  const eventM = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return xToM(e.clientX - rect.left);
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = width;
    const h = PAD_T * 2 + PANEL_H * 2 + GAP + 8;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    const pw = w - PAD_L - PAD_R;
    const X = (m: number) => PAD_L + (m / props.totalLength) * pw;

    drawPanel({
      ctx, top: PAD_T, h: PANEL_H, color: '#2563eb', label: '导高 mm',
      valueRange: [props.designHeight - 130, props.designHeight + 130],
      thresholds: [
        { v: props.designHeight + props.limits.heightLevel2, c: '#fca5a5' },
        { v: props.designHeight + props.limits.heightLevel1, c: '#fcd34d' },
        { v: props.designHeight, c: '#86efac' },
        { v: props.designHeight - props.limits.heightLevel1, c: '#fcd34d' },
        { v: props.designHeight - props.limits.heightLevel2, c: '#fca5a5' },
      ],
      run: props.run, metric: 'height', X, pw, total: props.totalLength,
    });

    const top2 = PAD_T + PANEL_H + GAP;
    drawPanel({
      ctx, top: top2, h: PANEL_H, color: '#7c3aed', label: '拉出值 mm',
      valueRange: [-520, 520],
      thresholds: [
        { v: props.limits.pullLevel2, c: '#fca5a5' },
        { v: props.limits.pullLevel1, c: '#fcd34d' },
        { v: 0, c: '#86efac' },
        { v: -props.limits.pullLevel1, c: '#fcd34d' },
        { v: -props.limits.pullLevel2, c: '#fca5a5' },
      ],
      run: props.run, metric: 'pull', X, pw, total: props.totalLength,
    });

    // 里程刻度
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px Consolas, sans-serif';
    ctx.textAlign = 'center';
    const stepKm = props.totalLength > 30000 ? 5000 : 2000;
    for (let m = 0; m <= props.totalLength; m += stepKm) {
      const x = X(m);
      ctx.strokeStyle = '#eef2f7';
      ctx.beginPath();
      ctx.moveTo(x, PAD_T);
      ctx.lineTo(x, top2 + PANEL_H);
      ctx.stroke();
      ctx.fillText(`K${m / 1000}`, x, top2 + PANEL_H + 16);
    }

    // 超限点
    for (const d of props.defects) {
      const x = X(d.mileage);
      const c = d.level === 2 ? '#dc2626' : '#f59e0b';
      const top = d.metric === 'height' ? PAD_T : top2;
      ctx.fillStyle = c;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, top - 2);
      ctx.lineTo(x - 5, top - 11);
      ctx.lineTo(x + 5, top - 11);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // 播放头
    const px = X(props.mileage);
    ctx.strokeStyle = '#0ea5e9';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(px, 6);
    ctx.lineTo(px, top2 + PANEL_H + 4);
    ctx.stroke();
    ctx.fillStyle = '#0ea5e9';
    ctx.beginPath();
    ctx.moveTo(px - 5, 6);
    ctx.lineTo(px + 5, 6);
    ctx.lineTo(px, 13);
    ctx.closePath();
    ctx.fill();

    // hover
    if (hover) {
      const hx = X(hover.m);
      ctx.strokeStyle = 'rgba(15,31,56,.35)';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(hx, 6);
      ctx.lineTo(hx, top2 + PANEL_H + 4);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [width, hover, props.run, props.defects, props.mileage, props.limits, props.designHeight, props.totalLength]);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <div ref={wrapRef} style={{ width: '100%', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', display: 'block', borderRadius: 6 }}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          props.onSeek(eventM(e));
        }}
        onPointerMove={(e) => {
          const m = eventM(e);
          const rect = canvasRef.current!.getBoundingClientRect();
          setHover({ x: e.clientX - rect.left, m });
          if (dragging.current) props.onSeek(m);
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerLeave={() => {
          setHover(null);
          dragging.current = false;
        }}
      />
      {hover && (
        <div
          style={{
            position: 'absolute', top: 2, left: Math.min(hover.x + 12, width - 130),
            background: 'rgba(14,31,60,.92)', color: '#dbeafe', fontSize: 11,
            padding: '3px 9px', borderRadius: 6, pointerEvents: 'none', whiteSpace: 'nowrap',
          }}
        >
          {fmtMileage(hover.m)}
        </div>
      )}
    </div>
  );
}

// ---------------- 面板绘制（按像素包络抽稀） ----------------

function drawPanel(args: {
  ctx: CanvasRenderingContext2D;
  top: number;
  h: number;
  color: string;
  label: string;
  valueRange: [number, number];
  thresholds: Array<{ v: number; c: string }>;
  run: DetectionRun | null;
  metric: 'height' | 'pull';
  X: (m: number) => number;
  pw: number;
  total: number;
}) {
  const { ctx, top, h, color, label, valueRange, thresholds, run, metric, X, pw, total } = args;
  const L = 52;
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = '#dbe3ee';
  roundRectPath(ctx, L, top, pw, h, 7);
  ctx.fill();
  ctx.stroke();

  const [vmin, vmax] = valueRange;
  const Y = (v: number) => top + 8 + (1 - (v - vmin) / (vmax - vmin)) * (h - 16);

  // 阈值线
  for (const t of thresholds) {
    if (t.v < vmin || t.v > vmax) continue;
    ctx.strokeStyle = t.c;
    ctx.lineWidth = 1;
    ctx.setLineDash(t.v === 0 || t.v === 6000 ? [] : [5, 4]);
    ctx.beginPath();
    ctx.moveTo(L, Y(t.v));
    ctx.lineTo(L + pw, Y(t.v));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 曲线（像素列 min/max 包络）
  if (run && run.pointCount > 1) {
    const cols = Math.floor(pw);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    let started = false;
    for (let c = 0; c <= cols; c++) {
      const m0 = (c / cols) * total;
      const m1 = ((c + 1) / cols) * total;
      let lo = metric === 'height' ? Infinity : Infinity;
      let hi = -Infinity;
      // 二分起点
      const arr = run.fixedMileage;
      let i = lowerBound(arr, m0);
      for (; i < run.pointCount && arr[i] <= m1; i++) {
        const v = metric === 'height' ? run.height[i] : run.pull[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (!Number.isFinite(lo)) continue;
      const x = L + c;
      const yLo = Y(Math.max(vmin, Math.min(vmax, lo)));
      const yHi = Y(Math.max(vmin, Math.min(vmax, hi)));
      if (!started) {
        ctx.moveTo(x, yHi);
        started = true;
      }
      ctx.moveTo(x, yHi);
      ctx.lineTo(x, yLo);
    }
    ctx.stroke();
  }

  // 标签
  ctx.fillStyle = '#334155';
  ctx.font = 'bold 11px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(label, L + 8, top + 15);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px Consolas';
  ctx.textAlign = 'right';
  ctx.fillText(String(vmax), L - 6, top + 12);
  ctx.fillText(String(vmin), L - 6, top + h - 4);
}

function lowerBound(arr: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
