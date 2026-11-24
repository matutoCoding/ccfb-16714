// 按漂移模型生成单股道单月的检测 CSV 行
// 真值里程 -> 叠加缺陷/噪声 -> 反推带漂移的原始里程（含断点重计、跳变）
import { LINE, DEFECTS } from './line_config.mjs'

const supportCode = (trackNo, seq) => `S${trackNo}${String(seq).padStart(4, '0')}`

// 缺陷在该里程处对测量值的影响
const defectInfluence = (defectsAtSupport, mileage, metric) => {
  let delta = 0
  for (const d of defectsAtSupport) {
    if (d.metric !== metric) continue
    const supportM = d.supportSeq * LINE.supportSpan
    const dist = Math.abs(mileage - supportM)
    if (dist > 45) continue // 影响半径 45m，近平台余弦衰减，保证定位点处取满值
    const w = dist < 15 ? 1 : 0.5 * (1 + Math.cos(((dist - 15) / 30) * Math.PI))
    delta += d.activeValue * w
  }
  return delta
}

const driftAt = (plan, trueMileage, rowIndex, rand) => {
  const t = trueMileage / LINE.totalLength
  if (plan.model === 'gradual') {
    return plan.maxDrift * t
  }
  if (plan.model === 'sine') {
    return plan.maxDrift * 0.5 * Math.sin((trueMileage / plan.period) * Math.PI * 2)
  }
  // jump：分段恒定偏移 + 缓慢累积
  let offset = plan.maxDrift * 0.25 * t
  for (const j of plan.jumps ?? []) {
    if (trueMileage >= j.atMileage) offset += j.offset
  }
  return offset + (rand() - 0.5) * 0.15
}

export const buildTrackCsv = (archive, trackNo, plan, monthIndex) => {
  const supports = archive.supports.filter((s) => s.trackNo === trackNo)
  const rand = (() => {
    let s = plan.seed + trackNo * 7919
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0
      return s / 4294967296
    }
  })()

  // 本月生效的缺陷及取值
  const activeDefects = DEFECTS.filter((d) => d.months.includes(monthIndex)).map((d) => ({
    ...d,
    activeValue: d.values[d.months.indexOf(monthIndex)],
  }))

  const breaks = plan.breaks ?? []

  // 断点后里程重新计数：段内真值 + 重计起点 + 漂移
  const rawMileageAt = (trueMileage, drift) => {
    let segStart = 0
    let restart = 0
    for (const b of breaks) {
      if (trueMileage >= b.atMileage) {
        segStart = b.atMileage
        restart = b.restartAt
      }
    }
    return trueMileage - segStart + restart + drift
  }

  const poleSet = new Set(supports.map((s) => s.mileage))
  const rows = []
  const totalSteps = Math.floor(LINE.totalLength / LINE.sampleStep)
  let seq = 0

  for (let i = 0; i <= totalSteps; i++) {
    const trueMileage = i * LINE.sampleStep
    const drift = driftAt(plan, trueMileage, i, rand)
    // 断点后原始里程重新计数：段内真值 + 重计起点 + 漂移
    const rawMileage = rawMileageAt(trueMileage, drift)

    const support = supports.find((sp) => Math.abs(sp.mileage - trueMileage) < 0.01)
    const designH = archive.tunnels.some(
      (t) => trueMileage >= t.start && trueMileage <= t.end,
    )
      ? LINE.designHeight - 200
      : LINE.designHeight

    // 吊弦弛度：跨中导高略低，余弦形态
    const spanPos = trueMileage % LINE.supportSpan
    const sag = -18 * 0.5 * (1 - Math.cos((spanPos / LINE.supportSpan) * Math.PI * 2))
    const noiseH = (rand() - 0.5) * 4
    const noiseS = (rand() - 0.5) * 6

    // 设计拉出：相邻定位点线性过渡（与 geometry.ts 同构）
    // 跨内位置取左侧支柱 seq，跨中不再四舍五入错位到相邻杆
    const leftSeq = Math.min(Math.floor(trueMileage / LINE.supportSpan), supports.length - 1)
    const left = supports[leftSeq]
    const right = supports[Math.min(leftSeq + 1, supports.length - 1)]
    const tSpan = spanPos / LINE.supportSpan
    const designStagger =
      (left.hasLocators[0]?.designStagger ?? 0) +
      ((right.hasLocators[0]?.designStagger ?? 0) - (left.hasLocators[0]?.designStagger ?? 0)) *
        tSpan

    const heightMm =
      designH + sag + noiseH + defectInfluence(activeDefects, trueMileage, 'height')
    const staggerMm =
      designStagger + noiseS + defectInfluence(activeDefects, trueMileage, 'stagger')

    const isPole = poleSet.has(trueMileage)
    const isBreak = breaks.some((b) => Math.abs(trueMileage - b.atMileage) < 0.01)

    rows.push({
      seq: seq++,
      rawMileage: Number(rawMileage.toFixed(3)),
      heightMm: Number(heightMm.toFixed(1)),
      staggerMm: Number(staggerMm.toFixed(1)),
      event: isBreak ? 'BREAK' : isPole ? 'POLE' : '',
      supportCode: isPole ? supportCode(trackNo, leftSeq) : '',
    })
  }
  return rows
}
