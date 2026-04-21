<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  modelId: string
  size?: number
}>()

const modelSvgModules = import.meta.glob<{ default: string }>('/src/assets/models/*.svg', { eager: true })

const url = computed(() => {
  const mid = props.modelId.toLowerCase()
  for (const [path, mod] of Object.entries(modelSvgModules)) {
    const name = path.replace(/^.*\//, '').replace(/\.svg$/, '')
    if (mid.includes(name)) return mod.default
  }
  return null
})

const initial = computed(() => {
  const name = props.modelId.split('/').pop() || props.modelId
  return name.trim().charAt(0).toUpperCase()
})

const BUILT_IN_COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#BB8FCE', '#85C1E9', '#F39C12', '#27AE60']
const bgColor = computed(() => {
  let hash = 0
  for (const c of props.modelId) hash = (hash * 31 + c.charCodeAt(0)) & 0xFFFF
  return BUILT_IN_COLORS[hash % BUILT_IN_COLORS.length]
})
</script>

<template>
  <div class="model-icon" :style="{ width: `${size || 24}px`, height: `${size || 24}px` }">
    <img v-if="url" :src="url" class="model-icon-img" :alt="modelId" />
    <span v-else class="model-icon-fallback" :style="{ background: bgColor }">{{ initial }}</span>
  </div>
</template>

<style scoped>
.model-icon {
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f7;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}
.model-icon-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 2px;
}
.model-icon-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: white;
}
</style>
