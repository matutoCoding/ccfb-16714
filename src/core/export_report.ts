// 报表导出：超限明细 CSV、锚段几何图 PNG
import type {
  AnchorSection,
  ExceedPoint,
  InspectionSample,
  LineArchive,
  Support,
} from '@/types'
import { designHeightAt, designStaggerAt } from '@/core/geometry'
import { downloadBlob, fmtMileage } from '@/utils/format'

const csvCell = (v: string | number): string => {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const exportExceedReport = (
  exceeds: ExceedPoint[],
  batchNameOf: (id: string) => string,
): void => {
  const header = [
    '批次', '股道', '级别', '指标', '极值里程', '起点里程', '终点里程',
    '极值(mm)', '限界(mm)', '最近杆号', '状态',
  ]
  const lines = exceeds.map((e) =>
    [
      batchNameOf(e.batchId),
      e.trackNo === 1 ? '下行' : '上行',
      `${e.level}级`,
      e.metric === 'height' ? '导高' : '拉出',
      fmtMileage(e.maxMileage),
      fmtMileage(e.startMileage),
      fmtMileage(e.endMileage),
      e.maxValue.toFixed(1),
      e.limitValue,
      e.nearestSupportCode,
      e.status,
    ].map(csvCell).join(','),
  )
  const csv = `﻿${header.join(',')}\n${lines.join('\n')}\n`
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `超限报表_${new Date().toISOString().slice(0, 10)}.csv`)
}

// 锚段几何图：上下两栏分别画导高、拉出的实测 vs 设计
export const exportAnchorGeometryPng = (
  archive: LineArchive,
  anchor: AnchorSection,
  supports: Support[],
  samples: InspectionSample[],
  batchName: string,
): void => {
  const W = 1400
  const H = 900
  const PAD = { top: 70, right: 60, bottom: 60, left: 90 }
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const inRange = samples.filter(
    (s) => s.mileage >= anchor.startMileage && s.mileage <= anchor.endMileage,
  )
  const anchorSupports = supports.filter(
    (s) => s.mileage >= anchor.startMileage && s.mileage <= anchor.endMileage,
  )

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#1e293b'
  ctx.font = '600 24px system-ui'
  ctx.fillText(`${archive.lineName} ${anchor.name} 几何图`, PAD.left, 40)
  ctx.font = '15px system-ui'
  ctx.fillStyle = '#64748b'
  ctx.fillText(`${batchName} · ${fmtMileage(anchor.startMileage)} ~ ${fmtMileage(anchor.endMileage)}`, PAD.left, 62)

  const drawPanel = (
    top: number,
    height: number,
    title: string,
    metric: 'heightMm' | 'staggerMm',
    designFn: (m: number) => number,
    color: string,
  ) => {
    const plotW = W - PAD.left - PAD.right
    const plotH = height - 110
    const xs = inRange.map((s) => s.mileage)
    const ys = inRange.map((s) => s[metric])
    const designYs = inRange.map((s) => designFn(s.mileage))
    const minY = Math.min(...ys, ...designYs) - 20
    const maxY = Math.max(...ys, ...designYs) + 20
    const sx = (m: number) =>
      PAD.left + ((m - anchor.startMileage) / (anchor.endMileage - anchor.startMileage)) * plotW
    const sy = (v: number) => top + (1 - (v - minY) / (maxY - minY)) * plotH

    ctx.strokeStyle = '#e2e8f0'
    ctx.lineWidth = 1
    ctx.font = '13px system-ui'
    for (let i = 0; i <= 5; i++) {
      const y = top + (plotH * i) / 5
      ctx.beginPath()
      ctx.moveTo(PAD.left, y)
      ctx.lineTo(W - PAD.right, y)
      ctx.stroke()
      ctx.fillStyle = '#94a3b8'
      ctx.textAlign = 'right'
      ctx.fillText((maxY - ((maxY - minY) * i) / 5).toFixed(0), PAD.left - 10, y + 4)
    }
    ctx.fillStyle = '#334155'
    ctx.textAlign = 'left'
    ctx.font = '600 16px system-ui'
    ctx.fillText(title, PAD.left, top - 14)

    // 支柱竖线与杆号
    ctx.strokeStyle = '#e2e8f0'
    ctx.fillStyle = '#94a3b8'
    ctx.font = '12px system-ui'
    ctx.textAlign = 'center'
    for (const s of anchorSupports) {
      const x = sx(s.mileage)
      ctx.beginPath()
      ctx.moveTo(x, top)
      ctx.lineTo(x, top + plotH)
      ctx.stroke()
      ctx.fillText(s.supportCode, x, top + plotH + 20)
    }

    // 设计值（虚线灰）
    ctx.strokeStyle = '#94a3b8'
    ctx.setLineDash([8, 5])
    ctx.beginPath()
    inRange.forEach((s, i) => {
      const x = sx(s.mileage)
      const y = sy(designYs[i])
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
    ctx.setLineDash([])

    // 实测值
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.beginPath()
    inRange.forEach((s, i) => {
      const x = sx(s.mileage)
      const y = sy(ys[i])
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }

  drawPanel(
    PAD.top + 40,
    360,
    '接触线高度（实线=实测 mm，虚线=设计）',
    'heightMm',
    (m) => designHeightAt(archive, m),
    '#dc2626',
  )
  drawPanel(
    500,
    360,
    '拉出值（实线=实测 mm，虚线=设计定位过渡）',
    'staggerMm',
    (m) => designStaggerAt(supports, m),
    '#2563eb',
  )

  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, `${anchor.name}_几何图_${batchName}.png`)
  }, 'image/png')
}
