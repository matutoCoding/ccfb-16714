// 全局应用状态（轻量 reactive，无需 pinia）
import { reactive } from 'vue'
import type {
  AppSettings,
  ExceedPoint,
  InspectionBatch,
  LineArchive,
  WorkOrder,
} from '@/types'
import { DEFAULT_SETTINGS } from '@/types'
import {
  clearAll,
  getAllBatches,
  getAllExceeds,
  getAllWorkOrders,
  loadArchive,
  loadSettings,
  saveSettings,
} from '@/db/idb'

interface AppState {
  ready: boolean
  archive: LineArchive | null
  batches: InspectionBatch[]
  exceeds: ExceedPoint[]
  workOrders: WorkOrder[]
  settings: AppSettings
  selectedBatchId: string | null
  focusMileage: number | null // 跨页面跳转定位（三维/里程图）
}

export const state = reactive<AppState>({
  ready: false,
  archive: null,
  batches: [],
  exceeds: [],
  workOrders: [],
  settings: DEFAULT_SETTINGS,
  selectedBatchId: null,
  focusMileage: null,
})

export const refreshAll = async (): Promise<void> => {
  const [archive, batches, exceeds, workOrders, settings] = await Promise.all([
    loadArchive(),
    getAllBatches(),
    getAllExceeds(),
    getAllWorkOrders(),
    loadSettings(),
  ])
  state.archive = archive
  state.batches = batches.sort((a, b) => a.inspectDate.localeCompare(b.inspectDate))
  state.exceeds = exceeds.sort((a, b) => a.maxMileage - b.maxMileage)
  state.workOrders = workOrders.sort((a, b) => b.createdAt - a.createdAt)
  state.settings = settings
  if (state.selectedBatchId && !batches.some((b) => b.id === state.selectedBatchId)) {
    state.selectedBatchId = null
  }
  if (!state.selectedBatchId && batches.length > 0) {
    state.selectedBatchId = batches[0].id
  }
  state.ready = true
}

export const updateSettings = async (settings: AppSettings): Promise<void> => {
  await saveSettings(settings)
  state.settings = settings
}

export const resetAllData = async (): Promise<void> => {
  await clearAll()
  state.archive = null
  state.batches = []
  state.exceeds = []
  state.workOrders = []
  state.selectedBatchId = null
  state.settings = DEFAULT_SETTINGS
}

export const selectBatch = (batchId: string): void => {
  state.selectedBatchId = batchId
}

// 跨页面定位：跳到三维回放并聚焦某里程
export const focusMileageInReplay = (batchId: string, mileage: number): void => {
  state.selectedBatchId = batchId
  state.focusMileage = mileage
  window.location.hash = '#/replay'
}
