import { apiGet, apiPost, apiDelete } from './api'

export interface SummaryPushConfig {
  daily_enabled: boolean
  daily_time: string
  weekly_enabled: boolean
  weekly_day: number
  weekly_time: string
  provider_id: string
  model_id: string
  timezone: string
  /** Resolved at save time — backend uses these to call the AI directly. */
  api_key?: string
  base_url?: string
  provider_name?: string
}

export interface SummaryReport {
  id: string
  type: 'daily' | 'weekly'
  date: string
  content: string
  provider_name: string
  model: string
  tokens_input: number
  tokens_output: number
  cost_usd: number
  status: string
  created_at: string
}

export async function getSummaryPushSettings(): Promise<SummaryPushConfig | null> {
  return apiGet<SummaryPushConfig>('/api/summary-push/settings')
}

export async function saveSummaryPushSettings(config: SummaryPushConfig): Promise<void> {
  await apiPost('/api/summary-push/settings', config)
}

export async function getSummaryReports(type?: string, limit = 30): Promise<{ items: SummaryReport[] } | null> {
  const params = new URLSearchParams()
  if (type) params.append('type', type)
  params.append('limit', String(limit))
  return apiGet<{ items: SummaryReport[] }>(`/api/summary-push/reports?${params.toString()}`)
}

export async function deleteSummaryReport(id: string): Promise<void> {
  await apiDelete(`/api/summary-push/reports/${id}`)
}

export async function triggerSummary(type: 'daily' | 'weekly', date?: string): Promise<{ report: SummaryReport }> {
  return apiPost('/api/summary-push/trigger', { type, date })
}
