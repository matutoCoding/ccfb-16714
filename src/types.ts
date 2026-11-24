// 接触网几何检测系统 - 领域模型定义

// 线路基础结构 -------------------------------------------------

export interface Support {
  id: string
  supportCode: string // 杆号，如 S10001
  mileage: number // 里程(米)，全线统一坐标
  trackNo: 1 | 2 // 上下行
  anchorSectionId: string
  hasLocators: LocatorInfo[] // 定位器（每根支柱 1 个，道岔区可多个）
}

export interface LocatorInfo {
  wireSide: 'left' | 'right' // 定位侧
  designStagger: number // 设计拉出值(毫米，带正负)
}

export interface AnchorSection {
  id: string
  name: string // 锚段编号
  trackNo: 1 | 2
  startMileage: number
  endMileage: number
  startSupportCode: string
  endSupportCode: string
  tensionLength: number // 锚段长度(米)
}

export interface CurveSegment {
  id: string
  trackNo: 1 | 2
  startMileage: number
  endMileage: number
  radius: number // 曲线半径(米)，负值表示左偏
  designCant: number // 设计超高(毫米)
}

export interface Tunnel {
  id: string
  name: string
  startMileage: number
  endMileage: number
  trackNos: (1 | 2)[]
}

export interface DropperSpec {
  spanStartSupportId: string
  positionsInSpan: number[] // 跨内相对起点的位置(米)
}

export interface LineArchive {
  lineName: string
  totalLength: number
  designHeight: number // 设计导高(毫米)
  generatedAt: string
  supports: Support[]
  anchorSections: AnchorSection[]
  curves: CurveSegment[]
  tunnels: Tunnel[]
  droppers: DropperSpec[]
}

// 检测批次与采样 -------------------------------------------------

export type TrackNo = 1 | 2

export interface RawCsvRow {
  seq: number
  rawMileage: number
  heightMm: number
  staggerMm: number
  event?: string // POLE / BREAK / 空
  supportCode?: string
}

export interface AlignmentEvent {
  rowIndex: number
  type: 'pole' | 'break' | 'jump'
  rawMileage: number
  supportCode?: string
  archiveMileage?: number // 杆号匹配到的档案里程
  offsetBefore?: number // 事件前漂移量(米)
  offsetAfter?: number // 事件后漂移量(米)
  gapSize?: number // 断点缺口(米)
}

export interface AlignmentReport {
  batchId: string
  totalRows: number
  poleCount: number
  breakCount: number
  jumpCount: number
  matchedPoles: number
  unmatchedPoles: string[]
  maxResidualM: number // 对齐后杆位与档案的最大偏差(米)
  meanResidualM: number
  residuals: { supportCode: string; archiveM: number; alignedM: number; residualM: number }[]
  events: AlignmentEvent[]
  pass05m: boolean // 是否满足 <0.5m 精度要求
}

export type LimitLevel = 1 | 2

export interface ExceedPoint {
  id: string
  batchId: string
  trackNo: TrackNo
  startMileage: number
  endMileage: number
  maxMileage: number
  metric: 'height' | 'stagger'
  level: LimitLevel
  maxValue: number
  limitValue: number
  nearestSupportCode: string
  workOrderId?: string
  status: 'open' | 'ordered' | 'verified' | 'ignored'
  createdAt: string
}

export interface InspectionBatch {
  id: string
  name: string
  inspectDate: string // YYYY-MM
  trackNo: TrackNo
  importedAt: number
  sampleCount: number
  rawStartMileage: number
  rawEndMileage: number
  alignedStartMileage: number
  alignedEndMileage: number
  driftMaxM: number
  driftModel: string
  alignmentReport: AlignmentReport
  exceedCounts: { level1: number; level2: number }
  verifiedFixed: number
}

// 采样点（对齐后），批量存 IndexedDB
export interface InspectionSample {
  batchId: string
  mileage: number // 对齐后里程
  heightMm: number
  staggerMm: number
  event: 0 | 1 | 2 // 0 普通 1 过杆 2 断点
  supportCode?: string
}

// 工单 ---------------------------------------------------------

export type WorkOrderStatus = 'pending' | 'processing' | 'done' | 'verified'

export interface WorkOrder {
  id: string
  exceedId: string
  batchId: string
  trackNo: TrackNo
  mileage: number
  supportCode: string
  metric: 'height' | 'stagger'
  level: LimitLevel
  description: string
  status: WorkOrderStatus
  createdAt: number
  handledAt?: number
  handleResult?: string
  verifiedBatchId?: string
  verifiedAt?: number
  verifyNote?: string
}

// 设置 ---------------------------------------------------------

export interface LimitThresholds {
  heightUpperL1: number
  heightUpperL2: number
  heightLowerL1: number
  heightLowerL2: number
  staggerAbsL1: number
  staggerAbsL2: number
}

export interface AppSettings {
  limits: LimitThresholds
  exaggerationHeight: number // 导高放大倍数（三维）
  exaggerationStagger: number // 拉出放大倍数
  playbackSpeed: number // 回放速度 m/s
}

export const DEFAULT_SETTINGS: AppSettings = {
  limits: {
    heightUpperL1: 6500,
    heightUpperL2: 6650,
    heightLowerL1: 5700,
    heightLowerL2: 5500,
    staggerAbsL1: 400,
    staggerAbsL2: 450,
  },
  exaggerationHeight: 20,
  exaggerationStagger: 12,
  playbackSpeed: 15,
}
