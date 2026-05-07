<script setup lang="ts">
import { ref, computed } from 'vue'
import { useHomeStore } from '../../stores/home'
import { ChevronDown, Pencil, Trash2, Plus, RotateCcw, Check, X } from 'lucide-vue-next'

const home = useHomeStore()

const showList = ref(false)
const editingIndex = ref(-1)
const editZh = ref('')
const editEn = ref('')

const addMode = ref<'single' | 'bulk'>('single')
const showAddForm = ref(false)
const newZh = ref('')
const newEn = ref('')
const bulkText = ref('')

const bulkPreview = computed(() => {
  return bulkText.value
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const idx = line.indexOf(',')
      const zh = idx >= 0 ? line.slice(0, idx).trim() : line.trim()
      const en = idx >= 0 ? line.slice(idx + 1).trim() : ''
      return { zh, en, valid: zh.length > 0 && en.length > 0 }
    })
})

const bulkValidCount = computed(() => bulkPreview.value.filter(r => r.valid).length)

function startEdit(index: number) {
  editingIndex.value = index
  editZh.value = home.animals[index].zh
  editEn.value = home.animals[index].en
  showAddForm.value = false
}

function saveEdit(index: number) {
  home.updateAnimal(index, { zh: editZh.value, en: editEn.value })
  editingIndex.value = -1
}

function cancelEdit() {
  editingIndex.value = -1
}

function confirmAdd() {
  if (!newZh.value.trim() || !newEn.value.trim()) return
  home.addAnimal({ zh: newZh.value, en: newEn.value })
  newZh.value = ''
  newEn.value = ''
  showAddForm.value = false
}

function cancelAdd() {
  newZh.value = ''
  newEn.value = ''
  bulkText.value = ''
  showAddForm.value = false
}

function confirmBulkImport() {
  for (const row of bulkPreview.value) {
    if (row.valid) home.addAnimal({ zh: row.zh, en: row.en })
  }
  bulkText.value = ''
  showAddForm.value = false
}

function confirmReset() {
  home.resetAnimals()
}

function deleteAnimal(index: number) {
  if (editingIndex.value === index) editingIndex.value = -1
  home.deleteAnimal(index)
}
</script>

