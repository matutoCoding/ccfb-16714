<script setup lang="ts">
// 轻量 Canvas 里程曲线图：支持多序列叠加、限界线、超限标记、点击选里程
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { fmtMileage } from '@/utils/format'

interface Series {
  color: string
  points: { x: number; y: number }[]
  name: string
}

const props = defineProps<{
  series: Series[]
  height?: number
  yLabel?: string
  refLines?: { value: number; color: string; label: string }[]
  markers?: { x: number; color: string; title?: string }[]
  rangeX?: [number, number]
  selectMileage?: number | null
}>()

const emit = defineEmits<{ (e: 'select', mileage: number): void }>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const wrapRef = ref<HTMLDivElement | null>(null)
const hover = ref<{ x: number; mileage: number; values: { name: string; y: number; color: string }[] } | null>(null)

const PAD = { top: 16, right: 16, bottom: 32, left: 56 }

const bounds = computed(() => {
  if (props.rangeX) return { minX: props.rangeX[0], maxX: props.rangeX[1] }
  let minX = Infinity
  let maxX = -Infinity
  for (const s of props.series) {
    for (const p of s.points) {
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
    }
  }
  return { minX: isFinite(minX) ? minX : 0, maxX: isFinite(maxX) ? maxX : 1 }
})

const yBounds = computed(() => {
  let min = Infinity
  let max = -Infinity
  for (const s of props.series) {
    for (const p of s.points) {
      min = Math.min(min, p.y)
      max = Math.max(max, p.y)
    }
  }
  for (const r of props.refLines ?? []) {
    min = Math.min(min, r.value)
    max = Math.max(max, r.value)
  }
  if (!isFinite(min)) {
    min = 0
    max = 1
  }
  const pad = (max - min) * 0.08 || 1
  return { min: min - pad, max: max + pad }
})

