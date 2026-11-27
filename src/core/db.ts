// IndexedDB（Dexie）数据层：档案、批次、run 采样序列、超限、工单、设置
import Dexie, { type Table } from 'dexie';
import type {
  AnchorSection,
  CurveInfo,
  Defect,
  DetectionBatch,
  DetectionRun,
  DropperInfo,
  LineInfo,
  LocatorInfo,
  Pole,
  SeedMeta,
  Settings,
  TunnelInfo,
  WorkOrder,
  TrackId,
} from './types';
import { DEFAULT_SETTINGS } from './types';
import { generateDataset } from './seed';
import { alignRun } from './alignment';
import { judgeRun } from './judge';
import { verifyRepair } from './workorder';
import type { ParsedCsv } from './csv';
import { uid } from './format';

export class CatenaryDB extends Dexie {
  line!: Table<LineInfo, string>;
  settings!: Table<Settings, string>;
  meta!: Table<SeedMeta, string>;
  poles!: Table<Pole, string>;
  anchors!: Table<AnchorSection, string>;
  curves!: Table<CurveInfo, string>;
  tunnels!: Table<TunnelInfo, string>;
  locators!: Table<LocatorInfo, string>;
  droppers!: Table<DropperInfo, string>;
  batches!: Table<DetectionBatch, string>;
  runs!: Table<DetectionRun, string>;
  defects!: Table<Defect, string>;
  workOrders!: Table<WorkOrder, string>;

  constructor() {
    super('catenary-3d-check');
    this.version(1).stores({
      line: 'id',
      settings: 'id',
      meta: 'id',
      poles: 'id, track, mileage, code',
      anchors: 'id, track, code',
      curves: 'id',
      tunnels: 'id',
      locators: 'id, track, poleCode',
      droppers: 'id, track, mileage, spanFromPole',
      batches: 'id, date',
      runs: 'id, batchId, track',
      defects: 'id, runId, batchId, track, level, status, mileage, trendKey',
      workOrders: 'id, status, code',
    });
  }
}

export const db = new CatenaryDB();

/** 首次打开写入演示数据 */
export async function ensureSeeded(onProgress?: (msg: string) => void): Promise<boolean> {
  const meta = await db.meta.get('meta');
  if (meta?.seeded) return false;
  onProgress?.('正在生成 50km 双线线路档案…');
  // 让 loading 画面有机会渲染
  await new Promise((r) => setTimeout(r, 60));
  const data = generateDataset();
  onProgress?.('正在写入 IndexedDB（三个月检测序列 / 超限 / 工单）…');
  await db.transaction(
    'rw',
    [
      db.line,
      db.settings,
      db.meta,
      db.poles,
      db.anchors,
      db.curves,
      db.tunnels,
      db.locators,
      db.droppers,
      db.batches,
      db.runs,
      db.defects,
      db.workOrders,
    ],
    async () => {
      await db.line.put(data.line);
      await db.settings.put(data.settings);
      await db.poles.bulkPut(data.poles);
      await db.anchors.bulkPut(data.anchors);
      await db.curves.bulkPut(data.curves);
      await db.tunnels.bulkPut(data.tunnels);
      await db.locators.bulkPut(data.locators);
      await db.droppers.bulkPut(data.droppers);
      await db.batches.bulkPut(data.batches);
      await db.runs.bulkPut(data.runs);
      await db.defects.bulkPut(data.defects);
      await db.workOrders.bulkPut(data.workOrders);
      await db.meta.put({ id: 'meta', seeded: true, seededAt: Date.now(), version: 1 });
    },
  );
  return true;
}

export async function resetAllAndReseed(onProgress?: (msg: string) => void): Promise<void> {
  await db.delete();
  await db.open();
  await ensureSeeded(onProgress);
}

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('settings');
  return s ?? { ...DEFAULT_SETTINGS };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const cur = await getSettings();
  const next: Settings = { ...cur, ...patch, id: 'settings' };
  await db.settings.put(next);
  return next;
}

/** 导入解析后的 CSV：对齐 → 判定 → 落库 */
export async function importParsedCsv(args: {
  parsed: ParsedCsv;
  batchName: string;
  batchDate: string;
  track: TrackId;
  fileName: string;
  limits: Settings['limits'];
}): Promise<{ runId: string; defectCount: number; maxCvError: number; maxTrueError?: number }> {
  const { parsed, track, limits } = args;

  // 批次：按日期找/建
  let batch = await db.batches.where('date').equals(args.batchDate).first();
  if (!batch) {
    batch = {
      id: `batch-${uid('b')}`,
      name: args.batchName,
      date: args.batchDate,
      monthIndex: 99,
      source: 'csv',
      createdAt: Date.now(),
    };
    await db.batches.put(batch);
  }

  const line = (await db.line.get('line')) ?? null;
  const designHeight = line?.designHeight ?? 6000;
  const designStagger = line?.designStagger ?? 250;
  const archivePoles = await db.poles.where('track').equals(track).sortBy('mileage');
  if (!archivePoles.length) throw new Error('线路档案中还没有该线别的支柱数据，无法按杆号对齐');

  const { fixed, report } = alignRun({
    rawMileage: parsed.rawMileage,
    poleMarks: parsed.poleMarks,
    archivePoles,
    tolerance: limits.alignTolerance,
  });

  const runId = `${batch.id}__${track}__${uid('r')}`;
  const run: DetectionRun = {
    id: runId,
    batchId: batch.id,
    track,
    fileName: args.fileName,
    importedAt: Date.now(),
    pointCount: parsed.rowCount,
    rawMileage: parsed.rawMileage,
    fixedMileage: fixed,
    height: parsed.height,
    pull: parsed.pull,
    speed: parsed.speed,
    poleMarks: parsed.poleMarks,
    report,
  };

  const anchors = await db.anchors.where('track').equals(track).toArray();
  const defects = judgeRun({
    run,
    batchId: batch.id,
    track,
    limits,
    poles: archivePoles,
    anchors,
    designHeight,
    designStagger,
  });
  // 避免与已有缺陷 id 冲突（同一 runId 唯一，这里 runId 已含随机后缀）
  await db.runs.put(run);
  if (defects.length) await db.defects.bulkPut(defects);

  return { runId, defectCount: defects.length, maxCvError: report.maxCvError, maxTrueError: report.maxTrueError };
}

