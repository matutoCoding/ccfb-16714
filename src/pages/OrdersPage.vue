<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import { verifyOrderAgainstBatch } from '@/core/verify'
import { loadSamples, putBatch, putWorkOrder, updateExceed } from '@/db/idb'
import { refreshAll, state } from '@/store/app'
import { fmtMileage } from '@/utils/format'
import type { WorkOrder } from '@/types'

const statusFilter = ref<'all' | WorkOrder['status']>('all')
const handlingOrder = ref<WorkOrder | null>(null)
const handleResult = ref('')
const verifyTarget = ref<WorkOrder | null>(null)
const verifyMessage = ref('')

const filteredOrders = computed(() =>
  statusFilter.value === 'all'
    ? state.workOrders
    : state.workOrders.filter((o) => o.status === statusFilter.value),
)

const batchName = (id: string) => state.batches.find((b) => b.id === id)?.name ?? '批次已删除'

const statusMeta: Record<WorkOrder['status'], { label: string; cls: string }> = {
  pending: { label: '待处理', cls: 'tag-l1' },
  processing: { label: '处理中', cls: 'tag-info' },
  done: { label: '已处理待复核', cls: 'tag-info' },
  verified: { label: '复核闭环', cls: 'tag-ok' },
}

const submitHandle = async () => {
  const order = handlingOrder.value
  if (!order || !handleResult.value.trim()) return
  await putWorkOrder({
    ...order,
    status: 'done',
    handledAt: Date.now(),
    handleResult: handleResult.value.trim(),
  })
  handlingOrder.value = null
  handleResult.value = ''
  await refreshAll()
}

// 选择较新批次进行复核
const newerBatches = computed(() => {
  if (!verifyTarget.value) return []
  const source = state.batches.find((b) => b.id === verifyTarget.value!.batchId)
  if (!source) return []
  return state.batches.filter(
    (b) =>
      b.trackNo === verifyTarget.value!.trackNo &&
      b.inspectDate > source.inspectDate,
  )
})

