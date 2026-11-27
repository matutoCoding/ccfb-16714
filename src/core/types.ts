// ============================================================
// 接触网几何检测回放与三维核查系统 —— 领域类型定义
// ============================================================

export type TrackId = 'up' | 'down'; // 上行 / 下行

export const TRACK_LABEL: Record<TrackId, string> = {
  up: '上行',
  down: '下行',
};

/** 线路基础档案（单行记录） */
export interface LineInfo {
  id: 'line';
  name: string; // 线路名称
  code: string; // 线路代码
  totalLength: number; // 正线长度 m（双线分别同里程）
  designHeight: number; // 设计导高 mm
  designStagger: number; // 标准之字值幅值 mm
  trackSpacing: number; // 线间距 m
  spanNominal: number; // 标称跨距 m
  updatedAt: number;
}

/** 支柱 */
export interface Pole {
  id: string;
  track: TrackId;
  code: string; // 杆号，如 S0123 / X0123
  mileage: number; // 档案里程（权威值）m
  side: 'left' | 'right'; // 支柱位于线路哪一侧
  anchorCode?: string; // 所属锚段编号
  spanNext?: number; // 与后一支柱的跨距 m（最后一个为空）
}

/** 锚段 */
export interface AnchorSection {
  id: string;
  track: TrackId;
  code: string; // 锚段号
  fromPoleCode: string;
  toPoleCode: string;
  fromMileage: number;
  toMileage: number;
  spanCount: number;
  length: number;
  tensionKN?: number; // 补偿张力 kN
}

/** 曲线 */
export interface CurveInfo {
  id: string;
  code: string;
  start: number; // 起点里程 m
  end: number; // 终点里程 m
  radius: number; // 曲线半径 m
  direction: 'left' | 'right'; // 曲线方向
  tracks: TrackId[] | 'both';
}

/** 隧道 */
export interface TunnelInfo {
  id: string;
  name: string;
  start: number;
  end: number;
}

/** 定位器 */
export interface LocatorInfo {
  id: string;
  track: TrackId;
  poleCode: string;
  mileage: number;
  type: string; // 定位器类型
  designStagger: number; // 设计拉出值 mm（带符号）
}

/** 吊弦 */
export interface DropperInfo {
  id: string;
  track: TrackId;
  anchorCode?: string;
  spanFromPole: string; // 该吊弦所在跨距的前一杆号
  mileage: number;
  indexInSpan: number; // 跨内第几根
}

// ---------------- 检测批次 / 数据 ----------------

export interface DetectionBatch {
  id: string;
  name: string; // 如 2026年8月月度检测
  date: string; // YYYY-MM-DD
  monthIndex: number; // 演示数据月份序号 0/1/2
  source: 'seed' | 'csv';
  note?: string;
  createdAt: number;
}

/** CSV 中识别到的过杆标记 */
export interface PoleMark {
  rowIndex: number;
  code: string;
  rawMileage: number; // CSV 原始（漂移）里程
}

export interface JumpEvent {
  kind: 'jump';
  id: string;
  afterRow: number; // 跳变发生在该采样序号之后
  betweenPoles?: [string, string];
  rawDelta: number; // 两杆间原始里程增量
  refDelta: number; // 档案跨距
  discrepancy: number; // 差值（跳变量估计）m
  splitRawMileage: number; // 跳变点原始里程
  accepted: boolean; // 是否纳入分段修正
}

export interface BreakEvent {
  kind: 'break';
  id: string;
  rowIndex: number;
  rawFrom: number;
  rawTo: number;
  rawGap: number; // 原始里程缺口
  refGapEstimate?: number;
  reason: 'data-gap' | 'non-monotonic' | 'mileage-reset';
  note: string;
}

export type AlignmentEvent = JumpEvent | BreakEvent;

export interface SegmentStat {
  index: number;
  rowStart: number;
  rowEnd: number;
  anchorCount: number;
  rawStart: number;
  rawEnd: number;
  fixedStart: number;
  fixedEnd: number;
  scale: number; // 局部里程系数
}

export interface PoleAlignResult {
  code: string;
  refMileage: number;
  rawMileage: number;
  fixedMileage: number;
  fitResidual: number; // 采用该锚点后的拟合残差（≈0）
  cvError: number | null; // 留一交叉验证误差 m
  status: 'matched' | 'unknown-code' | 'missing-in-csv' | 'duplicate';
}

