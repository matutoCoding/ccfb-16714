<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import { importCsvBatch } from '@/core/importer'
import { loadDemoData } from '@/core/demo_loader'
import { deleteBatch } from '@/db/idb'
import { refreshAll, selectBatch, state } from '@/store/app'
import { fmtM, fmtMileage } from '@/utils/format'
import type { InspectionBatch } from '@/types'

const router = useRouter()
const fileInput = ref<HTMLInputElement | null>(null)
const importMeta = ref({ name: '', inspectDate: '', trackNo: 1 as 1 | 2 })
const busy = ref(false)
const progress = ref('')
const detailBatch = ref<InspectionBatch | null>(null)

const hasArchive = computed(() => state.archive !== null)

const onFile = async (ev: Event) => {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !state.archive) return
  if (!importMeta.value.name) importMeta.value.name = file.name.replace(/\.csv$/i, '')
  if (!importMeta.value.inspectDate) {
    importMeta.value.inspectDate = new Date().toISOString().slice(0, 7)
  }
  busy.value = true
  progress.value = `解析 ${file.name}…`
  try {
    const text = await file.text()
    const batch = await importCsvBatch(text, { ...importMeta.value }, state.archive)
    await refreshAll()
    selectBatch(batch.id)
    detailBatch.value = state.batches.find((b) => b.id === batch.id) ?? null
    progress.value = ''
  } catch (err) {
    progress.value = `导入失败：${(err as Error).message}`
  } finally {
    busy.value = false
    input.value = ''
  }
}

const onDemo = async () => {
  busy.value = true
  try {
    await loadDemoData((p) => {
      progress.value = `${p.message}（${p.current}/${p.total}）`
    })
    await refreshAll()
  } finally {
    busy.value = false
    progress.value = ''
  }
}

const onDelete = async (batch: InspectionBatch) => {
  if (!window.confirm(`确认删除批次「${batch.name}」及其采样与超限数据？`)) return
  await deleteBatch(batch.id)
  await refreshAll()
  if (detailBatch.value?.id === batch.id) detailBatch.value = null
}

const openReplay = (batch: InspectionBatch) => {
  selectBatch(batch.id)
  router.push('/replay')
}

