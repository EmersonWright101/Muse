<script setup lang="ts">
import { computed, reactive } from 'vue'
import { useRoute } from 'vue-router'
import {
  FileText, FunctionSquare, Type, Sigma, Film, Eraser,
  Printer, Layers, BookMarked, GraduationCap, Palette, GitCompare,
  BarChart2, Table2, ArrowLeftRight, QrCode, ChevronRight
} from 'lucide-vue-next'

const route = useRoute()

const menuGroups = computed(() => [
  {
    id: 'text',
    label: '文本处理',
    icon: FileText,
    children: [
      { path: '/tools/text/case-converter', label: '大小写转换', icon: Type },
      { path: '/tools/text/diff', label: '文本对比', icon: GitCompare },
      { path: '/tools/text/stats', label: '文本统计', icon: BarChart2 },
    ]
  },
  {
    id: 'paper',
    label: '论文工具',
    icon: GraduationCap,
    children: [
      { path: '/tools/paper/bibtex', label: 'BibTeX 转换', icon: BookMarked },
      { path: '/tools/paper/format-converter', label: '格式转换', icon: ArrowLeftRight },
      { path: '/tools/paper/color', label: '论文配色', icon: Palette },
    ]
  },
  {
    id: 'latex',
    label: '数学工具',
    icon: FunctionSquare,
    children: [
      { path: '/tools/latex/latex2png', label: 'LaTeX转图片', icon: Sigma },
      { path: '/tools/latex/table', label: '表格生成器', icon: Table2 },
    ]
  },
  {
    id: 'media',
    label: '媒体处理',
    icon: Film,
    children: [
      { path: '/tools/media/remove-bg', label: '移除背景', icon: Eraser },
    ]
  },
  {
    id: 'misc',
    label: '杂项',
    icon: Layers,
    children: [
      { path: '/tools/misc/printer', label: '打印', icon: Printer },
      { path: '/tools/misc/qrcode', label: '二维码', icon: QrCode },
    ]
  }
])

const collapsedGroups = reactive<Record<string, boolean>>({
  text: false,
  paper: false,
  latex: false,
  media: false,
  misc: false,
})

function toggleGroup(id: string) {
  collapsedGroups[id] = !collapsedGroups[id]
}

const isActive = (path: string) => route.path === path || route.path.startsWith(path + '/')

function hasActiveChild(group: typeof menuGroups.value[0]): boolean {
  return group.children.some(c => isActive(c.path))
}
</script>

<template>
  <div class="tools-sidebar">
    <div class="panel-header">
      <h2 class="panel-title">工具箱</h2>
    </div>

    <div class="list-scroll">
      <div
        v-for="group in menuGroups"
        :key="group.id"
        class="group"
        :class="{ 'has-active': hasActiveChild(group) }"
      >
        <button class="group-header" @click="toggleGroup(group.id)">
          <div class="group-header-left">
            <component :is="group.icon" :size="15" class="group-icon" />
            <span class="group-label">{{ group.label }}</span>
          </div>
          <ChevronRight
            :size="14"
            class="group-chevron"
            :class="{ rotated: !collapsedGroups[group.id] }"
          />
        </button>

        <div
          class="group-children"
          :class="{ collapsed: collapsedGroups[group.id] }"
        >
          <router-link
            v-for="item in group.children"
            :key="item.path"
            :to="item.path"
            class="list-item"
            :class="{ active: isActive(item.path) }"
          >
            <component :is="item.icon" :size="14" class="item-icon" />
            <span class="item-label">{{ item.label }}</span>
          </router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tools-sidebar {
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: rgba(228, 228, 232, 0.88);
  backdrop-filter: blur(40px) saturate(1.8);
  -webkit-backdrop-filter: blur(40px) saturate(1.8);
  border-radius: 24px;
  overflow: hidden;
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.10), 0 0 0 0.5px rgba(255, 255, 255, 0.6) inset;
}

.panel-header {
  height: 48px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
  margin: 0;
}

.list-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 10px 8px;
}

.list-scroll::-webkit-scrollbar { width: 4px; }
.list-scroll::-webkit-scrollbar-track { background: transparent; }
.list-scroll::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.10); border-radius: 2px; }

.group {
  margin-bottom: 2px;
}

.group-header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: background 0.12s;
  user-select: none;
}

.group-header:hover {
  background: rgba(0, 0, 0, 0.05);
}

.group-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.group-icon {
  color: #6e6e73;
  flex-shrink: 0;
}

.group-label {
  font-size: 13px;
  font-weight: 600;
  color: #3c3c43;
}

.group-chevron {
  color: #8e8e93;
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.group-chevron.rotated {
  transform: rotate(90deg);
}

.group-children {
  display: flex;
  flex-direction: column;
  padding: 1px 0 3px 6px;
  overflow: hidden;
  transition: max-height 0.25s ease, opacity 0.2s ease;
  max-height: 300px;
  opacity: 1;
}

.group-children.collapsed {
  max-height: 0;
  opacity: 0;
  padding: 0 0 0 6px;
}

.list-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 8px;
  cursor: pointer;
  text-decoration: none;
  transition: background 0.12s;
  margin-bottom: 1px;
}

.list-item:hover {
  background: rgba(0, 0, 0, 0.05);
}

.list-item.active {
  background: rgba(34, 63, 121, 0.10);
}

.item-icon {
  color: #8e8e93;
  flex-shrink: 0;
}

.list-item.active .item-icon {
  color: #223F79;
}

.item-label {
  font-size: 13px;
  color: #3c3c43;
}

.list-item.active .item-label {
  color: #223F79;
  font-weight: 500;
}
</style>
