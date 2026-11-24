<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import { state } from '@/store/app'
import { fmtM, fmtMileage } from '@/utils/format'

const activeTab = ref<'supports' | 'anchors' | 'geometry'>('supports')
const trackFilter = ref<0 | 1 | 2>(0)
const keyword = ref('')
const pageSize = 60
const page = ref(0)

const filteredSupports = computed(() => {
  if (!state.archive) return []
  return state.archive.supports.filter((s) => {
    if (trackFilter.value !== 0 && s.trackNo !== trackFilter.value) return false
    if (keyword.value && !s.supportCode.includes(keyword.value.trim())) return false
    return true
  })
})

const pagedSupports = computed(() =>
  filteredSupports.value.slice(page.value * pageSize, (page.value + 1) * pageSize),
)

const totalPages = computed(() => Math.max(1, Math.ceil(filteredSupports.value.length / pageSize)))

const onFilter = () => {
  page.value = 0
}

const spanStats = computed(() => {
  if (!state.archive) return { min: 0, max: 0, avg: 0 }
  const t1 = state.archive.supports.filter((s) => s.trackNo === 1)
  const spans = t1.slice(1).map((s, i) => s.mileage - t1[i].mileage)
  return {
    min: Math.min(...spans),
    max: Math.max(...spans),
    avg: spans.reduce((a, b) => a + b, 0) / spans.length,
  }
})