export interface AlignReport {
  alignedAt: number;
  archivePoleCount: number;
  matchedPoleCount: number;
  unknownCodeCount: number;
  usedAnchorCount: number;
  maxCvError: number; // 最大留一误差 m
  rmsCvError: number;
  maxTrueError?: number; // 仅演示种子数据有真值时填写
  tolerance: number; // 要求 <0.5m
  pass: boolean;
  segments: SegmentStat[];
  jumps: JumpEvent[];
  breaks: BreakEvent[];
  poleResults: PoleAlignResult[];
  manualOffset: number;
  manualScale: number;
}

/** 一次检测运行 = 某批次 × 某行别，含全部采样序列 */
export interface DetectionRun {
  id: string; // `${batchId}__${track}`
  batchId: string;
  track: TrackId;
  fileName?: string;
  importedAt: number;
  pointCount: number;
  rawMileage: Float64Array;
  fixedMileage: Float64Array;
  height: Float32Array; // 导高 mm
  pull: Float32Array; // 拉出值 mm（带符号，正=曲外/右）
  speed: Float32Array; // km/h
  poleMarks: PoleMark[];
  report: AlignReport;
  /** 种子数据真值（不展示给业务，仅用于精度自检） */
  truthMileage?: Float64Array;
}

// ---------------- 超限 / 工单 ----------------

export type MetricType = 'height' | 'pull';
export type DefectLevel = 1 | 2;
export type DefectStatus = 'open' | 'ordered' | 'processing' | 'resolved' | 'verified';

export interface Defect {
  id: string;
  runId: string;
  batchId: string;
  track: TrackId;
  metric: MetricType;
  level: DefectLevel;
  mileage: number; // 峰值里程（修正后）
  startMileage: number;
  endMileage: number;
  length: number;
  value: number; // 峰值（导高 mm 或 |拉出值| mm）
  signedValue: number;
  deviation: number; // 相对设计/基准的偏差
  limitUsed: number;
  poleCode?: string;
  anchorCode?: string;
  status: DefectStatus;
  workOrderId?: string;
  firstSeenBatchId?: string; // 趋势追踪用：首次出现月份
  trendKey?: string; // 同一位置/定位点的归并键
}

export interface WorkOrder {
  id: string;
  code: string; // 工单号
  defectIds: string[];
  track: TrackId;
  mileage: number;
  poleCode?: string;
  anchorCode?: string;
  title: string;
  assignee: string; // 工区/负责人
  priority: DefectLevel;
  status: 'created' | 'processing' | 'done';
  createdAt: number;
  plannedDate?: string;
  measure?: string; // 处理措施
  result?: string; // 处理结果
  finishedAt?: number;
  /** 下次检测核对结果 */
  verification?: {
    runId: string;
    batchId: string;
    checkedAt: number;
    passed: boolean;
    beforeValue: number;
    afterValue: number;
    reductionPct: number;
    note: string;
  };
}

// ---------------- 设置 ----------------

export interface LimitSettings {
  heightLevel1: number; // 导高偏差一级阈值 mm
  heightLevel2: number;
  pullLevel1: number; // 拉出值绝对值一级阈值 mm
  pullLevel2: number;
  alignTolerance: number; // 对齐精度承诺 m
  verifyWindow: number; // 工单复核里程窗口 m
  verifyReductionPct: number; // 下降百分比达到此值视为修好
}

export interface Settings {
  id: 'settings';
  limits: LimitSettings;
  verticalExaggeration: number;
  lateralExaggeration: number;
  followCamera: boolean;
  showDesignWire: boolean;
  showMessenger: boolean;
  showDroppers: boolean;
  showLabels: boolean;
}

export const DEFAULT_LIMITS: LimitSettings = {
  heightLevel1: 40,
  heightLevel2: 80,
  pullLevel1: 400,
  pullLevel2: 470,
  alignTolerance: 0.5,
  verifyWindow: 12,
  verifyReductionPct: 60,
};

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  limits: { ...DEFAULT_LIMITS },
  verticalExaggeration: 10,
  lateralExaggeration: 6,
  followCamera: true,
  showDesignWire: true,
  showMessenger: true,
  showDroppers: true,
  showLabels: true,
};

export interface SeedMeta {
  id: 'meta';
  seeded: boolean;
  seededAt?: number;
  version: number;
}
