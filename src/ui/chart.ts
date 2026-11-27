import { h } from './dom';
import { formatMileage } from '../lib/geometry';

export interface ChartSeries {
  name: string;
  color: string;
  points: Array<{ x: number; y: number }>;
  dashed?: boolean;
  width?: number;
}

export interface ChartMarker {
  x: number;
  color: string;
  label?: string;
  data?: unknown;
}

export interface ChartOptions {
  height?: number;
  yLabel?: string;
  xLabel?: string;
  yUnit?: string;
  markers?: ChartMarker[];
  onMarkerClick?: (m: ChartMarker) => void;
  onCursor?: (x: number | null) => void;
  xFormat?: (x: number) => string;
  yRefs?: Array<{ y: number; color: string; label?: string }>;
  fillZero?: boolean;
}

/** 轻量二维折线图（支持 DPR、缩放窗口、标记点击） */
export class LineChart {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private series: ChartSeries[] = [];
  private opts: ChartOptions;
  private viewFrom: number | null = null;
  private viewTo: number | null = null;
  private markerRects: Array<{ mx: number; m: ChartMarker }> = [];
  private ro: ResizeObserver;

  constructor(series: ChartSeries[], opts: ChartOptions = {}) {
    this.opts = opts;
    this.series = series;
    this.canvas = h('canvas', { class: 'chart' }) as HTMLCanvasElement;
    this.canvas.style.height = `${opts.height ?? 240}px`;
    this.ctx = this.canvas.getContext('2d')!;
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(this.canvas);
    this.canvas.addEventListener('click', (e) => this.handleClick(e));
    this.canvas.addEventListener('mousemove', (e) => this.handleMove(e));
    this.canvas.addEventListener('mouseleave', () => this.opts.onCursor?.(null));
    requestAnimationFrame(() => this.draw());
  }

  setSeries(series: ChartSeries[]) {
    this.series = series;
    this.draw();
  }

  setMarkers(markers: ChartMarker[]) {
    this.opts.markers = markers;
    this.draw();
  }

  /** 缩放 x 视图窗口 */
  setWindow(from: number | null, to: number | null) {
    this.viewFrom = from;
    this.viewTo = to;
    this.draw();
  }

  get element() {
    return this.canvas;
  }

  destroy() {
    this.ro.disconnect();
  }

  private xRange(): [number, number] {
    if (this.viewFrom !== null && this.viewTo !== null) return [this.viewFrom, this.viewTo];
    let min = Infinity;
    let max = -Infinity;
    for (const s of this.series) for (const p of s.points) {
      if (p.x < min) min = p.x;
      if (p.x > max) max = p.x;
    }
    if (!Number.isFinite(min)) return [0, 1];
    return [min, max];
  }

  private yRange(x0: number, x1: number): [number, number] {
    let min = Infinity;
    let max = -Infinity;
    for (const s of this.series) {
      for (const p of s.points) {
        if (p.x < x0 || p.x > x1) continue;
        if (p.y < min) min = p.y;
        if (p.y > max) max = p.y;
      }
    }
    for (const r of this.opts.yRefs ?? []) {
      min = Math.min(min, r.y);
      max = Math.max(max, r.y);
    }
    if (!Number.isFinite(min)) return [0, 1];
    const pad = Math.max(2, (max - min) * 0.08);
    return [min - pad, max + pad];
  }