const eventLabel: Record<string, string> = {
  pole: '过杆锚点',
  break: '断点重计',
  jump: '里程跳变',
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1 class="page-title">检测批次</h1>
        <p class="page-sub">导入检测车 CSV，自动完成里程对齐与超限判定</p>
      </div>
      <div class="head-actions">
        <button class="btn" :disabled="busy" @click="fileInput?.click()">
          <AppIcon name="upload" :size="16" /> 导入 CSV
        </button>
        <button class="btn btn-primary" :disabled="busy" @click="onDemo">
          <AppIcon name="refresh" :size="16" /> 一键载入样例数据
        </button>
        <input
          ref="fileInput"
          type="file"
          accept=".csv,text/csv"
          hidden
          @change="onFile"
        />
      </div>
    </header>

    <div v-if="!hasArchive" class="card hint">
      <AppIcon name="warning" :size="18" />
      <span>还没有线路档案，先点「一键载入样例数据」生成示范线档案，或在设置中导入档案 JSON。</span>
    </div>

    <div class="card import-form">
      <div class="form-row">
        <label>批次名称</label>
        <input v-model="importMeta.name" class="input" placeholder="如 2026-11 下行检测" />
      </div>
      <div class="form-row">
        <label>检测月份</label>
        <input v-model="importMeta.inspectDate" class="input" placeholder="YYYY-MM" />
      </div>
      <div class="form-row">
        <label>股道</label>
        <select v-model.number="importMeta.trackNo" class="select">
          <option :value="1">下行（1 道）</option>
          <option :value="2">上行（2 道）</option>
        </select>
      </div>
      <div v-if="busy || progress" class="progress-text">{{ progress || '处理中…' }}</div>
    </div>

    <EmptyState
      v-if="state.batches.length === 0"
      icon="batch"
      title="暂无检测批次"
      sub="载入样例数据或导入检测车 CSV 后，这里会出现批次列表与对齐验收结果"
    />

    <div v-else class="card batch-table">
      <table class="table">
        <thead>
          <tr>
            <th>批次</th>
            <th>月份</th>
            <th>股道</th>
            <th>采样点</th>
            <th>最大漂移</th>
            <th>断点/跳变</th>
            <th>对齐残差</th>
            <th>超限(一/二级)</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in state.batches" :key="b.id">
            <td>{{ b.name }}</td>
            <td>{{ b.inspectDate }}</td>
            <td>{{ b.trackNo === 1 ? '下行' : '上行' }}</td>
            <td>{{ b.sampleCount.toLocaleString() }}</td>
            <td>{{ fmtM(b.driftMaxM) }}</td>
            <td>{{ b.alignmentReport.breakCount }} / {{ b.alignmentReport.jumpCount }}</td>
            <td>
              <span class="tag" :class="b.alignmentReport.pass05m ? 'tag-ok' : 'tag-l2'">
                最大 {{ b.alignmentReport.maxResidualM.toFixed(4) }}m
              </span>
            </td>
            <td>
              <span class="tag tag-l1">{{ b.exceedCounts.level1 }}</span>
              <span class="tag tag-l2">{{ b.exceedCounts.level2 }}</span>
            </td>
            <td>
              <div class="row-actions">
                <button class="btn" @click="detailBatch = b">对齐报告</button>
                <button class="btn btn-primary" @click="openReplay(b)">三维回放</button>
                <button class="btn btn-danger" @click="onDelete(b)">
                  <AppIcon name="trash" :size="15" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 对齐报告抽屉 -->
    <div v-if="detailBatch" class="drawer-mask" @click.self="detailBatch = null">
      <div class="card drawer">
        <div class="drawer-head">
          <h2>里程对齐报告 · {{ detailBatch.name }}</h2>
          <button class="btn" @click="detailBatch = null"><AppIcon name="close" :size="16" /></button>
        </div>
        <div class="report-grid">
          <div class="metric">
            <span class="metric-label">采样总行数</span>
            <span class="metric-val">{{ detailBatch.alignmentReport.totalRows.toLocaleString() }}</span>
          </div>
          <div class="metric">
            <span class="metric-label">过杆锚点</span>
            <span class="metric-val">
              {{ detailBatch.alignmentReport.matchedPoles }} / {{ detailBatch.alignmentReport.poleCount }}
            </span>
          </div>
          <div class="metric">
            <span class="metric-label">断点 / 跳变</span>
            <span class="metric-val">
              {{ detailBatch.alignmentReport.breakCount }} / {{ detailBatch.alignmentReport.jumpCount }}
            </span>
          </div>
          <div class="metric">
            <span class="metric-label">最大杆位残差</span>
            <span class="metric-val" :class="detailBatch.alignmentReport.pass05m ? 'ok' : 'bad'">
              {{ detailBatch.alignmentReport.maxResidualM.toFixed(4) }}m
            </span>
          </div>
          <div class="metric">
            <span class="metric-label">平均残差</span>
            <span class="metric-val">{{ detailBatch.alignmentReport.meanResidualM.toFixed(4) }}m</span>
          </div>
          <div class="metric">
            <span class="metric-label">0.5m 验收</span>
            <span class="tag" :class="detailBatch.alignmentReport.pass05m ? 'tag-ok' : 'tag-l2'">
              {{ detailBatch.alignmentReport.pass05m ? '通过' : '未通过' }}
            </span>
          </div>
        </div>

        <h3 class="section-title">断点与跳变事件</h3>
        <div class="event-list">
          <div v-for="(e, i) in detailBatch.alignmentReport.events.filter(x => x.type !== 'pole')" :key="i" class="event-row">
            <span class="tag" :class="e.type === 'break' ? 'tag-l2' : 'tag-l1'">{{ eventLabel[e.type] }}</span>
            <span>原始里程 {{ fmtMileage(e.rawMileage) }}</span>
            <span v-if="e.gapSize">缺口 {{ fmtM(e.gapSize) }}</span>
            <span v-if="e.supportCode">{{ e.supportCode }}</span>
          </div>
          <div v-if="detailBatch.alignmentReport.events.filter(x => x.type !== 'pole').length === 0" class="muted">
            本批次无断点或跳变
          </div>
        </div>

        <h3 class="section-title">杆位残差抽样（前 10 个锚点）</h3>
        <table class="table compact">
          <thead>
            <tr><th>杆号</th><th>档案里程</th><th>对齐后里程</th><th>残差(m)</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in detailBatch.alignmentReport.residuals.slice(0, 10)" :key="r.supportCode">
              <td>{{ r.supportCode }}</td>
              <td>{{ fmtMileage(r.archiveM) }}</td>
              <td>{{ fmtMileage(r.alignedM) }}</td>
              <td :class="Math.abs(r.residualM) >= 0.5 ? 'bad' : 'ok'">
                {{ r.residualM.toFixed(4) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--sp-5);
}
.head-actions {
  display: flex;
  gap: var(--sp-3);
}
.hint {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  margin-bottom: var(--sp-4);
  color: var(--c-warning);
}
.import-form {
  display: flex;
  align-items: flex-end;
  gap: var(--sp-4);
  padding: var(--sp-4);
  margin-bottom: var(--sp-5);
  flex-wrap: wrap;
}
.form-row {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.form-row label {
  color: var(--c-text-2);
}
.progress-text {
  color: var(--c-primary);
  font-weight: var(--fw-medium);
  align-self: center;
}
.row-actions {
  display: flex;
  gap: var(--sp-2);
}
.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  display: flex;
  justify-content: flex-end;
  z-index: 50;
}
.drawer {
  width: 640px;
  max-width: 92vw;
  height: 100%;
  border-radius: 0;
  overflow-y: auto;
  padding: var(--sp-5);
}
.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--sp-5);
}
.report-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--sp-3);
}
.metric {
  background: var(--c-surface-2);
  border-radius: var(--radius-sm);
  padding: var(--sp-3) var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.metric-label {
  color: var(--c-text-3);
}
.metric-val {
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
}
.ok {
  color: var(--c-success);
}
.bad {
  color: var(--c-danger);
}
.section-title {
  font-size: var(--fs-base);
  margin: var(--sp-5) 0 var(--sp-3);
}
.event-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.event-row {
  display: flex;
  gap: var(--sp-4);
  align-items: center;
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
}
.muted {
  color: var(--c-text-3);
}
.compact th,
.compact td {
  padding: var(--sp-2) var(--sp-3);
}
</style>
