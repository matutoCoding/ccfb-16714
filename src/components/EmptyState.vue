<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'

defineProps<{ icon: string; title: string; sub?: string }>()
</script>

<template>
  <div class="empty-state">
    <div class="empty-icon">
      <AppIcon :name="icon" :size="26" />
    </div>
    <div class="empty-title">{{ title }}</div>
    <div v-if="sub">{{ sub }}</div>
  </div>
</template>
