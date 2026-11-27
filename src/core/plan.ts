// 线路平面：由曲线半径/方向积分出中线坐标与切向/法向
// 坐标系：x 为起始里程方向，z 为左侧（θ 从 +x 向 +z 增大；左曲线 κ>0）

import type { CurveInfo, TrackId } from './types';

export interface PlanPoint {
  x: number;
  z: number;
  tx: number; // 单位切向
  tz: number;
  nx: number; // 单位法向（左侧）
  nz: number;
  theta: number;
}

export interface Plan {
  length: number;
  step: number;
  points: PlanPoint[];
  at: (mileage: number) => PlanPoint;
  /** 里程 + 横向偏移 → 世界 x,z */
  lateral: (mileage: number, offset: number) => { x: number; z: number; frame: PlanPoint };
}

export function buildPlan(curves: CurveInfo[], length: number, track?: TrackId): Plan {
  const step = 2;
  const list = curves.filter((c) => c.tracks === 'both' || (track && Array.isArray(c.tracks) && c.tracks.includes(track)));

  const curvatureAt = (s: number): number => {
    for (const c of list) {
      if (s < c.start || s > c.end) continue;
      const sign = c.direction === 'left' ? 1 : -1;
      const len = c.end - c.start;
      const tr = Math.min(120, len / 4);
      let k = sign / c.radius;
      if (s < c.start + tr) k *= (s - c.start) / tr;
      else if (s > c.end - tr) k *= (c.end - s) / tr;
      return k;
    }
    return 0;
  };

  const count = Math.floor(length / step) + 1;
  const points: PlanPoint[] = new Array(count);
  let x = 0;
  let z = 0;
  let theta = 0;
  for (let i = 0; i < count; i++) {
    const s = i * step;
    if (i > 0) {
      // 中点法积分
      const k0 = curvatureAt(s - step);
      const k1 = curvatureAt(s);
      theta += ((k0 + k1) / 2) * step;
      x += Math.cos(theta - (k1 * step) / 2) * step;
      z += Math.sin(theta - (k1 * step) / 2) * step;
    }
    const tx = Math.cos(theta);
    const tz = Math.sin(theta);
    points[i] = { x, z, tx, tz, nx: -tz, nz: tx, theta };
  }

  const at = (mileage: number): PlanPoint => {
    const s = Math.max(0, Math.min(length, mileage));
    const fi = s / step;
    const i0 = Math.floor(fi);
    const t = fi - i0;
    const p0 = points[Math.min(i0, count - 1)];
    const p1 = points[Math.min(i0 + 1, count - 1)];
    return {
      x: p0.x + (p1.x - p0.x) * t,
      z: p0.z + (p1.z - p0.z) * t,
      tx: p0.tx + (p1.tx - p0.tx) * t,
      tz: p0.tz + (p1.tz - p0.tz) * t,
      nx: p0.nx + (p1.nx - p0.nx) * t,
      nz: p0.nz + (p1.nz - p0.nz) * t,
      theta: p0.theta + (p1.theta - p0.theta) * t,
    };
  };

  const lateral: Plan['lateral'] = (mileage, offset) => {
    const f = at(mileage);
    return { x: f.x + f.nx * offset, z: f.z + f.nz * offset, frame: f };
  };

  return { length, step, points, at, lateral };
}
