<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import { refreshAll, state } from '@/store/app'

const route = useRoute()

const navItems = [
  { path: '/batches', icon: 'batch', label: '检测批次' },
  { path: '/archive', icon: 'archive', label: '线路档案' },
  { path: '/replay', icon: 'cube', label: '三维回放' },
  { path: '/exceeds', icon: 'warning', label: '超限管理' },
  { path: '/trend', icon: 'trend', label: '趋势对比' },
  { path: '/orders', icon: 'tool', label: '维修工单' },
  { path: '/settings', icon: 'settings', label: '设置' },
]

onMounted(refreshAll)
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">
          <AppIcon name="anchor" :size="20" />
        </div>
        <div class="brand-text">
          <div class="brand-name">接触网检测工作台</div>
          <div class="brand-sub">几何参数回放与三维核查</div>
        </div>
      </div>

      <nav class="nav">
        <RouterLink
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :class="{ active: route.path === item.path }"
        >
          <AppIcon :name="item.icon" :size="18" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="sidebar-foot">
        <div v-if="state.archive" class="foot-line">
          <span class="foot-label">线路</span>
          <span>{{ state.archive.lineName }}</span>
        </div>
        <div class="foot-line">
          <span class="foot-label">批次</span>
          <span>{{ state.batches.length }} 个</span>
        </div>
      </div>
    </aside>

    <main class="content">
      <RouterView v-if="state.ready" />
      <div v-else class="loading">正在载入本地数据…</div>
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100%;
}
.sidebar {
  width: 224px;
  flex-shrink: 0;
  background: var(--c-surface);
  border-right: 1px solid var(--c-border);
  display: flex;
  flex-direction: column;
  padding: var(--sp-5) var(--sp-3);
}
.brand {
  display: flex;
  gap: var(--sp-3);
  align-items: center;
  padding: 0 var(--sp-2) var(--sp-5);
  border-bottom: 1px solid var(--c-border);
}
.brand-mark {
  width: 38px;
  height: 38px;
  border-radius: var(--radius);
  background: var(--c-primary-soft);
  color: var(--c-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}
.brand-name {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
}
.brand-sub {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  margin-top: 2px;
}
.nav {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding: var(--sp-4) 0;
  flex: 1;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-3);
  border-radius: var(--radius-sm);
  color: var(--c-text-2);
  text-decoration: none;
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  transition: background var(--t-fast), color var(--t-fast);
}
.nav-item:hover {
  background: var(--c-surface-2);
  color: var(--c-text);
}
.nav-item.active {
  background: var(--c-primary-soft);
  color: var(--c-primary);
}
.sidebar-foot {
  border-top: 1px solid var(--c-border);
  padding-top: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}
.foot-line {
  display: flex;
  justify-content: space-between;
  padding: 0 var(--sp-2);
}
.foot-label {
  color: var(--c-text-3);
}
.content {
  flex: 1;
  overflow: auto;
  padding: var(--sp-6);
}
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--c-text-3);
}
</style>
