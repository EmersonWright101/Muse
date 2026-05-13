<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Settings, FileText, Calendar, Trash2,
  RefreshCw, Play, AlertCircle, ChevronDown, ChevronUp,
  Bot, Coins, Clock,
} from 'lucide-vue-next'
import { useAiSettingsStore } from '../../../stores/aiSettings'
import {
  getSummaryPushSettings,
  saveSummaryPushSettings,
  getSummaryReports,
  deleteSummaryReport,
  triggerSummary,
  type SummaryPushConfig,
  type SummaryReport,
} from '../../../services/summaryPush'

const ai = useAiSettingsStore()
const { t } = useI18n()

const config = ref<SummaryPushConfig>({
  daily_enabled: true,
  daily_time: '23:30',
  weekly_enabled: true,
  weekly_day: 0,
  weekly_time: '23:30',
  provider_id: '',
  model_id: '',
  timezone: 'Asia/Shanghai',
})

const reports = ref<SummaryReport[]>([])
const loading = ref(false)
const saving = ref(false)
const generating = ref(false)
const error = ref<string | null>(null)
const historyTab = ref<'daily' | 'weekly'>('daily')
const expandedReportId = ref<string | null>(null)
const generatedReport = ref<SummaryReport | null>(null)

const availableProviders = computed(() =>
  ai.providers.filter(p => p.enabled && p.apiKey)
)

const availableModels = computed(() => {
  const p = ai.providers.find(x => x.id === config.value.provider_id)
  return p?.models ?? []
})

watch(() => config.value.provider_id, (pid) => {
  const p = ai.providers.find(x => x.id === pid)
  if (p && !p.models.find(m => m.id === config.value.model_id)) {
    config.value.model_id = p.models[0]?.id ?? ''
  }
})

const filteredReports = computed(() =>
  reports.value.filter(r => r.type === historyTab.value)
)

const kpiCards = computed(() => {
  const daily = reports.value.filter(r => r.type === 'daily').length
  const weekly = reports.value.filter(r => r.type === 'weekly').length
  const totalTokens = reports.value.reduce((s, r) => s + r.tokens_input + r.tokens_output, 0)
  const totalCost = reports.value.reduce((s, r) => s + r.cost_usd, 0)
  return [
    { label: '日报总数', value: daily, icon: FileText, accent: true },
    { label: '周报总数', value: weekly, icon: Calendar, accent: false },
    { label: '总 Token', value: totalTokens, icon: Bot, accent: false },
    { label: '总成本', value: `$${totalCost.toFixed(4)}`, icon: Coins, accent: false },
  ]
})

async function loadSettings() {
  try {
    const data = await getSummaryPushSettings()
    if (data) {
      config.value = data
    }
  } catch (e) {
    showError('加载设置失败')
  }
}

async function loadReports() {
  try {
    const data = await getSummaryReports()
    if (data) {
      reports.value = data.items
    }
  } catch (e) {
    showError('加载历史记录失败')
  }
}

async function load() {
  loading.value = true
  error.value = null
  await Promise.all([loadSettings(), loadReports()])
  loading.value = false
}

async function saveSettings() {
  saving.value = true
  error.value = null
  try {
    await saveSummaryPushSettings(config.value)
  } catch (e) {
    showError('保存设置失败')
  } finally {
    saving.value = false
  }
}

async function refreshReports() {
  loading.value = true
  await loadReports()
  loading.value = false
}

async function removeReport(id: string) {
  try {
    await deleteSummaryReport(id)
    reports.value = reports.value.filter(r => r.id !== id)
    if (expandedReportId.value === id) {
      expandedReportId.value = null
    }
  } catch (e) {
    showError('删除失败')
  }
}

async function generateSummary(type: 'daily' | 'weekly') {
  generating.value = true
  error.value = null
  generatedReport.value = null
  try {
    const result = await triggerSummary(type)
    generatedReport.value = result.report
    await loadReports()
  } catch (e) {
    showError('生成失败')
  } finally {
    generating.value = false
  }
}

function toggleExpand(id: string) {
  expandedReportId.value = expandedReportId.value === id ? null : id
}