/** 阈值调整后重新判定全部 run */
export async function rejudgeAll(limits: Settings['limits']): Promise<number> {
  const line = await db.line.get('line');
  const designHeight = line?.designHeight ?? 6000;
  const designStagger = line?.designStagger ?? 250;
  const runs = await db.runs.toArray();
  // 事务外准备好各线别档案，避免在 defects 事务中访问未声明的表
  const ctxByTrack = {
    up: {
      poles: await db.poles.where('track').equals('up').sortBy('mileage'),
      anchors: await db.anchors.where('track').equals('up').toArray(),
    },
    down: {
      poles: await db.poles.where('track').equals('down').sortBy('mileage'),
      anchors: await db.anchors.where('track').equals('down').toArray(),
    },
  };
  const allDefects: Defect[] = [];
  for (const run of runs) {
    const ctx = ctxByTrack[run.track];
    const defects = judgeRun({
      run,
      batchId: run.batchId,
      track: run.track,
      limits,
      poles: ctx.poles,
      anchors: ctx.anchors,
      designHeight,
      designStagger,
    });
    allDefects.push(...defects);
  }
  await db.transaction('rw', db.defects, async () => {
    await db.defects.clear();
    if (allDefects.length) await db.defects.bulkPut(allDefects);
  });
  return allDefects.length;
}

/** 从缺陷创建工单 */
export async function createWorkOrder(args: {
  defectIds: string[];
  assignee: string;
  plannedDate?: string;
  title?: string;
}): Promise<string> {
  const defects = await db.defects.bulkGet(args.defectIds);
  const list = defects.filter(Boolean) as Defect[];
  if (!list.length) throw new Error('未选择超限点');
  const first = list.sort((a, b) => a.mileage - b.mileage)[0];
  const maxLevel = list.some((d) => d.level === 2) ? 2 : 1;
  const count = await db.workOrders.count();
  const wo: WorkOrder = {
    id: uid('wo'),
    code: `GD-2026-${String(2000 + count + 1)}`,
    defectIds: args.defectIds,
    track: first.track,
    mileage: first.mileage,
    poleCode: first.poleCode,
    anchorCode: first.anchorCode,
    title: args.title ?? `${first.track === 'up' ? '上行' : '下行'} ${first.poleCode ?? ''} ${first.metric === 'height' ? '导高' : '拉出值'}超限整治（${list.length} 处）`,
    assignee: args.assignee || '接触网工区',
    priority: maxLevel as 1 | 2,
    status: 'created',
    createdAt: Date.now(),
    plannedDate: args.plannedDate,
  };
  await db.workOrders.put(wo);
  await db.defects.where('id').anyOf(args.defectIds).modify((d: Defect) => {
    d.status = 'ordered';
    d.workOrderId = wo.id;
  });
  return wo.id;
}

/** 保存处理结果（status=done），并立即用之后的检测 run 复核 */
export async function completeWorkOrder(
  woId: string,
  patch: { measure: string; result: string; assignee?: string },
): Promise<WorkOrder | undefined> {
  const wo = await db.workOrders.get(woId);
  if (!wo) return;
  const finishedAt = Date.now();
  const updated: WorkOrder = {
    ...wo,
    ...patch,
    status: 'done',
    finishedAt,
  };
  await db.workOrders.put(updated);
  for (const did of wo.defectIds) {
    await db.defects.update(did, { status: 'resolved' });
  }
  await verifyWorkOrder(woId);
  return db.workOrders.get(woId);
}

/** 用最新可用检测数据核对工单 */
export async function verifyWorkOrder(woId: string): Promise<WorkOrder | undefined> {
  const wo = await db.workOrders.get(woId);
  if (!wo) return;
  const settings = await getSettings();
  const line = await db.line.get('line');
  const runs = await db.runs.toArray();
  const batches = await db.batches.toArray();
  const dateOf = (batchId: string) => batches.find((b) => b.id === batchId)?.date;

  // 以工单第一个缺陷的指标/里程为核对基准
  const defect = (await db.defects.get(wo.defectIds[0])) ?? null;
  const metric = defect?.metric ?? 'height';
  const beforeValue = defect ? Math.abs(defect.deviation) : settings.limits[metric === 'height' ? 'heightLevel1' : 'pullLevel1'];

  const v = verifyRepair({
    track: wo.track,
    mileage: wo.mileage,
    metric,
    beforeValue,
    finishedAt: wo.finishedAt ?? wo.createdAt,
    runs,
    batchDateOf: dateOf,
    settings: settings.limits,
    designHeight: line?.designHeight ?? 6000,
    designStagger: line?.designStagger ?? 250,
  });

  if (v) {
    wo.verification = v;
    await db.workOrders.put(wo);
    // 复核通过 → 关联缺陷标记 verified
    if (v.passed) {
      for (const did of wo.defectIds) {
        await db.defects.update(did, { status: 'verified' });
      }
    }
  }
  return wo;
}