  private draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0) return;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const padL = 56;
    const padR = 14;
    const padT = 14;
    const padB = 34;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const [x0, x1] = this.xRange();
    const [y0, y1] = this.yRange(x0, x1);
    const sx = (x: number) => padL + ((x - x0) / Math.max(1e-9, x1 - x0)) * plotW;
    const sy = (y: number) => padT + (1 - (y - y0) / Math.max(1e-9, y1 - y0)) * plotH;

    // 网格 + 轴刻度
    ctx.strokeStyle = 'rgba(148,163,184,0.14)';
    ctx.fillStyle = '#64748b';
    ctx.font = '11px Consolas, monospace';
    ctx.lineWidth = 1;
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
      const yv = y0 + ((y1 - y0) * i) / yTicks;
      const yy = sy(yv);
      ctx.beginPath();
      ctx.moveTo(padL, yy);
      ctx.lineTo(w - padR, yy);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(`${yv.toFixed(0)}`, padL - 7, yy + 3);
    }
    const xTicks = Math.min(10, Math.max(2, Math.floor(plotW / 110)));
    ctx.textAlign = 'center';
    for (let i = 0; i <= xTicks; i++) {
      const xv = x0 + ((x1 - x0) * i) / xTicks;
      const xx = sx(xv);
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(148,163,184,0.08)';
      ctx.moveTo(xx, padT);
      ctx.lineTo(xx, padT + plotH);
      ctx.stroke();
      ctx.fillStyle = '#64748b';
      ctx.fillText(this.opts.xFormat ? this.opts.xFormat(xv) : formatMileage(xv), xx, h - 12);
    }

    // 参考线（限界）
    for (const r of this.opts.yRefs ?? []) {
      ctx.strokeStyle = r.color;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      const yy = sy(r.y);
      ctx.moveTo(padL, yy);
      ctx.lineTo(w - padR, yy);
      ctx.stroke();
      ctx.setLineDash([]);
      if (r.label) {
        ctx.fillStyle = r.color;
        ctx.textAlign = 'left';
        ctx.fillText(r.label, padL + 4, yy - 4);
      }
    }

    // 数据线（窗口外裁剪，降采样到像素密度）
    ctx.save();
    ctx.beginPath();
    ctx.rect(padL, padT, plotW, plotH);
    ctx.clip();
    for (const s of this.series) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width ?? 1.6;
      ctx.setLineDash(s.dashed ? [6, 5] : []);
      ctx.beginPath();
      let prevPx = -1;
      let started = false;
      for (const p of s.points) {
        if (p.x < x0 || p.x > x1) continue;
        const px = sx(p.x);
        if (px - prevPx < 0.6 && started) continue; // 降采样
        prevPx = px;
        const py = sy(p.y);
        if (!started) {
          ctx.moveTo(px, py);
          started = true;
        } else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // 标记点（超限）
    this.markerRects = [];
    for (const m of this.opts.markers ?? []) {
      if (m.x < x0 || m.x > x1) continue;
      const mx = sx(m.x);
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.moveTo(mx, padT);
      ctx.lineTo(mx + 5, padT + 9);
      ctx.lineTo(mx - 5, padT + 9);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(mx - 1, padT, 2, plotH);
      this.markerRects.push({ mx, m });
    }
    ctx.restore();

    // 轴单位
    if (this.opts.yUnit) {
      ctx.fillStyle = '#64748b';
      ctx.textAlign = 'left';
      ctx.fillText(this.opts.yUnit, 6, padT + 2);
    }
  }

  private handleClick(e: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let best: { mx: number; m: ChartMarker } | null = null;
    let bestD = 9;
    for (const mr of this.markerRects) {
      const d = Math.abs(mr.mx - x);
      if (d < bestD) {
        bestD = d;
        best = mr;
      }
    }
    if (best && this.opts.onMarkerClick) this.opts.onMarkerClick(best.m);
  }

  private handleMove(e: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    if (!this.opts.onCursor) return;
    const padL = 56;
    const plotW = this.canvas.clientWidth - padL - 14;
    const [x0, x1] = this.xRange();
    const xv = x0 + ((e.clientX - rect.left - padL) / plotW) * (x1 - x0);
    if (xv < x0 || xv > x1) this.opts.onCursor(null);
    else this.opts.onCursor(xv);
  }
}

/** 绘制图例 */
export function legend(series: ChartSeries[]): HTMLElement {
  return h('div', { class: 'legend' }, [
    ...series.map((s) =>
      h('span', {}, [h('span', { class: 'dot', style: `background:${s.color}` }), s.name]),
    ),
  ]);
}