function showError(msg: string) {
  error.value = msg
  setTimeout(() => { error.value = null }, 4000)
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

onMounted(load)
</script>

<template>
  <div class="summary-push-tab">
    <template v-if="loading && !reports.length && !config.provider_id">
      <div class="loading-state">{{ t('common.loading') }}</div>
    </template>
    <template v-else>
      <!-- KPI row -->
      <div class="kpi-row four">
        <div
          v-for="card in kpiCards"
          :key="card.label"
          class="kpi-card"
          :class="{ accent: card.accent }"
        >
          <div class="kpi-icon">
            <component :is="card.icon" :size="18" />
          </div>
          <div class="kpi-value">{{ card.value }}</div>
          <div class="kpi-label">{{ card.label }}</div>
        </div>
      </div>

      <!-- Error toast -->
      <div v-if="error" class="error-toast">
        <AlertCircle :size="14" />
        <span>{{ error }}</span>
      </div>

      <!-- Generated result -->
      <div v-if="generatedReport" class="dash-card result-card">
        <div class="dash-section-title">生成结果</div>
        <div class="report-meta">
          <span class="report-type">{{ generatedReport.type === 'daily' ? '日报' : '周报' }}</span>
          <span class="report-date">{{ generatedReport.date }}</span>
          <span class="report-model">{{ generatedReport.provider_name }} / {{ generatedReport.model }}</span>
        </div>
        <div class="report-content">{{ generatedReport.content }}</div>
      </div>

      <!-- Two-column layout -->
      <div class="two-column">
        <!-- Left: settings -->
        <div class="settings-panel">
          <div class="panel-header">
            <Settings :size="16" />
            <span>推送设置</span>
          </div>

          <div class="setting-group">
            <label class="setting-label">日报推送</label>
            <div class="setting-row">
              <input
                id="daily_enabled"
                type="checkbox"
                v-model="config.daily_enabled"
              />
              <label for="daily_enabled">启用日报</label>
              <input
                type="time"
                v-model="config.daily_time"
                :disabled="!config.daily_enabled"
                class="time-input"
              />
            </div>
          </div>

          <div class="setting-group">
            <label class="setting-label">周报推送</label>
            <div class="setting-row">
              <input
                id="weekly_enabled"
                type="checkbox"
                v-model="config.weekly_enabled"
              />
              <label for="weekly_enabled">启用周报</label>
              <select
                v-model="config.weekly_day"
                :disabled="!config.weekly_enabled"
                class="day-select"
              >
                <option :value="0">周日</option>
                <option :value="1">周一</option>
                <option :value="6">周六</option>
              </select>
              <input
                type="time"
                v-model="config.weekly_time"
                :disabled="!config.weekly_enabled"
                class="time-input"
              />
            </div>
          </div>

          <div class="setting-group">
            <label class="setting-label">AI 模型</label>
            <select v-model="config.provider_id" class="model-select">
              <option value="">请选择 Provider</option>
              <option v-for="p in availableProviders" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
            <select
              v-model="config.model_id"
              :disabled="!config.provider_id"
              class="model-select"
            >
              <option value="">请选择模型</option>
              <option v-for="m in availableModels" :key="m.id" :value="m.id">{{ m.name }}</option>
            </select>
          </div>

          <button
            class="save-btn"
            @click="saveSettings"
            :disabled="saving"
          >
            {{ saving ? '保存中...' : '保存设置' }}
          </button>
        </div>

        <!-- Right: history + actions -->
        <div class="right-panel">
          <!-- Action panel -->
          <div class="dash-card action-card">
            <div class="dash-section-title">手动生成</div>
            <div class="action-buttons">
              <button
                class="action-btn"
                :disabled="generating"
                @click="generateSummary('daily')"
              >
                <Play :size="14" />
                <span>{{ generating ? '生成中...' : '立即生成日报' }}</span>
              </button>
              <button
                class="action-btn secondary"
                :disabled="generating"
                @click="generateSummary('weekly')"
              >
                <Play :size="14" />
                <span>{{ generating ? '生成中...' : '立即生成周报' }}</span>
              </button>
            </div>
          </div>

          <!-- History panel -->
          <div class="dash-card history-card">
            <div class="history-header">
              <div class="history-tabs">
                <button
                  v-for="tab in [{ id: 'daily' as const, label: '日报' }, { id: 'weekly' as const, label: '周报' }]"
                  :key="tab.id"
                  class="history-tab"
                  :class="{ active: historyTab === tab.id }"
                  @click="historyTab = tab.id"
                >
                  {{ tab.label }}
                </button>
              </div>
              <button class="refresh-btn" @click="refreshReports" :disabled="loading">
                <RefreshCw :size="14" :class="{ spinning: loading }" />
              </button>
            </div>

            <div v-if="!filteredReports.length" class="no-data">
              暂无记录
            </div>
            <div v-else class="report-list">
              <div
                v-for="report in filteredReports"
                :key="report.id"
                class="report-item"
              >
                <div class="report-summary" @click="toggleExpand(report.id)">
                  <div class="report-info">
                    <span class="report-type-tag">{{ report.type === 'daily' ? '日报' : '周报' }}</span>
                    <span class="report-date-text">{{ report.date }}</span>
                    <span class="report-tokens">{{ report.tokens_input + report.tokens_output }} tokens</span>
                    <span class="report-cost">${{ report.cost_usd.toFixed(4) }}</span>
                  </div>
                  <div class="report-actions">
                    <component :is="expandedReportId === report.id ? ChevronUp : ChevronDown" :size="14" />
                    <button class="delete-btn" @click.stop="removeReport(report.id)">
                      <Trash2 :size="14" />
                    </button>
                  </div>
                </div>
                <div v-if="expandedReportId === report.id" class="report-detail">
                  <div class="detail-meta">
                    <span><Clock :size="12" /> {{ fmtDate(report.created_at) }} {{ fmtTime(report.created_at) }}</span>
                    <span><Bot :size="12" /> {{ report.provider_name }} / {{ report.model }}</span>
                    <span>Input: {{ report.tokens_input }} / Output: {{ report.tokens_output }}</span>
                    <span>Cost: ${{ report.cost_usd.toFixed(4) }}</span>
                    <span class="status-tag">{{ report.status }}</span>
                  </div>
                  <div class="detail-content">{{ report.content }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.summary-push-tab {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.loading-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: #8e8e93;
  padding: 60px;
}

/* ─── KPI row ──────────────────────────────────────────────── */
.kpi-row {
  display: grid;
  gap: 14px;
}

.kpi-row.four {
  grid-template-columns: repeat(4, 1fr);
}

.kpi-card {
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  padding: 18px 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: box-shadow 0.15s, transform 0.15s;
}

.kpi-card:hover {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  transform: translateY(-1px);
}

.kpi-card.accent {
  background: linear-gradient(135deg, #223F79 0%, #2a4d94 100%);
  border: none;
}

.kpi-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: rgba(34, 63, 121, 0.08);
  color: #223F79;
  display: flex;
  align-items: center;
  justify-content: center;
}

.kpi-card.accent .kpi-icon {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}

.kpi-value {
  font-size: 24px;
  font-weight: 700;
  color: #1c1c1e;
  line-height: 1.2;
}

.kpi-card.accent .kpi-value {
  color: #fff;
}

.kpi-label {
  font-size: 12px;
  color: #8e8e93;
}

.kpi-card.accent .kpi-label {
  color: rgba(255, 255, 255, 0.75);
}

/* ─── Error toast ──────────────────────────────────────────── */
.error-toast {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 10px;
  color: #ef4444;
  font-size: 13px;
}

/* ─── Result card ──────────────────────────────────────────── */
.result-card .report-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.result-card .report-type {
  font-size: 12px;
  font-weight: 600;
  color: #223F79;
  background: rgba(34, 63, 121, 0.08);
  padding: 2px 8px;
  border-radius: 4px;
}

.result-card .report-date,
.result-card .report-model {
  font-size: 12px;
  color: #8e8e93;
}

.result-card .report-content {
  font-size: 13px;
  line-height: 1.7;
  color: #3c3c43;
  white-space: pre-wrap;
}

/* ─── Two-column layout ────────────────────────────────────── */
.two-column {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.settings-panel {
  width: 320px;
  flex-shrink: 0;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
}

.panel-header svg {
  color: #223F79;
}

/* ─── Settings ─────────────────────────────────────────────── */
.setting-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.setting-label {
  font-size: 12px;
  font-weight: 600;
  color: #8e8e93;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.setting-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.setting-row input[type='checkbox'] {
  width: 16px;
  height: 16px;
  accent-color: #223F79;
  cursor: pointer;
}

.setting-row label {
  font-size: 13px;
  color: #3c3c43;
  cursor: pointer;
  user-select: none;
}

.time-input {
  padding: 6px 10px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  font-size: 13px;
  color: #1c1c1e;
  background: #fff;
  font-family: inherit;
}

.time-input:disabled {
  background: rgba(0, 0, 0, 0.03);
  color: #8e8e93;
  cursor: not-allowed;
}

.day-select,
.model-select {
  padding: 6px 10px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  font-size: 13px;
  color: #1c1c1e;
  background: #fff;
  font-family: inherit;
  cursor: pointer;
}

.day-select:disabled,
.model-select:disabled {
  background: rgba(0, 0, 0, 0.03);
  color: #8e8e93;
  cursor: not-allowed;
}

.model-select {
  width: 100%;
}

.save-btn {
  margin-top: 4px;
  padding: 10px 16px;
  border-radius: 10px;
  border: none;
  background: #223F79;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.15s;
}

.save-btn:hover:not(:disabled) {
  opacity: 0.92;
  transform: translateY(-1px);
}

.save-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* ─── Right panel ──────────────────────────────────────────── */
.right-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.dash-card {
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
}

.dash-section-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
  margin-bottom: 16px;
}

/* ─── Action card ──────────────────────────────────────────── */
.action-card .action-buttons {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border-radius: 10px;
  border: none;
  background: #223F79;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.15s;
}

.action-btn:hover:not(:disabled) {
  opacity: 0.92;
  transform: translateY(-1px);
}

.action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.action-btn.secondary {
  background: rgba(34, 63, 121, 0.08);
  color: #223F79;
}

.action-btn.secondary:hover:not(:disabled) {
  background: rgba(34, 63, 121, 0.14);
}

/* ─── History card ─────────────────────────────────────────── */
.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.history-tabs {
  display: flex;
  gap: 8px;
}

.history-tab {
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: #ffffff;
  font-size: 13px;
  color: #8e8e93;
  cursor: pointer;
  transition: all 0.12s;
}

.history-tab:hover {
  background: rgba(0, 0, 0, 0.03);
}

.history-tab.active {
  background: rgba(34, 63, 121, 0.10);
  border-color: rgba(34, 63, 121, 0.18);
  color: #223F79;
  font-weight: 600;
}

.refresh-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8e8e93;
  cursor: pointer;
  transition: all 0.12s;
}

.refresh-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.03);
  color: #223F79;
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.refresh-btn svg.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.no-data {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: #8e8e93;
  padding: 24px 0;
}

