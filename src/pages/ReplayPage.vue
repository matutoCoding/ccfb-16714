<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import MileageChart from '@/components/MileageChart.vue'
import { CatenaryScene } from '@/three/scene'
import { getExceedsByBatch, loadSamples } from '@/db/idb'
import { state } from '@/store/app'
import { fmtMileage, fmtMm } from '@/utils/format'
import type { ExceedPoint, InspectionBatch, InspectionSample } from '@/types'

const viewport = ref<HTMLDivElement | null>(null)
let scene: CatenaryScene | null = null

const currentBatch = ref<InspectionBatch | null>(null)
const samples = ref<InspectionSample[]>([])
const exceeds = ref<ExceedPoint[]>([])
const loading = ref(false)
const playing = ref(false)
const mileage = ref(0)
const liveSample = ref<InspectionSample | null>(null)
const viewRange = ref<[number, number]>([0, 4000])
const exagH = ref(state.settings.exaggerationHeight)
const exagS = ref(state.settings.exaggerationStagger)

const batches = computed(() => state.batches)

const ensureScene = async (batch: InspectionBatch) => {
  loading.value = true
  const [data, exc] = await Promise.all([
    loadSamples(batch.id),
    getExceedsByBatch(batch.id),
  ])
  samples.value = data
  exceeds.value = exc
  await nextTick()
  if (!viewport.value || !state.archive) return

  scene?.dispose()
  scene = new CatenaryScene(
    viewport.value,
    state.archive,
    batch.trackNo,
    { exagHeight: exagH.value, exagStagger: exagS.value, windowM: 200 },
    state.settings.playbackSpeed,
  )
  scene.setData(data, exc)
  scene.onFrame((m, s) => {
    mileage.value = m
    liveSample.value = s
  })
  if (state.focusMileage != null) {
    scene.seek(state.focusMileage)
    mileage.value = state.focusMileage
    state.focusMileage = null
  }
  loading.value = false
}

watch(
  () => state.selectedBatchId,
  async (id) => {
    if (!id) {
      currentBatch.value = null
      return
    }
    const batch = state.batches.find((b) => b.id === id) ?? null
    currentBatch.value = batch
    if (batch) await ensureScene(batch)
  },
  { immediate: true },
)

onUnmounted(() => scene?.dispose())

const togglePlay = () => {
  if (!scene) return
  if (playing.value) {
    scene.pause()
    playing.value = false
  } else {
    scene.play()
    playing.value = true
  }
}

const onSeek = (m: number) => {
  scene?.seek(m)
  mileage.value = m
}

const jumpTo = (e: ExceedPoint) => {
  scene?.seek(e.maxMileage)
  mileage.value = e.maxMileage
}

const onExagChange = () => {
  scene?.setExaggeration(exagH.value, exagS.value)
}

watch(
  () => state.settings.playbackSpeed,
  (speed) => scene?.setSpeed(speed),
)

// 当前可视窗口内的曲线序列（按 viewRange 截取，避免一次画十万点）
const heightSeries = computed(() => {
  const [lo, hi] = viewRange.value
  const pts = samples.value
    .filter((s) => s.mileage >= lo && s.mileage <= hi)
    .map((s) => ({ x: s.mileage, y: s.heightMm }))
  return [
    {
      name: '导高(mm)',
      color: '#dc2626',
      points: pts,
    },
  ]
})

const staggerSeries = computed(() => {
  const [lo, hi] = viewRange.value
  return [
    {
      name: '拉出值(mm)',
      color: '#2563eb',
      points: samples.value
        .filter((s) => s.mileage >= lo && s.mileage <= hi)
        .map((s) => ({ x: s.mileage, y: s.staggerMm })),
    },
  ]
})

const limitRefs = computed(() => {
  const l = state.settings.limits
  return [
    { value: l.heightUpperL1, color: '#d97706', label: '导高一级上限' },
    { value: l.heightLowerL1, color: '#d97706', label: '导高一级下限' },
  ]
})

const visibleMarkers = computed(() => {
  const [lo, hi] = viewRange.value
  return exceeds.value
    .filter((e) => e.maxMileage >= lo && e.maxMileage <= hi)
    .map((e) => ({
      x: e.maxMileage,
      color: e.level === 2 ? '#dc2626' : '#d97706',
      title: `${e.metric === 'height' ? '导高' : '拉出'} ${e.level} 级超限`,
    }))
})

