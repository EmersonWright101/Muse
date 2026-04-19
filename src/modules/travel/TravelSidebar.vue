<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, Plus, MapPin } from 'lucide-vue-next'

const { t } = useI18n()

const selectedEntry = ref(1)
const searchQuery = ref('')

const entries = ref([
  { id: 1, title: '日本·东京', preview: '在新宿的街道上漫无目的地走着...', date: '2024-03', cover: '🗼' },
  { id: 2, title: '法国·巴黎', preview: '傍晚的埃菲尔铁塔在夕阳下发光...', date: '2023-09', cover: '🗽' },
  { id: 3, title: '美国·纽约', preview: '时代广场的霓虹灯让人目不暇接...', date: '2023-06', cover: '🌆' },
  { id: 4, title: '意大利·罗马', preview: '每一块石头都是一段历史...', date: '2023-04', cover: '🏛️' },
  { id: 5, title: '泰国·清迈', preview: '古城区的庙宇金光闪闪...', date: '2022-12', cover: '🌸' },
])
</script>

<template>
  <div class="travel-sidebar">
    <!-- Header -->
    <div class="panel-header">
      <h2 class="panel-title">{{ t('travel.title') }}</h2>
      <button class="icon-btn" :title="t('travel.newEntry')">
        <Plus :size="15" />
      </button>
    </div>

    <!-- Search -->
    <div class="search-bar">
      <Search :size="13" class="search-icon" />
      <input
        v-model="searchQuery"
        class="search-input"
        :placeholder="t('travel.search')"
        type="text"
      />
    </div>

    <!-- Entries list -->
    <div class="list-scroll">
      <div
        v-for="entry in entries"
        :key="entry.id"
        class="list-item"
        :class="{ active: selectedEntry === entry.id }"
        @click="selectedEntry = entry.id"
      >
        <div class="item-cover">{{ entry.cover }}</div>
        <div class="item-content">
          <div class="item-title">{{ entry.title }}</div>
          <div class="item-preview">{{ entry.preview }}</div>
          <div class="item-date">
            <MapPin :size="10" />
            {{ entry.date }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.travel-sidebar {
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: rgba(235, 235, 235, 0.85);
  backdrop-filter: blur(40px) saturate(1.8);
  -webkit-backdrop-filter: blur(40px) saturate(1.8);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.10), 0 0 0 0.5px rgba(255, 255, 255, 0.6) inset;
}

.panel-header {
  height: 52px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
  margin: 0;
}

.icon-btn {
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: #8e8e93;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.icon-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #3c3c43;
}

.search-bar {
  margin: 10px 12px 8px;
  height: 30px;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 8px;
  display: flex;
  align-items: center;
  padding: 0 10px;
  gap: 7px;
  flex-shrink: 0;
}

.search-icon {
  color: #8e8e93;
  flex-shrink: 0;
}

.search-input {
  border: none;
  background: transparent;
  color: #1c1c1e;
  font-size: 12px;
  width: 100%;
  outline: none;
}

.search-input::placeholder {
  color: #8e8e93;
}

.list-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 4px 6px 8px;
}

.list-scroll::-webkit-scrollbar {
  width: 4px;
}

.list-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.list-scroll::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.12);
  border-radius: 2px;
}

.list-item {
  padding: 10px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  gap: 10px;
  align-items: flex-start;
  transition: background 0.12s;
}

.list-item:hover {
  background: rgba(0, 0, 0, 0.05);
}

.list-item.active {
  background: rgba(34, 63, 121, 0.10);
}

.item-cover {
  font-size: 20px;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  background: rgba(120, 120, 128, 0.1);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.item-content {
  min-width: 0;
  flex: 1;
}

.item-title {
  font-size: 13px;
  font-weight: 500;
  color: #1c1c1e;
  margin-bottom: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.list-item.active .item-title {
  color: #223F79;
}

.item-preview {
  font-size: 11px;
  color: #8e8e93;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-date {
  font-size: 10px;
  color: #aeaeb2;
  display: flex;
  align-items: center;
  gap: 3px;
}
</style>
