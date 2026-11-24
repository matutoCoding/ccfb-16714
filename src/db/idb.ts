// IndexedDB 封装：批次、采样点、超限、工单、线路档案、设置

import type {
  AppSettings,
  ExceedPoint,
  InspectionBatch,
  InspectionSample,
  LineArchive,
  WorkOrder,
} from '@/types'
import { DEFAULT_SETTINGS } from '@/types'

const DB_NAME = 'ocws_db'
const DB_VERSION = 1

const STORES = {
  settings: 'settings',
  archive: 'archive',
  batches: 'batches',
  samples: 'samples',
  exceeds: 'exceeds',
  workOrders: 'workOrders',
} as const

let dbPromise: Promise<IDBDatabase> | null = null

const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings)
      }
      if (!db.objectStoreNames.contains(STORES.archive)) {
        db.createObjectStore(STORES.archive)
      }
      if (!db.objectStoreNames.contains(STORES.batches)) {
        const s = db.createObjectStore(STORES.batches, { keyPath: 'id' })
        s.createIndex('inspectDate', 'inspectDate')
        s.createIndex('trackNo', 'trackNo')
      }
      if (!db.objectStoreNames.contains(STORES.samples)) {
        const s = db.createObjectStore(STORES.samples, { keyPath: 'batchId' })
        s.createIndex('batchId', 'batchId')
      }
      if (!db.objectStoreNames.contains(STORES.exceeds)) {
        const s = db.createObjectStore(STORES.exceeds, { keyPath: 'id' })
        s.createIndex('batchId', 'batchId')
        s.createIndex('status', 'status')
      }
      if (!db.objectStoreNames.contains(STORES.workOrders)) {
        const s = db.createObjectStore(STORES.workOrders, { keyPath: 'id' })
        s.createIndex('exceedId', 'exceedId')
        s.createIndex('status', 'status')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

const tx = async <T>(
  names: (keyof typeof STORES)[],
  mode: IDBTransactionMode,
  fn: (stores: IDBObjectStore[]) => IDBRequest<T>,
): Promise<T> => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(names.map((n) => STORES[n]), mode)
    const stores = names.map((n) => t.objectStore(STORES[n]))
    const req = fn(stores)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// 采样点整体作为一条记录存储（每批次约 10 万点，单记录约 5MB，IDB 可承受）
export const saveSamples = async (samples: InspectionSample[]): Promise<void> => {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORES.samples, 'readwrite')
    t.objectStore(STORES.samples).put({ batchId: samples[0].batchId, points: samples })
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
  })
}

export const loadSamples = async (batchId: string): Promise<InspectionSample[]> => {
  const row = await tx(['samples'], 'readonly', (s) => s[0].get(batchId) as IDBRequest<{
    points: InspectionSample[]
  } | undefined>)
  return row?.points ?? []
}

export const putBatch = (batch: InspectionBatch) =>
  tx(['batches'], 'readwrite', (s) => s[0].put(batch) as IDBRequest<IDBValidKey>)

export const getAllBatches = (): Promise<InspectionBatch[]> =>
  tx(['batches'], 'readonly', (s) => s[0].getAll() as IDBRequest<InspectionBatch[]>)

export const deleteBatch = async (batchId: string): Promise<void> => {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(
      [STORES.batches, STORES.samples, STORES.exceeds],
      'readwrite',
    )
    t.objectStore(STORES.batches).delete(batchId)
    t.objectStore(STORES.samples).delete(batchId)
    const idx = t.objectStore(STORES.exceeds).index('batchId')
    const cursorReq = idx.openCursor(IDBKeyRange.only(batchId))
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result
      if (cursor) {
        cursor.delete()
        cursor.continue()
      }
    }
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
  })
}

export const putExceeds = async (list: ExceedPoint[]): Promise<void> => {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORES.exceeds, 'readwrite')
    const store = t.objectStore(STORES.exceeds)
    for (const item of list) store.put(item)
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
  })
}

export const getExceedsByBatch = (batchId: string): Promise<ExceedPoint[]> =>
  tx(['exceeds'], 'readonly', (s) =>
    s[0].index('batchId').getAll(batchId) as IDBRequest<ExceedPoint[]>)

export const getAllExceeds = (): Promise<ExceedPoint[]> =>
  tx(['exceeds'], 'readonly', (s) => s[0].getAll() as IDBRequest<ExceedPoint[]>)

export const updateExceed = (item: ExceedPoint): Promise<IDBValidKey> =>
  tx(['exceeds'], 'readwrite', (s) => s[0].put(item) as IDBRequest<IDBValidKey>)

export const putWorkOrder = (order: WorkOrder): Promise<IDBValidKey> =>
  tx(['workOrders'], 'readwrite', (s) => s[0].put(order) as IDBRequest<IDBValidKey>)

export const getAllWorkOrders = (): Promise<WorkOrder[]> =>
  tx(['workOrders'], 'readonly', (s) => s[0].getAll() as IDBRequest<WorkOrder[]>)

export const saveArchive = (archive: LineArchive): Promise<IDBValidKey> =>
  tx(['archive'], 'readwrite', (s) =>
    s[0].put(archive, 'current') as IDBRequest<IDBValidKey>)

export const loadArchive = async (): Promise<LineArchive | null> => {
  const row = await tx(['archive'], 'readonly', (s) =>
    s[0].get('current') as IDBRequest<LineArchive | undefined>)
  return row ?? null
}

export const loadSettings = async (): Promise<AppSettings> => {
  const row = await tx(['settings'], 'readonly', (s) =>
    s[0].get('app') as IDBRequest<AppSettings | undefined>)
  return row ?? DEFAULT_SETTINGS
}

export const saveSettings = (settings: AppSettings): Promise<IDBValidKey> =>
  tx(['settings'], 'readwrite', (s) =>
    s[0].put(settings, 'app') as IDBRequest<IDBValidKey>)

export const clearAll = async (): Promise<void> => {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(Object.values(STORES), 'readwrite')
    for (const name of Object.values(STORES)) t.objectStore(name).clear()
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
  })
}