const runVerify = async (batchId: string) => {
  const order = verifyTarget.value
  if (!order) return
  const batch = state.batches.find((b) => b.id === batchId)
  if (!batch) return
  const samples = await loadSamples(batchId)
  const result = await verifyOrderAgainstBatch(order, batch, samples)
  verifyMessage.value = result.fixed
    ? `复核通过：${batch.inspectDate} 检测值 ${result.currentValue.toFixed(1)}mm 已回到限界 ${result.limitValue}mm 内`
    : `复核未通过：${batch.inspectDate} 检测值 ${result.currentValue.toFixed(1)}mm 仍超 ${result.limitValue}mm 限界`

  if (result.fixed) {
    await putWorkOrder({
      ...order,
      status: 'verified',
      verifiedBatchId: batchId,
      verifiedAt: Date.now(),
      verifyNote: verifyMessage.value,
    })
    const exceed = state.exceeds.find((e) => e.id === order.exceedId)
    if (exceed) await updateExceed({ ...exceed, status: 'verified' })
    const batchRef = state.batches.find((b) => b.id === batchId)
    if (batchRef) {
      batchRef.verifiedFixed += 1
      await putBatch(batchRef)
    }
    await refreshAll()
  }
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1 class="page-title">维修工单</h1>
        <p class="page-sub">超限点派单、处理登记，下次检测自动核对修复效果</p>
      </div>
    </header>

    <div class="card filter-bar">
      <div class="filter-group">
        <button class="btn" :class="{ 'btn-primary': statusFilter === 'all' }" @click="statusFilter = 'all'">全部</button>
        <button class="btn" :class="{ 'btn-primary': statusFilter === 'pending' }" @click="statusFilter = 'pending'">待处理</button>
        <button class="btn" :class="{ 'btn-primary': statusFilter === 'done' }" @click="statusFilter = 'done'">待复核</button>
        <button class="btn" :class="{ 'btn-primary': statusFilter === 'verified' }" @click="statusFilter = 'verified'">已闭环</button>
      </div>
    </div>

    <EmptyState v-if="filteredOrders.length === 0" icon="tool" title="暂无工单" sub="在超限管理页对超限点派单后，这里会生成维修工单" />

    <div v-else class="card">
      <table class="table">
        <thead>
          <tr>
            <th>状态</th>
            <th>级别</th>
            <th>问题</th>
            <th>里程/杆号</th>
            <th>来源批次</th>
            <th>处理结果</th>
            <th>复核信息</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in filteredOrders" :key="o.id">
            <td><span class="tag" :class="statusMeta[o.status].cls">{{ statusMeta[o.status].label }}</span></td>
            <td><span class="tag" :class="o.level === 2 ? 'tag-l2' : 'tag-l1'">{{ o.level }} 级</span></td>
            <td>{{ o.metric === 'height' ? '导高' : '拉出' }}超限</td>
            <td>{{ fmtMileage(o.mileage) }}<br /><span class="muted">{{ o.supportCode }}</span></td>
            <td>{{ batchName(o.batchId) }}</td>
            <td class="result-cell">{{ o.handleResult ?? '—' }}</td>
            <td class="result-cell">{{ o.verifyNote ?? '—' }}</td>
            <td>
              <div class="row-actions">
                <button class="btn btn-primary" :disabled="o.status === 'verified'" @click="handlingOrder = o; handleResult = o.handleResult ?? ''">
                  登记处理
                </button>
                <button class="btn" :disabled="o.status !== 'done'" @click="verifyTarget = o; verifyMessage = ''">
                  <AppIcon name="check" :size="15" /> 复核
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 处理登记弹窗 -->
    <div v-if="handlingOrder" class="modal-mask" @click.self="handlingOrder = null">
      <div class="card modal">
        <h3>登记处理结果</h3>
        <p class="muted">{{ handlingOrder.description }}</p>
        <textarea
          v-model="handleResult"
          class="input textarea"
          rows="4"
          placeholder="记录处理措施，如：调整定位器位置、更换吊弦、复测导高…"
        />
        <div class="modal-actions">
          <button class="btn" @click="handlingOrder = null">取消</button>
          <button class="btn btn-primary" :disabled="!handleResult.trim()" @click="submitHandle">保存</button>
        </div>
      </div>
    </div>

    <!-- 复核弹窗 -->
    <div v-if="verifyTarget" class="modal-mask" @click.self="verifyTarget = null">
      <div class="card modal">
        <h3>选择复核批次</h3>
        <p class="muted">
          系统将在所选批次的同里程位置读取最新检测值，与一级限界自动比对
        </p>
        <div v-if="newerBatches.length === 0" class="muted">没有比来源批次更新的同股道检测数据</div>
        <div class="batch-options">
          <button
            v-for="b in newerBatches"
            :key="b.id"
            class="btn batch-option"
            @click="runVerify(b.id)"
          >
            {{ b.name }} · {{ b.inspectDate }}
          </button>
        </div>
        <p v-if="verifyMessage" class="verify-msg" :class="verifyMessage.includes('通过') ? 'ok' : 'bad'">
          {{ verifyMessage }}
        </p>
        <div class="modal-actions">
          <button class="btn" @click="verifyTarget = null">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-head {
  margin-bottom: var(--sp-5);
}
.filter-bar {
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
.result-cell {
  max-width: 240px;
  color: var(--c-text-2);
}
.muted {
  color: var(--c-text-3);
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
}
.modal {
  width: 520px;
  padding: var(--sp-5);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.textarea {
  resize: vertical;
  font-family: inherit;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-3);
}
.batch-options {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.batch-option {
  justify-content: flex-start;
}
.verify-msg {
  padding: var(--sp-3);
  border-radius: var(--radius-sm);
}
.verify-msg.ok {
  color: var(--c-success);
  background: var(--c-success-soft);
}
.verify-msg.bad {
  color: var(--c-danger);
  background: var(--c-danger-soft);
}
.ok {
  color: var(--c-success);
}
.bad {
  color: var(--c-danger);
}
</style>