<template>
  <div class="animal-panel">
    <button class="panel-toggle" @click="showList = !showList">
      <span class="toggle-label">动物候选池</span>
      <div class="toggle-right">
        <span class="count-badge">{{ home.animals.length }} 种</span>
        <ChevronDown :size="14" :class="['chevron', { rotated: showList }]" />
      </div>
    </button>

    <div v-if="showList" class="panel-body">
      <div v-if="home.animals.length < 5" class="low-stock-hint">
        候选动物不足 5 种，建议添加新动物以避免重复生成。
      </div>
      <div class="panel-toolbar">
        <button class="toolbar-btn danger-text" @click="confirmReset">
          <RotateCcw :size="12" />
          重置默认
        </button>
      </div>

      <div class="animal-list">
        <div
          v-for="(animal, idx) in home.animals"
          :key="idx"
          class="animal-row"
          :class="{ editing: editingIndex === idx }"
        >
          <template v-if="editingIndex === idx">
            <input
              v-model="editZh"
              class="animal-input"
              placeholder="中文名"
              @keydown.enter="saveEdit(idx)"
              @keydown.escape="cancelEdit"
            />
            <input
              v-model="editEn"
              class="animal-input wide"
              placeholder="English name"
              @keydown.enter="saveEdit(idx)"
              @keydown.escape="cancelEdit"
            />
            <button class="row-action-btn confirm" @click="saveEdit(idx)">
              <Check :size="12" />
            </button>
            <button class="row-action-btn cancel" @click="cancelEdit">
              <X :size="12" />
            </button>
          </template>

          <template v-else>
            <span class="animal-zh">{{ animal.zh }}</span>
            <span class="animal-en">{{ animal.en }}</span>
            <div class="row-actions">
              <button class="row-action-btn edit" title="编辑" @click="startEdit(idx)">
                <Pencil :size="11" />
              </button>
              <button class="row-action-btn delete" title="删除" @click="deleteAnimal(idx)">
                <Trash2 :size="11" />
              </button>
            </div>
          </template>
        </div>
      </div>

      <template v-if="showAddForm">
        <div class="add-mode-tabs">
          <button
            class="add-mode-tab"
            :class="{ active: addMode === 'single' }"
            @click="addMode = 'single'"
          >单个添加</button>
          <button
            class="add-mode-tab"
            :class="{ active: addMode === 'bulk' }"
            @click="addMode = 'bulk'"
          >批量导入</button>
        </div>

        <div v-if="addMode === 'single'" class="animal-add-row">
          <input
            v-model="newZh"
            class="animal-input"
            placeholder="中文名"
            @keydown.enter="confirmAdd"
            @keydown.escape="cancelAdd"
          />
          <input
            v-model="newEn"
            class="animal-input wide"
            placeholder="English name for AI prompt"
            @keydown.enter="confirmAdd"
            @keydown.escape="cancelAdd"
          />
          <button
            class="row-action-btn confirm"
            :disabled="!newZh.trim() || !newEn.trim()"
            @click="confirmAdd"
          >
            <Check :size="12" />
          </button>
          <button class="row-action-btn cancel" @click="cancelAdd">
            <X :size="12" />
          </button>
        </div>

        <div v-else class="bulk-import-panel">
          <p class="bulk-hint">每行一个动物，中文名与英文名之间用逗号分隔：</p>
          <p class="bulk-example">例：<code>北极熊,Polar Bear</code></p>
          <textarea
            v-model="bulkText"
            class="bulk-textarea"
            placeholder="北极熊,Polar Bear&#10;东北虎,Amur Tiger&#10;宽吻海豚,Bottlenose Dolphin"
            rows="6"
          />
          <div class="bulk-preview-bar">
            <span v-if="bulkText.trim()" class="bulk-count">
              解析到 <strong>{{ bulkValidCount }}</strong> 条有效数据
              <template v-if="bulkPreview.length > bulkValidCount">
                （{{ bulkPreview.length - bulkValidCount }} 条格式有误已忽略）
              </template>
            </span>
            <div class="bulk-actions">
              <button class="bulk-btn secondary" @click="cancelAdd">取消</button>
              <button
                class="bulk-btn primary"
                :disabled="bulkValidCount === 0"
                @click="confirmBulkImport"
              >导入 {{ bulkValidCount > 0 ? bulkValidCount + ' 条' : '' }}</button>
            </div>
          </div>
        </div>
      </template>

      <button v-else class="add-animal-btn" @click="showAddForm = true; editingIndex = -1">
        <Plus :size="13" />
        添加动物
      </button>
    </div>
  </div>
</template>

<style scoped>
.animal-panel {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.panel-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.12s;
}

.panel-toggle:hover {
  background: rgba(255, 255, 255, 0.9);
}

.toggle-label {
  font-size: 13px;
  font-weight: 600;
  color: #3c3c43;
}

.toggle-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.count-badge {
  font-size: 11px;
  color: #8e8e93;
  background: rgba(0, 0, 0, 0.06);
  padding: 2px 8px;
  border-radius: 10px;
}

.chevron {
  color: #8e8e93;
  transition: transform 0.18s;
}

.chevron.rotated {
  transform: rotate(180deg);
}

.panel-body {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 0;
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  overflow: hidden;
}

.panel-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 8px 11px;
  background: rgba(0, 0, 0, 0.02);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.low-stock-hint {
  padding: 8px 11px;
  font-size: 12px;
  color: #ff9500;
  background: rgba(255, 149, 0, 0.08);
  border-bottom: 1px solid rgba(255, 149, 0, 0.15);
}

.toolbar-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  background: none;
  border: none;
  cursor: pointer;
  padding: 3px 6px;
  border-radius: 5px;
  transition: background 0.1s;
}

.toolbar-btn.danger-text {
  color: #ff3b30;
}

.toolbar-btn:hover {
  background: rgba(0, 0, 0, 0.06);
}

.animal-list {
  max-height: 320px;
  overflow-y: auto;
}

.animal-list::-webkit-scrollbar {
  width: 3px;
}

.animal-list::-webkit-scrollbar-track {
  background: transparent;
}

.animal-list::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.10);
  border-radius: 2px;
}

