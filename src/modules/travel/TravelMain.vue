<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { MapPin, LayoutList } from 'lucide-vue-next'
import { useTravelStore } from '../../stores/travel'
import TravelMap from './components/TravelMap.vue'
import TravelEditor from './components/TravelEditor.vue'

const { t } = useI18n()
const store = useTravelStore()

const hasActive = computed(() => !!store.activeNoteId)
</script>

<template>
  <div class="travel-main">
    <!-- Floating view toggle (visible only in map mode) -->
    <div v-if="store.viewMode === 'map'" class="floating-toggle">
      <button
        class="toggle-btn"
        :class="{ active: store.viewMode === 'map' }"
        @click="store.viewMode = 'map'"
      >
        <MapPin :size="14" />
        {{ t('travel.mapView') }}
      </button>
      <button
        class="toggle-btn"
        :class="{ active: store.viewMode === 'editor' }"
        @click="store.viewMode = 'editor'"
      >
        <LayoutList :size="14" />
        {{ t('travel.editorView') }}
      </button>
    </div>

    <!-- Content -->
    <div class="travel-content">
      <TravelMap
        v-if="store.viewMode === 'map'"
        :notes="store.notes"
        :active-note-id="store.activeNoteId"
        @select="store.openNote"
      />
      <div v-else-if="!hasActive" class="placeholder-state">
        <div class="placeholder-icon">
          <MapPin :size="40" />
        </div>
        <p class="placeholder-text">{{ t('travel.placeholder') }}</p>
      </div>
      <TravelEditor v-else />
    </div>
  </div>
</template>

<style scoped>
.travel-main {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  position: relative;
}

/* Floating toggle */
.floating-toggle {
  position: fixed;
  top: 56px;
  left: calc(50% + 38px);
  transform: translateX(-50%);
  z-index: 900;
  display: flex;
  gap: 2px;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(20px) saturate(1.6);
  -webkit-backdrop-filter: blur(20px) saturate(1.6);
  border-radius: 8px;
  padding: 3px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.10), 0 0 0 0.5px rgba(0, 0, 0, 0.06) inset;
}

.toggle-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  border: none;
  background: transparent;
  color: #8e8e93;
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.12s;
  font-weight: 500;
}

.toggle-btn.active {
  background: white;
  color: #1c1c1e;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.10);
}

.placeholder-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
}

.placeholder-icon {
  color: #c7c7cc;
}

.placeholder-text {
  font-size: 14px;
  color: #aeaeb2;
  margin: 0;
}

/* Content */
.travel-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