const draw = () => {
  const canvas = canvasRef.value
  const wrap = wrapRef.value
  if (!canvas || !wrap) return
  const dpr = window.devicePixelRatio || 1
  const w = wrap.clientWidth
  const h = props.height ?? 240
  canvas.width = w * dpr
  canvas.height = h * dpr
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(dpr, dpr)

  const styles = getComputedStyle(document.documentElement)
  const cBorder = styles.getPropertyValue('--c-border').trim()
  const cText3 = styles.getPropertyValue('--c-text-3').trim()
  const cText2 = styles.getPropertyValue('--c-text-2').trim()

  const { minX, maxX } = bounds.value
  const { min: minY, max: maxY } = yBounds.value
  const plotW = w - PAD.left - PAD.right
  const plotH = h - PAD.top - PAD.bottom
  const sx = (x: number) => PAD.left + ((x - minX) / Math.max(maxX - minX, 1)) * plotW
  const sy = (y: number) => PAD.top + (1 - (y - minY) / Math.max(maxY - minY, 1e-9)) * plotH

  ctx.clearRect(0, 0, w, h)
  ctx.font = '12px system-ui'
  ctx.lineWidth = 1

  // 网格 + y 轴刻度
  const gridN = 5
  for (let i = 0; i <= gridN; i++) {
    const y = PAD.top + (plotH * i) / gridN
    const val = maxY - ((maxY - minY) * i) / gridN
    ctx.strokeStyle = cBorder
    ctx.beginPath()
    ctx.moveTo(PAD.left, y)
    ctx.lineTo(w - PAD.right, y)
    ctx.stroke()
    ctx.fillStyle = cText3
    ctx.textAlign = 'right'
    ctx.fillText(val.toFixed(0), PAD.left - 8, y + 4)
  }

  // x 轴里程刻度
  const tickN = Math.min(8, Math.floor(plotW / 110))
  for (let i = 0; i <= tickN; i++) {
    const mileage = minX + ((maxX - minX) * i) / tickN
    const x = sx(mileage)
    ctx.strokeStyle = cBorder
    ctx.beginPath()
    ctx.moveTo(x, PAD.top)
    ctx.lineTo(x, h - PAD.bottom)
    ctx.stroke()
    ctx.fillStyle = cText3
    ctx.textAlign = 'center'
    ctx.fillText(fmtMileage(mileage), x, h - PAD.bottom + 18)
  }
  if (props.yLabel) {
    ctx.save()
    ctx.fillStyle = cText2
    ctx.translate(14, PAD.top + plotH / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = 'center'
    ctx.fillText(props.yLabel, 0, 0)
    ctx.restore()
  }

  // 限界线
  for (const r of props.refLines ?? []) {
    ctx.strokeStyle = r.color
    ctx.setLineDash([6, 4])
    ctx.beginPath()
    ctx.moveTo(PAD.left, sy(r.value))
    ctx.lineTo(w - PAD.right, sy(r.value))
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = r.color
    ctx.textAlign = 'left'
    ctx.fillText(r.label, PAD.left + 4, sy(r.value) - 4)
  }

  // 数据序列（抽稀到画布像素密度，避免十万点压垮 Canvas）
  for (const s of props.series) {
    ctx.strokeStyle = s.color
    ctx.lineWidth = 1.4
    ctx.beginPath()
    const step = Math.max(1, Math.floor(s.points.length / plotW))
    let started = false
    for (let i = 0; i < s.points.length; i += step) {
      const p = s.points[i]
      const x = sx(p.x)
      const y = sy(p.y)
      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.stroke()
  }

  // 超限/事件标记
  for (const m of props.markers ?? []) {
    const x = sx(m.x)
    if (x < PAD.left || x > w - PAD.right) continue
    ctx.fillStyle = m.color
    ctx.beginPath()
    ctx.arc(x, PAD.top + 6, 4, 0, Math.PI * 2)
    ctx.fill()
  }

  // 选中里程竖线
  if (props.selectMileage != null) {
    const x = sx(props.selectMileage)
    ctx.strokeStyle = styles.getPropertyValue('--c-primary').trim()
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x, PAD.top)
    ctx.lineTo(x, h - PAD.bottom)
    ctx.stroke()
  }
}

const onMove = (ev: MouseEvent) => {
  const canvas = canvasRef.value
  const wrap = wrapRef.value
  if (!canvas || !wrap || props.series.length === 0) return
  const rect = canvas.getBoundingClientRect()
  const px = ev.clientX - rect.left
  const w = wrap.clientWidth
  const plotW = w - PAD.left - PAD.right
  const { minX, maxX } = bounds.value
  const mileage = minX + ((px - PAD.left) / plotW) * (maxX - minX)
  if (mileage < minX || mileage > maxX) {
    hover.value = null
    return
  }
  const values = props.series.map((s) => {
    let best = s.points[0]
    for (const p of s.points) {
      if (Math.abs(p.x - mileage) < Math.abs(best.x - mileage)) best = p
    }
    return { name: s.name, y: best?.y ?? 0, color: s.color }
  })
  hover.value = { x: ev.clientX - rect.left, mileage, values }
}

const onClick = (ev: MouseEvent) => {
  const wrap = wrapRef.value
  const canvas = canvasRef.value
  if (!wrap || !canvas) return
  const px = ev.clientX - canvas.getBoundingClientRect().left
  const plotW = wrap.clientWidth - PAD.left - PAD.right
  const { minX, maxX } = bounds.value
  const mileage = minX + ((px - PAD.left) / plotW) * (maxX - minX)
  if (mileage >= minX && mileage <= maxX) emit('select', mileage)
}

let observer: ResizeObserver | null = null
onMounted(() => {
  draw()
  observer = new ResizeObserver(draw)
  if (wrapRef.value) observer.observe(wrapRef.value)
})
onUnmounted(() => observer?.disconnect())
watch(() => [props.series, props.markers, props.refLines, props.rangeX, props.selectMileage], draw, { deep: true })
</script>

<template>
  <div ref="wrapRef" class="chart-wrap">
    <canvas
      ref="canvasRef"
      @mousemove="onMove"
      @mouseleave="hover = null"
      @click="onClick"
    />
    <div v-if="hover" class="tooltip" :style="{ left: `${Math.min(hover.x + 12, (wrapRef?.clientWidth ?? 0) - 160)}px` }">
      <div class="tip-mileage">{{ fmtMileage(hover.mileage) }}</div>
      <div v-for="v in hover.values" :key="v.name" class="tip-row">
        <span class="tip-dot" :style="{ background: v.color }" />
        <span>{{ v.name }}</span>
        <span class="tip-val">{{ v.y.toFixed(1) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chart-wrap {
  position: relative;
  width: 100%;
}
canvas {
  display: block;
  cursor: crosshair;
}
.tooltip {
  position: absolute;
  top: var(--sp-4);
  min-width: 148px;
  padding: var(--sp-2) var(--sp-3);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow);
  pointer-events: none;
  font-size: var(--fs-xs);
}
.tip-mileage {
  font-weight: var(--fw-semibold);
  margin-bottom: var(--sp-1);
}
.tip-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--c-text-2);
}
.tip-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.tip-val {
  margin-left: auto;
  font-weight: var(--fw-medium);
  color: var(--c-text);
}
</style>
