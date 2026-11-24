<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import { putWorkOrder, updateExceed } from '@/db/idb'
import { focusMileageInReplay, refreshAll, state } from '@/store/app'
import { fmtMileage, uid } from '@/utils/format'
import type { ExceedPoint } from '@/types'

const router = useRouter()
const levelFilter = ref<0 | 1 | 2>(0)
const metricFilter = ref<'all' | 'height' | 'stagger'>('all')
const statusFilter = ref<'all' | ExceedPoint['status']>('all')
const selectedId = ref<string | null>(null)

const batchName = (id: string) => state.batches.find((b) => b.id === id)?.name ?? id

const filtered = computed(() =>
  state.exceeds.filter((e) => {
    if (levelFilter.value !== 0 && e.level !== levelFilter.value) return false
    if (metricFilter.value !== 'all' && e.metric !== metricFilter.value) return false
    if (statusFilter.value !== 'all' && e.status !== statusFilter.value) return false
    return true
  }),
)

const selected = computed(() => state.exceeds.find((e) => e.id === selectedId.value) ?? null)

const stats = computed(() => ({
  l1: state.exceeds.filter((e) => e.level === 1).length,
  l2: state.exceeds.filter((e) => e.level === 2).length,
  open: state.exceeds.filter((e) => e.status === 'open').length,
  ordered: state.exceeds.filter((e) => e.status === 'ordered' || e.status === 'verified').length,
}))

const createWorkOrder = async (e: ExceedPoint) => {
  const order = {
    id: uid('wo'),
    exceedId: e.id,
    batchId: e.batchId,
    trackNo: e.trackNo,
    mileage: e.maxMileage,
    supportCode: e.nearestSupportCode,
    metric: e.metric,
    level: e.level,
    description: `${e.metric === 'height' ? '导高' : '拉出值'}${e.level} 级超限，极值 ${e.maxValue.toFixed(1)}mm，限界 ${e.limitValue}mm`,
    status: 'pending' as const,
    createdAt: Date.now(),
  }
  await putWorkOrder(order)
  await updateExceed({ ...e, status: 'ordered', workOrderId: order.id })
  await refreshAll()
}

const ignore = async (e: ExceedPoint) => {
  await updateExceed({ ...e, status: 'ignored' })
  await refreshAll()
}

const locateIn3d = (e: ExceedPoint) => {
  focusMileageInReplay(e.batchId, e.maxMileage)
}

const statusLabel: Record<ExceedPoint['status'], string> = {
  open: '待处理',
  ordered: '已派单',
  verified: '已复核',
  ignored: '已忽略',
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1 class="page-title">超限管理</h1>
        <p class="page-sub">按限界值自动判定的超限区段，支持派单、忽略与三维定位</p>
      </div>
    </header>

    <div class="stat-grid">
      <div class="card stat"><span class="stat-label">一级超限</span><span class="stat-val warn">{{ stats.l1 }}</span></div>
      <div class="card stat"><span class="stat-label">二级超限</span><span class="stat-val danger">{{ stats.l2 }}</span></div>
      <div class="card stat"><span class="stat-label">待处理</span><span class="stat-val">{{ stats.open }}</span></div>
      <div class="card stat"><span class="stat-label">已派单/复核</span><span class="stat-val ok">{{ stats.ordered }}</span></div>
    </div>

    <div class="card filter-bar">
      <div class="filter-group">
        <button class="btn" :class="{ 'btn-primary': levelFilter === 0 }" @click="levelFilter = 0">全部级别</button>
        <button class="btn" :class="{ 'btn-primary': levelFilter === 1 }" @click="levelFilter = 1">一级</button>
        <button class="btn" :class="{ 'btn-primary': levelFilter === 2 }" @click="levelFilter = 2">二级</button>
      </div>
      <select v-model="metricFilter" class="select">
        <option value="all">全部指标</option>
        <option value="height">导高</option>
        <option value="stagger">拉出</option>
      </select>
      <select v-model="statusFilter" class="select">
        <option value="all">全部状态</option>
        <option value="open">待处理</option>
        <option value="ordered">已派单</option>
        <option value="verified">已复核</option>
        <option value="ignored">已忽略</option>
      </select>
    </div>

    <EmptyState v-if="filtered.length === 0" icon="warning" title="没有符合条件的超限点" sub="调整筛选条件，或先导入检测批次" />

    <div v-else class="card">
      <table class="table">
        <thead>
          <tr>
            <th>级别</th>
            <th>指标</th>
            <th>极值里程</th>
            <th>区段范围</th>
            <th>极值(mm)</th>
            <th>限界(mm)</th>
            <th>最近杆号</th>
            <th>所属批次</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in filtered" :key="e.id" :class="{ selected: e.id === selectedId }" @click="selectedId = e.id">
            <td><span class="tag" :class="e.level === 2 ? 'tag-l2' : 'tag-l1'">{{ e.level }} 级</span></td>
            <td>{{ e.metric === 'height' ? '导高' : '拉出' }}</td>
            <td>{{ fmtMileage(e.maxMileage) }}</td>
            <td>{{ fmtMileage(e.startMileage) }} ~ {{ fmtMileage(e.endMileage) }}</td>
            <td :class="e.level === 2 ? 'danger' : 'warn'">{{ e.maxValue.toFixed(1) }}</td>
            <td>{{ e.limitValue }}</td>
            <td>{{ e.nearestSupportCode }}</td>
            <td>{{ batchName(e.batchId) }}</td>
            <td><span class="tag tag-info">{{ statusLabel[e.status] }}</span></td>
            <td>
              <div class="row-actions" @click.stop>
                <button class="btn" @click="locateIn3d(e)"><AppIcon name="cube" :size="15" />定位</button>
                <button
                  class="btn btn-primary"
                  :disabled="e.status !== 'open'"
                  @click="createWorkOrder(e)"
                >
                  <AppIcon name="tool" :size="15" />派单
                </button>
                <button class="btn" :disabled="e.status !== 'open'" @click="ignore(e)">忽略</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="selected" class="card detail">
      <h3>超限详情 · {{ fmtMileage(selected.maxMileage) }}</h3>
      <p>
        {{ batchName(selected.batchId) }} / {{ selected.trackNo === 1 ? '下行' : '上行' }} /
        最近支柱 {{ selected.nearestSupportCode }}
      </p>
      <p v-if="selected.workOrderId" class="ok">已生成工单 {{ selected.workOrderId }}，可在维修工单页处理</p>
      <button class="btn" @click="router.push('/orders')">前往工单页</button>
    </div>
  </div>
</template>

<style scoped>
.page-head {
  margin-bottom: var(--sp-5);
}
.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--sp-3);
  margin-bottom: var(--sp-4);
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
  font-size: var(--fs-2xl);
  font-weight: var(--fw-semibold);
}
.warn {
  color: var(--c-warning);
}
.danger {
  color: var(--c-danger);
}
.ok {
  color: var(--c-success);
}
.filter-bar {
  display: flex;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  margin-bottom: var(--sp-4);
}
.filter-group {
  display: flex;
  gap: var(--sp-2);
}
.row-actions {
  display: flex;
  gap: var(--sp-2);
}
tr.selected td {
  background: var(--c-primary-soft);
}
.detail {
  margin-top: var(--sp-4);
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.detail h3 {
  font-size: var(--fs-base);
}
.detail p {
  color: var(--c-text-2);
}
</style>
