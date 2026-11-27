import type {
  ExceedPoint,
  InspectionBatch,
  InspectionSample,
  LineProfile,
  WorkOrder,
} from '../types';
import { DEFAULT_LIMITS } from './exceed';
import type { AppSettings, DbMeta } from '../types';

const DB_NAME = 'occs-review-db';
const DB_VERSION = 1;

export const STORES = {
  meta: 'meta',
  profiles: 'profiles',
  batches: 'batches',
  samples: 'samples', // keyPath: 复合 batchId+mileage，索引 batchId
  exceeds: 'exceeds',
  workOrders: 'workOrders',
} as const;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.meta)) db.createObjectStore(STORES.meta, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.profiles)) db.createObjectStore(STORES.profiles, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.batches)) db.createObjectStore(STORES.batches, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.samples)) {
        const st = db.createObjectStore(STORES.samples, { keyPath: ['batchId', 'mileage'] });
        st.createIndex('batchId', 'batchId');
        st.createIndex('mileage', 'mileage');
      }
      if (!db.objectStoreNames.contains(STORES.exceeds)) {
        const st = db.createObjectStore(STORES.exceeds, { keyPath: 'id' });
        st.createIndex('batchId', 'batchId');
        st.createIndex('nearestPoleId', 'nearestPoleId');
      }
      if (!db.objectStoreNames.contains(STORES.workOrders)) {
        const st = db.createObjectStore(STORES.workOrders, { keyPath: 'id' });
        st.createIndex('exceedId', 'exceedId');
        st.createIndex('batchId', 'batchId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | IDBRequest<T>[],
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        const req = fn(s);
        t.oncomplete = () => resolve((req as IDBRequest<T>).result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const db = {
  async get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
    return tx<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
  },

  async getAll<T>(store: string): Promise<T[]> {
    return tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
  },

  async put<T>(store: string, value: T): Promise<IDBValidKey> {
    return tx<IDBValidKey>(store, 'readwrite', (s) => s.put(value) as IDBRequest<IDBValidKey>);
  },

  async bulkPut<T>(store: string, values: T[]): Promise<void> {
    // 每个分块使用独立事务并 await 提交。
    // 注意：不能在单个事务里用 setTimeout 分批——事务会在事件循环空档自动提交，
    // 定时器回调里的 put 将落到已关闭事务。
    const database = await openDb();
    const CHUNK = 3000;
    for (let start = 0; start < values.length; start += CHUNK) {
      const chunk = values.slice(start, start + CHUNK);
      await new Promise<void>((resolve, reject) => {
        const t = database.transaction(store, 'readwrite');
        const s = t.objectStore(store);
        for (const v of chunk) s.put(v);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    }
  },

  async delete(store: string, key: IDBValidKey): Promise<void> {
    await tx(store, 'readwrite', (s) => s.delete(key));
  },

  async clear(store: string): Promise<void> {
    await tx(store, 'readwrite', (s) => s.clear());
  },

  async getAllByIndex<T>(store: string, indexName: string, value: IDBValidKey): Promise<T[]> {
    const database = await openDb();
    return new Promise((resolve, reject) => {
      const t = database.transaction(store, 'readonly');
      const req = t.objectStore(store).index(indexName).getAll(value);
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error);
    });
  },

  async count(store: string): Promise<number> {
    const database = await openDb();
    return new Promise((resolve, reject) => {
      const t = database.transaction(store, 'readonly');
      const req = t.objectStore(store).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
};

export const DEFAULT_SETTINGS: AppSettings = {
  limits: DEFAULT_LIMITS,
  verticalExaggeration: 8,
  staggerExaggeration: 6,
  replaySpeeds: [5, 15, 30, 60, 120],
  trendColors: ['#4f9cf9', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6'],
};

export async function loadMeta(): Promise<DbMeta> {
  const meta = await db.get<DbMeta>(STORES.meta, 'meta');
  if (meta) return meta;
  const fresh: DbMeta = { id: 'meta', seeded: false, settings: DEFAULT_SETTINGS };
  await db.put(STORES.meta, fresh);
  return fresh;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const meta = await loadMeta();
  meta.settings = settings;
  await db.put(STORES.meta, meta);
}

// 便捷类型重导出
export type { LineProfile, InspectionBatch, InspectionSample, ExceedPoint, WorkOrder };
