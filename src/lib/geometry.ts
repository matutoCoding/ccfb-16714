import type { TrackCurve } from '../types';

// 坐标约定：x=横向（+x 为右侧），y=高程，z=纵向（里程增大方向）
// 起点 (0,0,0)，初始切线 +z

export interface FrameSample {
  mileage: number;
  x: number;
  z: number;
  /** 切线角：tangent = (sin θ, 0, cos θ) */
  theta: number;
}

const STEP = 1; // 中心线采样间距 m

/**
 * 按平曲线表拼装线路中心线，逐米积分。
 * 曲线表之外按直线处理。
 */
export function buildCenterline(curves: TrackCurve[], totalLength: number): FrameSample[] {
  const sorted = [...curves].sort((a, b) => a.startMileage - b.startMileage);
  const frames: FrameSample[] = [{ mileage: 0, x: 0, z: 0, theta: 0 }];
  let x = 0;
  let z = 0;
  let theta = 0;

  const curveAt = (m: number) =>
    sorted.find((c) => m >= c.startMileage && m < c.endMileage && Number.isFinite(c.radius));

  for (let m = STEP; m <= totalLength + 1e-6; m += STEP) {
    const c = curveAt(m - STEP / 2);
    if (c) {
      // 右转弯 θ 增大（向 +x 弯），左转弯减小
      const kappa = c.type === 'right' ? 1 / c.radius : -1 / c.radius;
      theta += kappa * STEP;
    }
    x += Math.sin(theta) * STEP;
    z += Math.cos(theta) * STEP;
    frames.push({ mileage: m, x, z, theta });
  }
  return frames;
}

export class Centerline {
  private frames: FrameSample[];
  readonly totalLength: number;

  constructor(frames: FrameSample[]) {
    this.frames = frames;
    this.totalLength = frames[frames.length - 1].mileage;
  }

  /** 取里程处的姿态（线性插值） */
  frameAt(mileage: number): { x: number; z: number; theta: number; tx: number; tz: number; nx: number; nz: number } {
    const f = this.frames;
    const m = Math.max(0, Math.min(this.totalLength, mileage));
    const i = Math.min(f.length - 2, Math.floor(m / STEP));
    const a = f[i];
    const b = f[i + 1] ?? a;
    const t = (m - a.mileage) / Math.max(1e-9, b.mileage - a.mileage);
    const theta = a.theta + (b.theta - a.theta) * t;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    return {
      x,
      z,
      theta,
      tx: Math.sin(theta),
      tz: Math.cos(theta),
      // 法向（+x 侧）：切线绕 y 转 -90°
      nx: Math.cos(theta),
      nz: -Math.sin(theta),
    };
  }

  /**
   * 里程 + 横向偏移(mm) + 导高(mm) → 世界坐标
   * @param lateralMm 拉出值，正=+x 侧
   * @param heightMm 导高（轨面以上）
   * @param vScale 导高放大
   * @param sScale 拉出放大
   */
  world(
    mileage: number,
    lateralMm = 0,
    heightMm = 0,
    vScale = 1,
    sScale = 1,
  ): [number, number, number] {
    const fr = this.frameAt(mileage);
    const lat = (lateralMm / 1000) * sScale;
    const h = (heightMm / 1000) * vScale;
    return [fr.x + fr.nx * lat, h, fr.z + fr.nz * lat];
  }

  /** 轨面中心线点 */
  railPoint(mileage: number): [number, number, number] {
    const fr = this.frameAt(mileage);
    return [fr.x, 0, fr.z];
  }
}

/** 连续里程 → K 标格式，如 K12+345.6 */
export function formatMileage(m: number): string {
  const km = Math.floor(m / 1000);
  const rest = m - km * 1000;
  return `K${km}+${rest.toFixed(1).padStart(5, '0')}`;
}

/** K 标解析为连续里程 */
export function parseMileage(text: string): number | null {
  const match = /K?\s*(\d+)\s*\+\s*(\d+(?:\.\d+)?)/i.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 1000 + Number(match[2]);
}

/** 毫米值格式化（带符号） */
export function fmtMm(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(0)}`;
}
