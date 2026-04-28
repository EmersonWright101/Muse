<template>
  <div class="mermaid-block">
    <div v-if="status === 'pending'" class="mermaid-loading">渲染图表中…</div>
    <div v-else-if="status === 'done'" class="mermaid-svg-wrap" v-html="svgHtml" />
    <pre v-else class="mermaid-error">{{ src }}</pre>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'

const props = defineProps<{ src: string; streaming?: boolean }>()

const status  = ref<'pending' | 'done' | 'error'>('pending')
const svgHtml = ref('')
let   rendered = false

// Singleton: reuse the same initialized mermaid instance across all blocks.
type MermaidMod = typeof import('mermaid').default
let _mermaid: MermaidMod | null = null
async function loadMermaid(): Promise<MermaidMod> {
  if (!_mermaid) {
    const mod = await import('mermaid')
    _mermaid = mod.default
    _mermaid.initialize({ startOnLoad: false, theme: 'neutral', fontFamily: '"Helvetica Neue", Arial, sans-serif' })
  }
  return _mermaid
}

async function tryRender() {
  if (props.streaming || rendered) return
  try {
    const m = await loadMermaid()
    // Off-screen stage with real pixel dimensions prevents mermaid from hanging
    // on getBoundingClientRect / getComputedStyle calls inside the rendering pipeline.
    const stage = document.createElement('div')
    stage.style.cssText = 'position:fixed;top:0;left:-9999px;width:900px;height:600px;overflow:hidden;visibility:hidden;pointer-events:none'
    document.body.appendChild(stage)
    const id = 'mermaid-blk-' + Math.random().toString(36).slice(2, 10)
    try {
      const { svg } = await Promise.race([
        m.render(id, props.src, stage),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('渲染超时')), 10_000)),
      ])
      rendered  = true
      svgHtml.value = svg
      status.value  = 'done'
    } finally {
      stage.remove()
      document.getElementById(id)?.remove()
    }
  } catch {
    status.value = 'error'
  }
}

onMounted(tryRender)
watch(() => props.streaming, s => { if (!s) tryRender() })
</script>

<style scoped>
.mermaid-block {
  margin: 12px 0;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.025);
  padding: 16px;
  overflow-x: auto;
}
.mermaid-loading {
  color: rgba(0,0,0,0.4);
  font-size: 13px;
  padding: 8px 0;
}
.mermaid-svg-wrap :deep(svg) {
  max-width: 100%;
  height: auto;
  display: block;
}
.mermaid-error {
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 12px;
  color: #c0392b;
  background: rgba(192,57,43,0.06);
  border-radius: 6px;
  padding: 10px;
  margin: 0;
}
</style>
