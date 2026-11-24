<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import MileageChart from '@/components/MileageChart.vue'
import { buildLocatorTrends, buildOverlaySeries, type BatchSeries } from '@/core/trend'
import { loadSamples } from '@/db/idb'
import { state } from '@/store/app'
import { fmtMileage, fmtMm } from '@/utils/format'

const PALETTE = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed']

const trackNo = ref<1 | 2>(1)
const metric = ref<'heightMm' | 'staggerMm'>('heightMm')
const windowStart = ref(0)
const windowSpan = ref(4000)
const loading = ref(false)
const seriesData = ref<BatchSeries[]>([])
const highlightOnly = ref(true)

const trackBatches = computed(() =>
  state.batches.filter((b) => b.trackNo === trackNo.value),
)

const loadTrackData = async () => {
  loading.value = true
  try {
    const loaded = await Promise.all(
      trackBatches.value.map(async (batch) => ({
        batch,
        samples: await loadSamples(batch.id),
      })),
    )
    seriesData.value = loaded
  } finally {
    loading.value = false
  }
}

watch(trackNo, loadTrackData, { immediate: true })

const supports = computed(() =>
  state.archive?.supports.filter((s) => s.trackNo === trackNo.value) ?? [],
)

const trends = computed(() => buildLocatorTrends(seriesData.value, supports.value))

const changeThreshold = computed(() => (metric.value === 'heightMm' ? 15 : 10))

const rankedTrends = computed(() => {
  const list = trends.value.map((t) => ({
    ...t,
    delta: metric.value === 'heightMm' ? t.heightDelta : t.staggerDelta,
    monotonic: metric.value === 'heightMm' ? t.monotonicHeight : t.monotonicStagger,
  }))
  const filtered = list.filter((t) =>
    highlightOnly.value ? Math.abs(t.delta) >= changeThreshold.value && t.monotonic : true,
  )
  return filtered.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 80)
})

const overlay = computed(() =>
  buildOverlaySeries(
    seriesData.value,
    [windowStart.value, windowStart.value + windowSpan.value],
    metric.value,
    PALETTE,
  ),
)

const shiftWindow = (delta: number) => {
  const total = state.archive?.totalLength ?? 0
  const max = total - windowSpan.value
  windowStart.value = Math.max(0, Math.min(max, windowStart.value + delta))
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1 class="page-title">趋势对比</h1>
        <p class="page-sub">同一区段历次检测叠加，定位持续变化的定位点</p>
      </div>
      <div class="head-ctrl">
        <select v-model.number="trackNo" class="select">
          <option :value="1">下行</option>
          <option :value="2">上行</option>
        </select>
        <select v-model="metric" class="select">
          <option value="heightMm">导高趋势</option>
          <option value="staggerMm">拉出值趋势</option>
        </select>
      </div>
    </header>

    <EmptyState
      v-if="trackBatches.length < 2"
      icon="trend"
      title="同股道检测批次不足 2 个"
      sub="趋势对比需要至少两个月的检测数据，请先在检测批次页载入样例数据"
    />

    <template v-else>
      <div v-if="loading" class="loading-text">正在加载历史采样…</div>

      <div class="card chart-card">
        <div class="chart-head">
          <h3>
            {{ metric === 'heightMm' ? '导高' : '拉出值' }}叠加曲线 ·
            {{ fmtMileage(windowStart) }} ~ {{ fmtMileage(windowStart + windowSpan) }}
          </h3>
          <div class="window-ctrl">
            <button class="btn" @click="shiftWindow(-1000)">← 1km</button>
            <button class="btn" @click="shiftWindow(1000)">1km →</button>
            <select v-model.number="windowSpan" class="select">
              <option :value="2000">2km 窗口</option>
              <option :value="4000">4km 窗口</option>
              <option :value="8000">8km 窗口</option>
            </select>
          </div>
        </div>
        <MileageChart :series="overlay" :height="280" :y-label="metric === 'heightMm' ? '导高 mm' : '拉出 mm'" />
        <div class="legend">
          <span v-for="(s, i) in overlay" :key="s.name" class="legend-item">
            <span class="dot" :style="{ background: PALETTE[i % PALETTE.length] }" />
            {{ s.name }}
          </span>
        </div>
      </div>

      <div class="card table-card">
        <div class="table-head">
          <h3>定位点变化排名（按 {{ metric === 'heightMm' ? '导高' : '拉出' }} 变化量）</h3>
          <label class="switch">
            <input type="checkbox" v-model="highlightOnly" />
            只看持续变化（≥{{ changeThreshold }}mm 且单调）
          </label>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>杆号</th>
              <th>里程</th>
              <th v-for="b in trackBatches" :key="b.id">{{ b.inspectDate }}</th>
              <th>首末变化</th>
              <th>趋势判定</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in rankedTrends" :key="t.supportCode">
              <td>{{ t.supportCode }}</td>
              <td>{{ fmtMileage(t.mileage) }}</td>
              <td v-for="r in t.rows" :key="r.batchId">
                {{ metric === 'heightMm' ? r.heightMm.toFixed(1) : fmtMm(r.staggerMm) }}
              </td>
              <td :class="Math.abs(t.delta) >= changeThreshold ? 'hot' : ''">
                {{ fmtMm(t.delta) }} mm
              </td>
              <td>
                <span v-if="t.monotonic && Math.abs(t.delta) >= changeThreshold" class="tag tag-l2">
                  <AppIcon name="trend" :size="13" /> 持续变化
                </span>
                <span v-else class="tag tag-ok">基本稳定</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="rankedTrends.length === 0" class="empty-tip">当前窗口下没有满足持续变化条件的定位点</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: var(--sp-5);
}
.head-ctrl {
  display: flex;
  gap: var(--sp-3);
}
.loading-text {
  color: var(--c-primary);
  margin-bottom: var(--sp-3);
}
.chart-card {
  padding: var(--sp-4);
  margin-bottom: var(--sp-4);
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
.legend {
  display: flex;
  gap: var(--sp-5);
  padding: var(--sp-3) var(--sp-2) 0;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--c-text-2);
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.table-card {
  padding: var(--sp-4);
}
.table-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--sp-3);
}
.switch {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--c-text-2);
}
.hot {
  color: var(--c-danger);
  font-weight: var(--fw-semibold);
}
.empty-tip {
  padding: var(--sp-5);
  text-align: center;
  color: var(--c-text-3);
}
</style>
