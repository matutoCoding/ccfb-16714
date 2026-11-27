// ============ 领域类型定义 ============

/** 线路方向（双线） */
export type Direction = 'up' | 'down';

/** 曲线类型 */
export type CurveType = 'straight' | 'left' | 'right';

/** 锚段 */
export interface AnchorSection {
  id: string;
  lineId: string;
  direction: Direction;
  index: number;
  startMileage: number; // 连续里程 m
  endMileage: number;
  name: string; // 如 K12+000~K14+200
}

/** 曲线（平曲线，含缓和曲线按圆弧+直线过渡简化） */
export interface TrackCurve {
  id: string;
  lineId: string;
  direction: Direction;
  startMileage: number;
  endMileage: number;
  radius: number; // m，直线为 Infinity
  type: CurveType;
}

/** 隧道 */
export interface Tunnel {
  id: string;
  lineId: string;
  startMileage: number;
  endMileage: number;
  name: string;
}

/** 支柱（线路档案） */
export interface Pole {
  id: string;
  lineId: string;
  direction: Direction;
  poleNo: string; // 杆号，如 128#
  mileage: number; // 设计连续里程 m
  anchorId: string;
  /** 定位器处设计拉出值 mm（正负表示方向） */
  designStagger: number;
  /** 定位器处设计导高 mm */
  designHeight: number;
  hasRegistrator: boolean; // 是否有定位器（锚段关节/道岔处可能无）
}

/** 吊弦 */
export interface Dropper {
  id: string;
  poleFromId: string;
  mileage: number;
  /** 相对承力索的设计长度 mm */
  length: number;
}

/** 线路档案 */
export interface LineProfile {
  id: string;
  name: string;
  code: string;
  totalLength: number; // m
  designHeight: number; // 标准导高 mm
  designStagger: number; // 标准拉出值绝对值 mm
  spanNominal: number; // 标称跨距 m
  poles: Pole[];
  droppers: Dropper[];
  anchors: AnchorSection[];
  curves: TrackCurve[];
  tunnels: Tunnel[];
}

/** 检测批次 */
export interface InspectionBatch {
  id: string;
  name: string;
  lineId: string;
  direction: Direction;
  inspectDate: string; // ISO 日期
  importedAt: number;
  sampleStep: number; // 采样间距 m
  sampleCount: number;
  /** 导入时识别出的里程问题（漂移/断点/跳变） */
  mileageIssues: MileageIssue[];
  /** 对齐质量汇总 */
  alignSummary?: AlignSummary;
  note?: string;
}

/** 里程问题 */
export interface MileageIssue {
  kind: 'drift' | 'jump' | 'gap';
  rawStartMileage: number;
  rawEndMileage: number;
  correctedOffset: number; // 应用的修正量 m（raw + offset = corrected）
  detail: string;
}

export interface AlignSummary {
  /** 对齐后检测定位点与档案支柱的里程偏差（绝对值，m） */
  poleResiduals: { poleId: string; poleNo: string; residual: number }[];
  maxResidual: number;
  meanResidual: number;
  rmsResidual: number;
  within05: number; // 偏差 < 0.5m 的点数
  total: number;
}

/** 检测采样点（对齐后的规整数据，按里程升序） */
export interface InspectionSample {
  batchId: string;
  mileage: number; // 对齐后连续里程 m
  rawMileage: number; // 检测车原始里程 m
  contactHeight: number; // 导高 mm
  stagger: number; // 拉出值 mm（之字形，含正负）
  /** 就近支柱 id（用于定位点级趋势） */
  nearestPoleId: string;
  inTunnel: boolean;
  /** 跳变/断点过渡带内的采样，里程对齐置信度低，超限判定降权 */
  lowConfidence?: boolean;
}

/** 超限等级 */
export type ExceedLevel = 1 | 2; // 一级（警示）/ 二级（严重）
export type ExceedMetric = 'height' | 'stagger';

/** 超限点 */
export interface ExceedPoint {
  id: string;
  batchId: string;
  lineId: string;
  direction: Direction;
  mileage: number;
  nearestPoleId: string;
  metric: ExceedMetric;
  level: ExceedLevel;
  value: number; // 实测值 mm
  limit: number; // 限界 mm
  design: number; // 设计值 mm
  deviation: number; // 相对设计偏差 mm
  handled: boolean;
  workOrderId?: string;
}

/** 维修工单 */
export interface WorkOrder {
  id: string;
  exceedId: string;
  batchId: string;
  createdAt: number;
  mileage: number;
  poleNo: string;
  metric: ExceedMetric;
  description: string;
  status: 'open' | 'processing' | 'done';
  handler?: string;
  result?: string;
  handledAt?: number;
  /** 下次检测复核结果 */
  recheck?: { batchId: string; value: number; deviation: number; passed: boolean; at: number };
}

/** 限界配置 */
export interface LimitConfig {
  // 导高限界（相对设计值偏差，mm）
  heightWarn: number; // 一级
  heightSerious: number; // 二级
  // 拉出值限界（绝对值，mm）
  staggerWarn: number;
  staggerSerious: number;
  // 相邻定位点导高差（mm）
  adjacentHeightDiff: number;
}

/** 应用设置 */
export interface AppSettings {
  limits: LimitConfig;
  /** 三维中导高/拉出的放大系数 */
  verticalExaggeration: number;
  staggerExaggeration: number;
  /** 回放速度 m/s 的档位 */
  replaySpeeds: number[];
  /** 趋势对比颜色（按批次） */
  trendColors: string[];
}

/** 数据库元信息 */
export interface DbMeta {
  id: 'meta';
  seeded: boolean;
  seededAt?: number;
  settings: AppSettings;
}

/** CSV 解析后的原始检测行 */
export interface RawCsvRow {
  rawMileage: number;
  poleNo: string; // 可能为空
  contactHeight: number;
  stagger: number;
  inTunnel: boolean;
}