/* ─── Report list ──────────────────────────────────────────── */
.report-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.report-item {
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 10px;
  overflow: hidden;
  transition: border-color 0.12s;
}

.report-item:hover {
  border-color: rgba(0, 0, 0, 0.12);
}

.report-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  cursor: pointer;
  background: rgba(0, 0, 0, 0.01);
  transition: background 0.12s;
}

.report-summary:hover {
  background: rgba(0, 0, 0, 0.03);
}

.report-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.report-type-tag {
  font-size: 11px;
  font-weight: 600;
  color: #223F79;
  background: rgba(34, 63, 121, 0.08);
  padding: 2px 8px;
  border-radius: 4px;
  flex-shrink: 0;
}

.report-date-text {
  font-size: 13px;
  color: #1c1c1e;
  font-weight: 500;
}

.report-tokens,
.report-cost {
  font-size: 12px;
  color: #8e8e93;
  font-variant-numeric: tabular-nums;
}

.report-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #8e8e93;
}

.delete-btn {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: #8e8e93;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.12s;
}

.delete-btn:hover {
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
}

/* ─── Report detail ────────────────────────────────────────── */
.report-detail {
  padding: 14px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  background: rgba(0, 0, 0, 0.01);
}

.detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}

.detail-meta span {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #8e8e93;
}

.detail-meta svg {
  color: #c7c7cc;
}

.status-tag {
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(16, 185, 129, 0.08);
  color: #10b981;
  font-weight: 600;
}

.detail-content {
  font-size: 13px;
  line-height: 1.7;
  color: #3c3c43;
  white-space: pre-wrap;
  max-height: 400px;
  overflow-y: auto;
}
</style>
