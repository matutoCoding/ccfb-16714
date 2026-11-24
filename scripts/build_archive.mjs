// 生成线路档案 JSON：支柱、锚段、曲线、隧道、吊弦布置
import { LINE, CURVES, TUNNELS } from './line_config.mjs'

const supportCode = (trackNo, seq) => `S${trackNo}${String(seq).padStart(4, '0')}`

export const buildArchive = () => {
  const supports = []
  const anchorSections = []
  const supportCount = Math.floor(LINE.totalLength / LINE.supportSpan) // 1000 个间隔，1001 根

  for (const trackNo of [1, 2]) {
    for (let seq = 0; seq <= supportCount; seq++) {
      const mileage = seq * LINE.supportSpan
      const inTunnel = TUNNELS.some((t) => mileage >= t.start && mileage <= t.end)
      const designStagger = (seq % 2 === 0 ? 1 : -1) * (inTunnel ? 200 : 300)
      supports.push({
        id: `sup_${trackNo}_${seq}`,
        supportCode: supportCode(trackNo, seq),
        mileage,
        trackNo,
        anchorSectionId: `anc_${trackNo}_${Math.floor(seq / LINE.anchorSpanCount)}`,
        hasLocators: [{ wireSide: designStagger > 0 ? 'right' : 'left', designStagger }],
      })
    }

    const anchorCount = Math.ceil(supportCount / LINE.anchorSpanCount)
    for (let a = 0; a < anchorCount; a++) {
      const startSeq = a * LINE.anchorSpanCount
      const endSeq = Math.min((a + 1) * LINE.anchorSpanCount, supportCount)
      anchorSections.push({
        id: `anc_${trackNo}_${a}`,
        name: `${trackNo === 1 ? '下行' : '上行'}锚段 ${String(a + 1).padStart(2, '0')}`,
        trackNo,
        startMileage: startSeq * LINE.supportSpan,
        endMileage: endSeq * LINE.supportSpan,
        startSupportCode: supportCode(trackNo, startSeq),
        endSupportCode: supportCode(trackNo, endSeq),
        tensionLength: (endSeq - startSeq) * LINE.supportSpan,
      })
    }
  }

  const droppers = []
  for (let seq = 0; seq < supportCount; seq++) {
    const positions = []
    for (let d = 1; d <= LINE.dropperPerSpan; d++) {
      positions.push((LINE.supportSpan * d) / (LINE.dropperPerSpan + 1))
    }
    droppers.push({ spanStartSupportId: `sup_1_${seq}`, positionsInSpan: positions })
    droppers.push({ spanStartSupportId: `sup_2_${seq}`, positionsInSpan: positions })
  }

  return {
    lineName: LINE.name,
    totalLength: LINE.totalLength,
    designHeight: LINE.designHeight,
    generatedAt: new Date().toISOString(),
    supports,
    anchorSections,
    curves: CURVES.map((c, i) => ({ id: `cur_${i + 1}`, ...c })),
    tunnels: TUNNELS.map((t, i) => ({
      id: `tun_${i + 1}`,
      ...t,
      trackNos: [1, 2],
    })),
    droppers,
  }
}
