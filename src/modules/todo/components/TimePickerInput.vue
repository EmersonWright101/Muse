<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted } from 'vue'
import { ChevronDown } from 'lucide-vue-next'

const props = defineProps<{ modelValue: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [v: string | null] }>()

const showDropdown = ref(false)
const listRef = ref<HTMLElement | null>(null)
const wrapRef = ref<HTMLElement | null>(null)

const TIME_OPTIONS: string[] = []
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 5) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }
}

function handleInput(e: Event) {
  const v = (e.target as HTMLInputElement).value
  emit('update:modelValue', v || null)
}

async function toggleDropdown() {
  showDropdown.value = !showDropdown.value
  if (showDropdown.value) {
    await nextTick()
    scrollToCurrentTime()
  }
}

function scrollToCurrentTime() {
  if (!listRef.value) return
  let idx = 0
  if (props.modelValue) {
    const found = TIME_OPTIONS.indexOf(props.modelValue)
    if (found !== -1) {
      idx = found
    } else {
      const [h, m] = props.modelValue.split(':').map(Number)
      idx = Math.round((h * 60 + m) / 5)
    }
  } else {
    const now = new Date()
    idx = Math.round((now.getHours() * 60 + now.getMinutes()) / 5)
  }
  const items = listRef.value.querySelectorAll('.tpi-option')
  const item = items[Math.min(idx, items.length - 1)] as HTMLElement
  item?.scrollIntoView({ block: 'center' })
}

function selectTime(t: string) {
  emit('update:modelValue', t)
  showDropdown.value = false
}

function onClickOutside(e: MouseEvent) {
  if (wrapRef.value && !wrapRef.value.contains(e.target as Node)) {
    showDropdown.value = false
  }
}

onMounted(() => document.addEventListener('mousedown', onClickOutside))
onUnmounted(() => document.removeEventListener('mousedown', onClickOutside))
</script>

<template>
  <div class="tpi-wrap" ref="wrapRef">
    <input
      type="text"
      class="tpi-input"
      :value="modelValue ?? ''"
      placeholder="--:--"
      @input="handleInput"
    />
    <button class="tpi-chevron" type="button" @click="toggleDropdown">
      <ChevronDown :size="11" />
    </button>
    <div v-if="showDropdown" class="tpi-dropdown" ref="listRef">
      <div
        v-for="t in TIME_OPTIONS"
        :key="t"
        class="tpi-option"
        :class="{ selected: t === modelValue }"
        @mousedown.prevent="selectTime(t)"
      >
        {{ t }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.tpi-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  border: 1px solid rgba(0, 0, 0, 0.10);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.02);
}

.tpi-input {
  border: none;
  background: transparent;
  font-size: 12px;
  color: #1c1c1e;
  outline: none;
  padding: 3px 4px 3px 7px;
  width: 52px;
}

.tpi-input::placeholder {
  color: #c7c7cc;
}

.tpi-chevron {
  border: none;
  background: transparent;
  color: #8e8e93;
  cursor: pointer;
  padding: 3px 5px;
  display: flex;
  align-items: center;
  border-left: 1px solid rgba(0, 0, 0, 0.06);
}

.tpi-chevron:hover {
  color: #1c1c1e;
}

.tpi-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 200;
  background: white;
  border: 1px solid rgba(0, 0, 0, 0.10);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
  width: 90px;
  max-height: 200px;
  overflow-y: auto;
  padding: 4px;
}

.tpi-option {
  padding: 4px 8px;
  font-size: 12px;
  color: #1c1c1e;
  cursor: pointer;
  border-radius: 4px;
  user-select: none;
}

.tpi-option:hover {
  background: rgba(0, 0, 0, 0.05);
}

.tpi-option.selected {
  background: rgba(34, 63, 121, 0.10);
  color: #223F79;
  font-weight: 500;
}
</style>
