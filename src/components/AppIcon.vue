<script setup lang="ts">
// 统一线框图标（1.7 线宽、圆角端点、currentColor 继承）
const props = defineProps<{ name: string; size?: number }>()

const paths: Record<string, string> = {
  batch: 'M4 7h16M4 12h16M4 17h10',
  archive: 'M5 4h11l3 3v13H5zM5 4v16M9 9h6M9 13h6M9 17h4',
  cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 3v9m0 0l8-4.5M12 12L4 7.5',
  warning: 'M12 4l9 16H3zM12 10v4M12 17.5v.5',
  trend: 'M4 17l5-5 4 4 7-8M16 8h4v4',
  tool: 'M14 6a4 4 0 015 5l-9 9-5-5 9-9zM7 14l3 3',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 00-1.7-1L14.5 3h-5l-.4 2.6a7 7 0 00-1.7 1l-2.3-1-2 3.4 2 1.5a7 7 0 000 2l-2 1.5 2 3.4 2.3-1a7 7 0 001.7 1l.4 2.6h5l.4-2.6a7 7 0 001.7-1l2.3 1 2-3.4-2-1.5c.1-.3.1-.7.1-1z',
  play: 'M8 5v14l11-7z',
  pause: 'M8 5v14M16 5v14',
  upload: 'M12 16V4m0 0L8 8m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3',
  download: 'M12 4v12m0 0l-4-4m4 4l4-4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3',
  locate: 'M12 21s7-6.5 7-12a7 7 0 10-14 0c0 5.5 7 12 7 12zM12 12a3 3 0 100-6 3 3 0 000 6z',
  refresh: 'M20 11a8 8 0 10-2 6M20 5v6h-6',
  trash: 'M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13M10 11v5M14 11v5',
  check: 'M5 13l4 4L19 7',
  close: 'M6 6l12 12M18 6L6 18',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  tunnel: 'M4 20V10a8 8 0 0116 0v10M4 20h16M8 20v-6h8v6M12 7v3',
  anchor: 'M12 8a2 2 0 100-4 2 2 0 000 4zM12 22V8M5 12H3m18 0h-2M7 18l-2-2m12 2l2-2',
  curve: 'M4 20c8 0 8-16 16-16M4 20h4m-4 0v-4',
}
</script>

<template>
  <svg
    :width="props.size ?? 18"
    :height="props.size ?? 18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[props.name] ?? ''" />
  </svg>
</template>