.animal-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 11px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  min-height: 36px;
  transition: background 0.1s;
}

.animal-row:last-child {
  border-bottom: none;
}

.animal-row:not(.editing):hover {
  background: rgba(0, 0, 0, 0.025);
}

.animal-row.editing {
  background: rgba(34, 63, 121, 0.04);
}

.animal-zh {
  font-size: 13px;
  color: #1c1c1e;
  font-weight: 500;
  width: 72px;
  flex-shrink: 0;
}

.animal-en {
  font-size: 12px;
  color: #8e8e93;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.12s;
}

.animal-row:hover .row-actions {
  opacity: 1;
}

.row-action-btn {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: none;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
  flex-shrink: 0;
}

.row-action-btn.edit {
  color: #8e8e93;
}

.row-action-btn.edit:hover {
  background: rgba(0, 0, 0, 0.07);
  color: #3c3c43;
}

.row-action-btn.delete {
  color: #8e8e93;
}

.row-action-btn.delete:hover {
  background: rgba(255, 59, 48, 0.08);
  color: #ff3b30;
}

.row-action-btn.confirm {
  color: #34c759;
}

.row-action-btn.confirm:hover {
  background: rgba(52, 199, 89, 0.10);
}

.row-action-btn.cancel {
  color: #8e8e93;
}

.row-action-btn.cancel:hover {
  background: rgba(0, 0, 0, 0.07);
}

.animal-input {
  height: 26px;
  padding: 0 7px;
  border-radius: 6px;
  border: 1px solid rgba(34, 63, 121, 0.25);
  background: white;
  font-size: 12px;
  color: #1c1c1e;
  outline: none;
  width: 76px;
  flex-shrink: 0;
}

.animal-input.wide {
  flex: 1;
  width: auto;
}

.animal-input:focus {
  border-color: rgba(34, 63, 121, 0.45);
}

.animal-add-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 11px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  background: rgba(34, 63, 121, 0.03);
}

.add-animal-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: 100%;
  padding: 9px 0;
  border: none;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  background: transparent;
  color: #223F79;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s;
}

.add-animal-btn:hover {
  background: rgba(34, 63, 121, 0.05);
}

.add-mode-tabs {
  display: flex;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  background: rgba(0, 0, 0, 0.02);
}

.add-mode-tab {
  flex: 1;
  padding: 7px 0;
  border: none;
  background: transparent;
  font-size: 12px;
  color: #8e8e93;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.12s, background 0.12s;
  border-bottom: 2px solid transparent;
}

.add-mode-tab.active {
  color: #223F79;
  background: rgba(34, 63, 121, 0.04);
  border-bottom-color: #223F79;
}

.bulk-import-panel {
  padding: 10px 11px 8px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bulk-hint {
  font-size: 12px;
  color: #3c3c43;
  margin: 0;
}

.bulk-example {
  font-size: 11px;
  color: #8e8e93;
  margin: 0;
}

.bulk-example code {
  background: rgba(0, 0, 0, 0.05);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: ui-monospace, 'SF Mono', Menlo, Monaco, monospace;
}

.bulk-textarea {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: white;
  font-size: 12px;
  color: #1c1c1e;
  font-family: ui-monospace, 'SF Mono', Menlo, Monaco, monospace;
  line-height: 1.7;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}

.bulk-textarea:focus {
  border-color: rgba(34, 63, 121, 0.35);
}

.bulk-preview-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 28px;
  gap: 8px;
}

.bulk-count {
  font-size: 11px;
  color: #8e8e93;
  flex: 1;
}

.bulk-count strong {
  color: #34c759;
  font-weight: 600;
}

.bulk-actions {
  display: flex;
  gap: 6px;
}

.bulk-btn {
  padding: 5px 14px;
  border-radius: 8px;
  border: none;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.12s, background 0.12s;
}

.bulk-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.bulk-btn.secondary {
  background: rgba(0, 0, 0, 0.06);
  color: #3c3c43;
}

.bulk-btn.secondary:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.10);
}

.bulk-btn.primary {
  background: rgba(34, 63, 121, 0.10);
  color: #223F79;
}

.bulk-btn.primary:hover:not(:disabled) {
  background: rgba(34, 63, 121, 0.18);
}
</style>
