import type {
  AppSettings,
  ExceedPoint,
  InspectionBatch,
  InspectionSample,
  LineProfile,
  WorkOrder,
} from '../types';
import { db, loadMeta, STORES } from './db';

export interface AppState {
  ready: boolean;
  seeded: boolean;
  profile: LineProfile | null;
  batches: InspectionBatch[];
  exceeds: ExceedPoint[];
  workOrders: WorkOrder[];
  settings: AppSettings;
  /** 采样缓存：batchId -> samples（对齐后） */
  sampleCache: Map<string, InspectionSample[]>;
}

type Listener = (state: AppState) => void;

class Store {
  state: AppState = {
    ready: false,
    seeded: false,
    profile: null,
    batches: [],
    exceeds: [],
    workOrders: [],
    settings: {
      limits: { heightWarn: 50, heightSerious: 100, staggerWarn: 400, staggerSerious: 450, adjacentHeightDiff: 50 },
      verticalExaggeration: 8,
      staggerExaggeration: 6,
      replaySpeeds: [5, 15, 30, 60, 120],
      trendColors: ['#4f9cf9', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6'],
    },
    sampleCache: new Map(),
  };

  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn(this.state);
  }

  /** 浅更新并通知 */
  update(patch: Partial<AppState>) {
    Object.assign(this.state, patch);
    this.emit();
  }

  async init() {
    const meta = await loadMeta();
    const profile = await db.get<LineProfile>(STORES.profiles, 'L-DEMO');
    const batches = await db.getAll<InspectionBatch>(STORES.batches);
    const exceeds = await db.getAll<ExceedPoint>(STORES.exceeds);
    const workOrders = await db.getAll<WorkOrder>(STORES.workOrders);
    this.update({
      ready: true,
      seeded: meta.seeded,
      profile: profile ?? null,
      batches: batches.sort((a, b) => a.inspectDate.localeCompare(b.inspectDate)),
      exceeds,
      workOrders,
      settings: meta.settings,
    });
  }

  async loadSamples(batchId: string): Promise<InspectionSample[]> {
    const cached = this.state.sampleCache.get(batchId);
    if (cached) return cached;
    const rows = await db.getAllByIndex<InspectionSample>(STORES.samples, 'batchId', batchId);
    rows.sort((a, b) => a.mileage - b.mileage);
    this.state.sampleCache.set(batchId, rows);
    return rows;
  }

  /** 加载某方向全部批次的采样（趋势对比用），可限制里程范围 */
  async loadSamplesRange(batchId: string, from: number, to: number): Promise<InspectionSample[]> {
    const all = await this.loadSamples(batchId);
    return all.filter((s) => s.mileage >= from && s.mileage <= to);
  }

  async persistBatch(batch: InspectionBatch, samples: InspectionSample[]) {
    await db.put(STORES.batches, batch);
    await db.bulkPut(STORES.samples, samples);
    this.state.sampleCache.set(batch.id, samples);
    const batches = [...this.state.batches.filter((b) => b.id !== batch.id), batch].sort((a, b) =>
      a.inspectDate.localeCompare(b.inspectDate),
    );
    this.update({ batches });
  }

  async persistExceeds(points: ExceedPoint[]) {
    await db.bulkPut(STORES.exceeds, points);
    const all = await db.getAll<ExceedPoint>(STORES.exceeds);
    this.update({ exceeds: all });
  }

  async updateExceed(point: ExceedPoint) {
    await db.put(STORES.exceeds, point);
    const exceeds = this.state.exceeds.map((p) => (p.id === point.id ? point : p));
    this.update({ exceeds });
  }

  async putWorkOrder(order: WorkOrder) {
    await db.put(STORES.workOrders, order);
    const workOrders = [...this.state.workOrders.filter((o) => o.id !== order.id), order];
    this.update({ workOrders });
  }

  async saveSettings(settings: AppSettings) {
    const { saveSettings } = await import('./db');
    await saveSettings(settings);
    this.update({ settings });
  }

  async setSeeded() {
    const meta = await loadMeta();
    meta.seeded = true;
    meta.seededAt = Date.now();
    await db.put(STORES.meta, meta);
    this.update({ seeded: true });
  }

  async resetAll() {
    for (const s of [STORES.batches, STORES.samples, STORES.exceeds, STORES.workOrders, STORES.profiles]) {
      await db.clear(s);
    }
    this.state.sampleCache.clear();
    const meta = await loadMeta();
    meta.seeded = false;
    delete meta.seededAt;
    await db.put(STORES.meta, meta);
    this.update({ seeded: false, profile: null, batches: [], exceeds: [], workOrders: [] });
  }
}

export const store = new Store();
