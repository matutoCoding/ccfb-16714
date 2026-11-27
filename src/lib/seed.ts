import { alignInspection, resampleOnGrid } from './alignment';
import { buildLineProfile } from './lineGenerator';
import { generateBatch } from './inspectionGenerator';
import { detectExceeds } from './exceed';
import { db, STORES } from './db';
import { store } from './store';
import type { Direction, ExceedPoint } from '../types';

export interface SeedProgress {
  phase: string;
  current: number;
  total: number;
}

const PERSIST_STEP = 1; // 落库里程网格 m（检测原始 0.25m，三维/图表无需该密度）

/** 生成并导入全部演示数据（浏览器端，逐批次处理以控制内存峰值） */
export async function seedDemoData(onProgress?: (p: SeedProgress) => void): Promise<void> {
  const directions: Direction[] = ['up', 'down'];
  const total = 1 + 6 + 1;
  let current = 0;
  const tick = (phase: string) => {
    current += 1;
    onProgress?.({ phase, current, total });
  };

  tick('生成 50km 双线线路档案（曲线/隧道/锚段/支柱/吊弦）');
  const profile = buildLineProfile();
  await db.put(STORES.profiles, profile);

  const allExceeds: ExceedPoint[] = [];
  for (const direction of directions) {
    for (let month = 0; month < 3; month++) {
      tick(`生成并对齐：${direction === 'up' ? '上行' : '下行'} 第 ${month + 1} 批次`);
      // 单批次生成 → 对齐 → 超限判定（全分辨率内存数据）→ 重采样落库，随即释放
      const g = generateBatch(profile, direction, month, 20260901);
      const aligned = alignInspection(g.rows, profile, direction, g.batch.id);
      g.batch.alignSummary = aligned.summary;
      g.batch.mileageIssues = aligned.issues;
      g.batch.importedAt = Date.now();

      const result = detectExceeds(aligned.samples, g.batch, profile, store.state.settings.limits);
      allExceeds.push(...result.points);

      // 落库重采样到 1m 网格：记录数降为 1/4，断点区间保持留空
      const gridSamples = resampleOnGrid(aligned.samples, PERSIST_STEP, profile.totalLength);
      g.batch.sampleStep = PERSIST_STEP;
      g.batch.sampleCount = gridSamples.length;
      await store.persistBatch(g.batch, gridSamples);
    }
  }

  tick('超限点入库并刷新状态');
  await store.persistExceeds(allExceeds);
  store.update({ profile });
  await store.setSeeded();
}
