// 样例线路参数（被生成器与几何模块共同引用的设计真值）
export const LINE = {
  name: '示范线',
  totalLength: 50000,
  designHeight: 6000, // 设计导高 mm
  supportSpan: 50, // 支柱跨距 m
  sampleStep: 0.5, // 检测采样间隔 m
  dropperPerSpan: 8, // 每跨吊弦数
  anchorSpanCount: 12, // 每个锚段包含跨数
}

// 曲线（米），radius 负值表示左偏
export const CURVES = [
  { trackNo: 1, start: 6200, end: 8600, radius: 1200, cant: 60 },
  { trackNo: 1, start: 18800, end: 21200, radius: -800, cant: 90 },
  { trackNo: 1, start: 33500, end: 36000, radius: 2000, cant: 40 },
  { trackNo: 2, start: 6200, end: 8600, radius: 1200, cant: 60 },
  { trackNo: 2, start: 18800, end: 21200, radius: -800, cant: 90 },
  { trackNo: 2, start: 33500, end: 36000, radius: 2000, cant: 40 },
]

// 隧道
export const TUNNELS = [
  { name: '青云山隧道', start: 11800, end: 15200 },
  { name: '石岭隧道', start: 27600, end: 30100 },
  { name: '横江隧道', start: 41200, end: 43800 },
]

// 三个月批次的漂移模型（米）：gradual 渐变 / jump 跳变型 / sine 周期型
export const DRIFT_PLANS = [
  {
    month: '2026-09',
    seed: 20260901,
    model: 'gradual',
    maxDrift: 6.5,
    breaks: [{ atMileage: 22500, restartAt: 1200 }],
  },
  {
    month: '2026-10',
    seed: 20261001,
    model: 'jump',
    maxDrift: 9,
    jumps: [
      { atMileage: 9800, offset: 4.2 },
      { atMileage: 26000, offset: -3.1 },
      { atMileage: 38500, offset: 5.4 },
    ],
    breaks: [{ atMileage: 17000, restartAt: 800 }],
  },
  {
    month: '2026-11',
    seed: 20261101,
    model: 'sine',
    maxDrift: 7,
    period: 12000,
    breaks: [{ atMileage: 31000, restartAt: 2100 }],
  },
]

// 故意注入的超限与持续变化点（真实里程，米）
// values 均为叠加在设计值上的偏移量(mm)；height 类正值=导高抬升，负值=下沉
export const DEFECTS = [
  // 连续两个月恶化的导高下沉点（定位点 S10240 附近），9 月一级、10 月二级，11 月修复
  { supportSeq: 240, metric: 'height', kind: 'sagging', months: [0, 1], fixedAfter: 2, values: [-260, -430] },
  // 持续增大的拉出偏移，三个月都在变，趋势页应高亮（设计 ±300 上叠加）
  { supportSeq: 356, metric: 'stagger', kind: 'creep', months: [0, 1, 2], values: [115, 132, 152] },
  // 10 月出现的二级导高越上限，工单处理后 11 月复测合格
  { supportSeq: 178, metric: 'height', kind: 'high', months: [1], fixedAfter: 1, values: [690] },
  // 石岭隧道内（27600~30100）导高过低，9/10 月二级、11 月处理后降为一级
  { supportSeq: 560, metric: 'height', kind: 'low', months: [0, 1, 2], values: [-330, -360, -230] },
  // 孤立二级拉出超限（设计 +300 同向叠加到 465）
  { supportSeq: 410, metric: 'stagger', kind: 'spike', months: [2], values: [165] },
]
