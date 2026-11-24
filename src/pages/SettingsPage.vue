<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { exportAnchorGeometryPng, exportExceedReport } from '@/core/export_report'
import { loadDemoData } from '@/core/demo_loader'
import { loadSamples } from '@/db/idb'
import { refreshAll, resetAllData, state, updateSettings } from '@/store/app'
import type { LimitThresholds } from '@/types'

const form = ref({ ...state.settings })
const savedTip = ref('')
const busy = ref(false)
const exportBatchId = ref(state.batches[0]?.id ?? '')
const exportAnchorId = ref(state.archive?.anchorSections[0]?.id ?? '')

const save = async () => {
  await updateSettings({ ...form.value })
  savedTip.value = '已保存，新导入批次将按新限界判定'
  setTimeout(() => (savedTip.value = ''), 3000)
}

const onExportExceeds = () => {
  exportExceedReport(state.exceeds, (id) => state.batches.find((b) => b.id === id)?.name ?? id)
}

const onExportAnchor = async () => {
  if (!state.archive || !exportBatchId.value || !exportAnchorId.value) return
  const anchor = state.archive.anchorSections.find((a) => a.id === exportAnchorId.value)
  const batch = state.batches.find((b) => b.id === exportBatchId.value)
  if (!anchor || !batch) return
  const supports = state.archive.supports.filter((s) => s.trackNo === anchor.trackNo)
  const samples = await loadSamples(batch.id)
  exportAnchorGeometryPng(state.archive, anchor, supports, samples, batch.name)
}

const reloadDemo = async () => {
  if (!window.confirm('将清空当前全部数据并重新载入样例，确认继续？')) return
  busy.value = true
  try {
    await resetAllData()
    await loadDemoData()
    await refreshAll()
    form.value = { ...state.settings }
  } finally {
    busy.value = false
  }
}

const wipe = async () => {
  if (!window.confirm('确认清空 IndexedDB 中的全部批次、采样、超限、工单与档案？')) return
  await resetAllData()
}

const limitFields: { key: keyof LimitThresholds; label: string; hint: string }[] = [
  { key: 'heightUpperL1', label: '导高一级上限', hint: 'mm' },
  { key: 'heightUpperL2', label: '导高二级上限', hint: 'mm' },
  { key: 'heightLowerL1', label: '导高一级下限', hint: 'mm' },
  { key: 'heightLowerL2', label: '导高二级下限', hint: 'mm' },
  { key: 'staggerAbsL1', label: '拉出绝对值一级', hint: 'mm' },
  { key: 'staggerAbsL2', label: '拉出绝对值二级', hint: 'mm' },
]

const trackAnchors = computed(() => {
  if (!state.archive) return []
  return state.archive.anchorSections.filter(
    (a) => a.trackNo === state.batches.find((b) => b.id === exportBatchId.value)?.trackNo,
  )
})
</script>

<template>
  <div class="page settings-page">
    <header class="page-head">
      <div>
        <h1 class="page-title">设置</h1>
        <p class="page-sub">限界阈值、回放参数与本地数据管理</p>
      </div>
    </header>

    <div class="grid">
      <section class="card block">
        <h2 class="block-title">超限限界值</h2>
        <div class="limit-grid">
          <div v-for="f in limitFields" :key="f.key" class="limit-item">
            <label>{{ f.label }}</label>
            <div class="input-suffix">
              <input v-model.number="form.limits[f.key]" type="number" class="input" />
              <span>{{ f.hint }}</span>
            </div>
          </div>
        </div>
      </section>

      <section class="card block">
        <h2 class="block-title">三维回放</h2>
        <div class="limit-item">
          <label>导高放大倍数（×1 ~ ×50）</label>
          <input v-model.number="form.exaggerationHeight" type="number" min="1" max="50" class="input" />
        </div>
        <div class="limit-item">
          <label>拉出放大倍数（×1 ~ ×30）</label>
          <input v-model.number="form.exaggerationStagger" type="number" min="1" max="30" class="input" />
        </div>
        <div class="limit-item">
          <label>默认回放速度（米/秒）</label>
          <input v-model.number="form.playbackSpeed" type="number" min="1" max="120" class="input" />
        </div>
      </section>

      <section class="card block">
        <h2 class="block-title">报表导出</h2>
        <button class="btn btn-primary" :disabled="state.exceeds.length === 0" @click="onExportExceeds">
          <AppIcon name="download" :size="16" /> 导出超限报表 CSV
        </button>
        <div class="anchor-export">
          <label>锚段几何图（PNG）</label>
          <div class="export-row">
            <select v-model="exportBatchId" class="select">
              <option v-for="b in state.batches" :key="b.id" :value="b.id">{{ b.name }}</option>
            </select>
            <select v-model="exportAnchorId" class="select">
              <option v-for="a in trackAnchors" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
            <button class="btn" :disabled="!exportBatchId" @click="onExportAnchor">
              <AppIcon name="download" :size="16" /> 导出
            </button>
          </div>
        </div>
      </section>

      <section class="card block danger-block">
        <h2 class="block-title">数据管理（IndexedDB）</h2>
        <p class="muted">
          当前存储：批次 {{ state.batches.length }} 个 · 超限 {{ state.exceeds.length }} 条 ·
          工单 {{ state.workOrders.length }} 条
        </p>
        <div class="danger-actions">
          <button class="btn" :disabled="busy" @click="reloadDemo">
            <AppIcon name="refresh" :size="16" /> 重置并重新载入样例数据
          </button>
          <button class="btn btn-danger" @click="wipe">
            <AppIcon name="trash" :size="16" /> 清空全部本地数据
          </button>
        </div>
      </section>
    </div>

    <div class="save-bar">
      <button class="btn btn-primary" @click="save">保存设置</button>
      <span v-if="savedTip" class="saved-tip">{{ savedTip }}</span>
    </div>
  </div>
</template>

<style scoped>
.page-head {
  margin-bottom: var(--sp-5);
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-4);
}
.block {
  padding: var(--sp-5);
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}
.block-title {
  font-size: var(--fs-base);
}
.limit-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-4);
}
.limit-item {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.limit-item label {
  color: var(--c-text-2);
}
.input-suffix {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.input-suffix span {
  color: var(--c-text-3);
}
.anchor-export {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.export-row {
  display: flex;
  gap: var(--sp-2);
}
.export-row .select {
  flex: 1;
}
.muted {
  color: var(--c-text-3);
}
.danger-block {
  border-color: var(--c-danger);
}
.danger-actions {
  display: flex;
  gap: var(--sp-3);
}
.save-bar {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  margin-top: var(--sp-5);
}
.saved-tip {
  color: var(--c-success);
}
</style>