const tunnelTrackLabel = (tracks: number[]) =>
  tracks.map((t) => (t === 1 ? '下行' : '上行')).join('、')
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1 class="page-title">线路档案</h1>
        <p class="page-sub">支柱位置、跨距、锚段、曲线与隧道的设计台账</p>
      </div>
    </header>

    <EmptyState
      v-if="!state.archive"
      icon="archive"
      title="尚未建立线路档案"
      sub="到检测批次页一键载入样例数据，系统会自动写入示范线档案"
    />

    <template v-else>
      <div class="stat-grid">
        <div class="card stat">
          <span class="stat-label">线路全长</span>
          <span class="stat-val">{{ (state.archive.totalLength / 1000).toFixed(0) }} km</span>
        </div>
        <div class="card stat">
          <span class="stat-label">支柱总数</span>
          <span class="stat-val">{{ state.archive.supports.length }} 根</span>
        </div>
        <div class="card stat">
          <span class="stat-label">锚段</span>
          <span class="stat-val">{{ state.archive.anchorSections.length }} 个</span>
        </div>
        <div class="card stat">
          <span class="stat-label">跨距(最小/平均/最大)</span>
          <span class="stat-val small">
            {{ spanStats.min }} / {{ spanStats.avg.toFixed(1) }} / {{ spanStats.max }} m
          </span>
        </div>
        <div class="card stat">
          <span class="stat-label">设计导高</span>
          <span class="stat-val">{{ state.archive.designHeight }} mm</span>
        </div>
        <div class="card stat">
          <span class="stat-label">曲线 / 隧道</span>
          <span class="stat-val small">{{ state.archive.curves.length }} / {{ state.archive.tunnels.length }} 处</span>
        </div>
      </div>

      <div class="tabs">
        <button class="tab" :class="{ active: activeTab === 'supports' }" @click="activeTab = 'supports'">
          <AppIcon name="locate" :size="16" /> 支柱与定位器
        </button>
        <button class="tab" :class="{ active: activeTab === 'anchors' }" @click="activeTab = 'anchors'">
          <AppIcon name="anchor" :size="16" /> 锚段与跨距
        </button>
        <button class="tab" :class="{ active: activeTab === 'geometry' }" @click="activeTab = 'geometry'">
          <AppIcon name="curve" :size="16" /> 曲线与隧道
        </button>
      </div>

      <!-- 支柱表 -->
      <div v-if="activeTab === 'supports'" class="card">
        <div class="toolbar">
          <div class="filter-group">
            <button class="btn" :class="{ 'btn-primary': trackFilter === 0 }" @click="trackFilter = 0; onFilter()">全部</button>
            <button class="btn" :class="{ 'btn-primary': trackFilter === 1 }" @click="trackFilter = 1; onFilter()">下行</button>
            <button class="btn" :class="{ 'btn-primary': trackFilter === 2 }" @click="trackFilter = 2; onFilter()">上行</button>
          </div>
          <input v-model="keyword" class="input search" placeholder="搜索杆号，如 S10120" @input="onFilter" />
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>杆号</th>
              <th>股道</th>
              <th>里程</th>
              <th>所属锚段</th>
              <th>定位侧</th>
              <th>设计拉出(mm)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in pagedSupports" :key="s.id">
              <td>{{ s.supportCode }}</td>
              <td>{{ s.trackNo === 1 ? '下行' : '上行' }}</td>
              <td>{{ fmtMileage(s.mileage) }}</td>
              <td>{{ s.anchorSectionId.replace('anc_', '锚段 ') }}</td>
              <td>{{ s.hasLocators[0]?.wireSide === 'right' ? '右侧(R)' : '左侧(L)' }}</td>
              <td>{{ s.hasLocators[0]?.designStagger ?? '-' }}</td>
            </tr>
          </tbody>
        </table>
        <div class="pager">
          <button class="btn" :disabled="page === 0" @click="page--">上一页</button>
          <span>{{ page + 1 }} / {{ totalPages }}（共 {{ filteredSupports.length }} 根）</span>
          <button class="btn" :disabled="page >= totalPages - 1" @click="page++">下一页</button>
        </div>
      </div>

      <!-- 锚段表 -->
      <div v-else-if="activeTab === 'anchors'" class="card">
        <table class="table">
          <thead>
            <tr>
              <th>锚段</th>
              <th>股道</th>
              <th>起止里程</th>
              <th>起止杆号</th>
              <th>锚段长度</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in state.archive.anchorSections" :key="a.id">
              <td>{{ a.name }}</td>
              <td>{{ a.trackNo === 1 ? '下行' : '上行' }}</td>
              <td>{{ fmtMileage(a.startMileage) }} ~ {{ fmtMileage(a.endMileage) }}</td>
              <td>{{ a.startSupportCode }} ~ {{ a.endSupportCode }}</td>
              <td>{{ fmtM(a.tensionLength) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 曲线与隧道 -->
      <div v-else class="geo-grid">
        <div class="card geo-card">
          <h3 class="card-title"><AppIcon name="curve" :size="17" /> 曲线段</h3>
          <table class="table">
            <thead>
              <tr><th>股道</th><th>起止里程</th><th>半径(m)</th><th>超高(mm)</th></tr>
            </thead>
            <tbody>
              <tr v-for="c in state.archive.curves" :key="c.id">
                <td>{{ c.trackNo === 1 ? '下行' : '上行' }}</td>
                <td>{{ fmtMileage(c.startMileage) }} ~ {{ fmtMileage(c.endMileage) }}</td>
                <td :class="c.radius < 0 ? 'warn' : ''">
                  {{ c.radius < 0 ? '左偏 ' : '' }}R{{ Math.abs(c.radius) }}
                </td>
                <td>{{ c.designCant }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="card geo-card">
          <h3 class="card-title"><AppIcon name="tunnel" :size="17" /> 隧道</h3>
          <table class="table">
            <thead>
              <tr><th>名称</th><th>起止里程</th><th>长度</th><th>涉及股道</th></tr>
            </thead>
            <tbody>
              <tr v-for="t in state.archive.tunnels" :key="t.id">
                <td>{{ t.name }}</td>
                <td>{{ fmtMileage(t.startMileage) }} ~ {{ fmtMileage(t.endMileage) }}</td>
                <td>{{ fmtM(t.endMileage - t.startMileage) }}</td>
                <td>{{ tunnelTrackLabel(t.trackNos) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page-head {
  margin-bottom: var(--sp-5);
}
.stat-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: var(--sp-3);
  margin-bottom: var(--sp-5);
}
.stat {
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.stat-label {
  color: var(--c-text-3);
}
.stat-val {
  font-size: var(--fs-xl);
  font-weight: var(--fw-semibold);
}
.stat-val.small {
  font-size: var(--fs-base);
}
.tabs {
  display: flex;
  gap: var(--sp-2);
  margin-bottom: var(--sp-4);
}
.tab {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-4);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  background: var(--c-surface);
  color: var(--c-text-2);
}
.tab.active {
  background: var(--c-primary-soft);
  border-color: var(--c-primary);
  color: var(--c-primary);
}
.toolbar {
  display: flex;
  justify-content: space-between;
  padding: var(--sp-4);
  gap: var(--sp-4);
}
.filter-group {
  display: flex;
  gap: var(--sp-2);
}
.search {
  width: 260px;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-4);
  padding: var(--sp-4);
  color: var(--c-text-2);
}
.geo-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-4);
}
.card-title {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-base);
  padding: var(--sp-4) var(--sp-4) 0;
}
.warn {
  color: var(--c-warning);
  font-weight: var(--fw-medium);
}
</style>