const shiftWindow = (delta: number) => {
  const span = viewRange.value[1] - viewRange.value[0]
  const max = (state.archive?.totalLength ?? 0) - span
  const next = Math.max(0, Math.min(max, viewRange.value[0] + delta))
  viewRange.value = [next, next + span]
}

const selectBatchManually = (id: string) => {
  state.selectedBatchId = id
  state.focusMileage = 0
}

const progressPct = computed(() =>
  state.archive ? (mileage.value / state.archive.totalLength) * 100 : 0,
)
</script>

<template>
  <div class="page replay-page">
    <header class="page-head">
      <div>
        <h1 class="page-title">三维回放</h1>
        <p class="page-sub">实测导高与拉出值重建接触线/承力索，受电弓沿线路运行并显示弓网接触点</p>
      </div>
      <select
        class="select batch-select"
        :value="currentBatch?.id ?? ''"
        @change="selectBatchManually(($event.target as HTMLSelectElement).value)"
      >
        <option value="" disabled>选择检测批次</option>
        <option v-for="b in batches" :key="b.id" :value="b.id">
          {{ b.name }}（{{ b.trackNo === 1 ? '下行' : '上行' }}）
        </option>
      </select>
    </header>

    <EmptyState
      v-if="!currentBatch"
      icon="cube"
      title="还没有选择检测批次"
      sub="在右上角选择批次，或从检测批次页点击「三维回放」进入"
    />

    <template v-else>
      <div class="layout">
        <div class="viewport card" ref="viewport">
          <div v-if="loading" class="viewport-loading">正在构建三维场景…</div>
          <div class="hud">
            <div class="hud-item">
              <span class="hud-label">里程</span>
              <span class="hud-val">{{ fmtMileage(mileage) }}</span>
            </div>
            <div class="hud-item" v-if="liveSample">
              <span class="hud-label">导高</span>
              <span class="hud-val" :class="{ over: liveSample.heightMm > state.settings.limits.heightUpperL1 || liveSample.heightMm < state.settings.limits.heightLowerL1 }">
                {{ liveSample.heightMm.toFixed(1) }} mm
              </span>
            </div>
            <div class="hud-item" v-if="liveSample">
              <span class="hud-label">拉出</span>
              <span class="hud-val" :class="{ over: Math.abs(liveSample.staggerMm) > state.settings.limits.staggerAbsL1 }">
                {{ fmtMm(liveSample.staggerMm) }} mm
              </span>
            </div>
            <div class="hud-item" v-if="liveSample?.supportCode">
              <span class="hud-label">最近杆号</span>
              <span class="hud-val">{{ liveSample.supportCode }}</span>
            </div>
          </div>
        </div>

        <aside class="side card">
          <h3 class="side-title">播放控制</h3>
          <div class="control-row">
            <button class="btn btn-primary" @click="togglePlay">
              <AppIcon :name="playing ? 'pause' : 'play'" :size="16" />
              {{ playing ? '暂停' : '播放' }}
            </button>
            <button class="btn" @click="onSeek(0)">回到起点</button>
          </div>
          <input
            class="seek"
            type="range"
            min="0"
            :max="state.archive?.totalLength ?? 50000"
            step="10"
            :value="mileage"
            @input="onSeek(Number(($event.target as HTMLInputElement).value))"
          />
          <div class="progress-meta">
            <span>{{ fmtMileage(mileage) }}</span>
            <span>{{ progressPct.toFixed(1) }}%</span>
          </div>

          <h3 class="side-title">偏差放大</h3>
          <div class="exag-row">
            <label>导高 ×{{ exagH }}</label>
            <input type="range" min="1" max="50" v-model.number="exagH" @change="onExagChange" />
          </div>
          <div class="exag-row">
            <label>拉出 ×{{ exagS }}</label>
            <input type="range" min="1" max="30" v-model.number="exagS" @change="onExagChange" />
          </div>
          <p class="exag-tip">毫米级偏差在几十米跨距中肉眼不可见，放大后可直观观察高低与之字形变化</p>

          <h3 class="side-title">
            超限点
            <span class="count">{{ exceeds.length }}</span>
          </h3>
          <div class="exceed-list">
            <button
              v-for="e in exceeds"
              :key="e.id"
              class="exceed-item"
              @click="jumpTo(e)"
            >
              <span class="tag" :class="e.level === 2 ? 'tag-l2' : 'tag-l1'">
                {{ e.level }} 级
              </span>
              <span class="exceed-metric">{{ e.metric === 'height' ? '导高' : '拉出' }}</span>
              <span class="exceed-m">{{ fmtMileage(e.maxMileage) }}</span>
              <AppIcon name="locate" :size="15" />
            </button>
            <div v-if="exceeds.length === 0" class="muted">本批次无超限</div>
          </div>
        </aside>
      </div>

      <div class="charts card">
        <div class="chart-head">
          <h3>里程曲线（窗口 {{ fmtMileage(viewRange[0]) }} ~ {{ fmtMileage(viewRange[1]) }}）</h3>
          <div class="window-ctrl">
            <button class="btn" @click="shiftWindow(-1000)">← 1km</button>
            <button class="btn" @click="shiftWindow(1000)">1km →</button>
            <select
              class="select"
              :value="String(viewRange[1] - viewRange[0])"
              @change="(ev) => {
                const span = Number(($event.target as HTMLSelectElement).value)
                viewRange = [viewRange[0], viewRange[0] + span]
              }"
            >
              <option value="2000">窗口 2km</option>
              <option value="4000">窗口 4km</option>
              <option value="8000">窗口 8km</option>
            </select>
          </div>
        </div>
        <MileageChart
          :series="heightSeries"
          :ref-lines="limitRefs"
          :markers="visibleMarkers"
          :select-mileage="mileage"
          :height="220"
          y-label="导高 mm"
          @select="onSeek"
        />
        <MileageChart
          :series="staggerSeries"
          :ref-lines="[
            { value: state.settings.limits.staggerAbsL1, color: '#d97706', label: '拉出一级限界' },
            { value: -state.settings.limits.staggerAbsL1, color: '#d97706', label: '' },
          ]"
          :markers="visibleMarkers"
          :select-mileage="mileage"
          :height="220"
          y-label="拉出 mm"
          @select="onSeek"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--sp-5);
}
.batch-select {
  min-width: 260px;
}
.layout {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: var(--sp-4);
}
.viewport {
  position: relative;
  height: 480px;
  overflow: hidden;
}
.viewport-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--c-text-3);
  background: var(--c-surface);
  z-index: 2;
}
.hud {
  position: absolute;
  top: var(--sp-4);
  left: var(--sp-4);
  display: flex;
  gap: var(--sp-3);
  z-index: 1;
}
.hud-item {
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  padding: var(--sp-2) var(--sp-3);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.hud-label {
  color: var(--c-text-3);
}
.hud-val {
  font-weight: var(--fw-semibold);
}
.hud-val.over {
  color: var(--c-danger);
}
.side {
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  max-height: 480px;
  overflow-y: auto;
}
.side-title {
  font-size: var(--fs-sm);
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
}
.count {
  background: var(--c-surface-2);
  border-radius: var(--radius-sm);
  padding: 0 var(--sp-2);
  color: var(--c-text-2);
}
.control-row {
  display: flex;
  gap: var(--sp-2);
}
.seek {
  width: 100%;
}
.progress-meta {
  display: flex;
  justify-content: space-between;
  color: var(--c-text-3);
}
.exag-row {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.exag-tip {
  color: var(--c-text-3);
  margin: 0;
  line-height: 1.6;
}
.exceed-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.exceed-item {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  background: var(--c-surface);
  text-align: left;
}
.exceed-item:hover {
  border-color: var(--c-primary);
}
.exceed-m {
  margin-left: auto;
  color: var(--c-text-2);
}
.muted {
  color: var(--c-text-3);
}
.charts {
  margin-top: var(--sp-4);
  padding: var(--sp-4);
}
.chart-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--sp-3);
}
.window-ctrl {
  display: flex;
  gap: var(--sp-2);
}
</style>
