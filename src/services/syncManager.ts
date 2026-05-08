/**
 * Startup sync orchestrator.
 *
 * On app launch (when backend is configured):
 * 1. Pull all settings in one request → apply to each store
 * 2. Sync assistants
 * 3. Sync chat conversation list (merge remote into local index)
 * 4. Sync home settings & posters
 * 5. Sync travel notes list (merge remote into local)
 * 6. Detect first-time use → migrate local data to backend
 *
 * All operations are best-effort and non-blocking — failures are silently
 * swallowed so the app boots even when offline.
 */

import { apiGet, isBackendConfigured } from './api'
import { setSyncState } from '../stores/syncStatus'
import {
  fetchConvListFromServer,
  migrateConvsToServer,
  pushConvToServer,
} from './chatSync'
import {
  readTextFile, writeTextFile, exists, mkdir,
} from '@tauri-apps/plugin-fs'
import { conversationsDir, travelNotesDir } from '../utils/path'
import type { ConversationMeta, Conversation } from '../utils/storage'

// ─── Lazy store accessors (avoid circular init) ──────────────────────────────

async function getAiStore() {
  const { useAiSettingsStore } = await import('../stores/aiSettings')
  return useAiSettingsStore()
}
async function getChatSettingsStore() {
  const { useChatSettingsStore } = await import('../stores/chatSettings')
  return useChatSettingsStore()
}
async function getWebSearchStore() {
  const { useWebSearchStore } = await import('../stores/webSearch')
  return useWebSearchStore()
}
async function getAssistantsStore() {
  const { useAssistantsStore } = await import('../stores/assistants')
  return useAssistantsStore()
}
async function getHomeStore() {
  const { useHomeStore } = await import('../stores/home')
  return useHomeStore()
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function atomicWrite(path: string, content: string) {
  const tmp = `${path}.tmp`
  await writeTextFile(tmp, content)
  const { rename } = await import('@tauri-apps/plugin-fs')
  await rename(tmp, path)
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    if (!(await exists(path))) return null
    return JSON.parse(await readTextFile(path)) as T
  } catch { return null }
}

// ─── Chat conversation list merge ─────────────────────────────────────────────

async function syncChatList() {
  const remote = await fetchConvListFromServer()
  if (!remote) return

  const dir = await conversationsDir()
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  const indexPath = `${dir}/index.json`

  const localIndex = (await readJsonFile<ConversationMeta[]>(indexPath)) ?? []
  const localIds = new Set(localIndex.map(m => m.id))

  // Add remote entries not in local index (metadata only, full data lazy-loaded on open)
  let changed = false
  for (const rm of remote) {
    if (rm.trashedAt) continue
    if (!localIds.has(rm.id)) {
      localIndex.unshift({
        id:          rm.id,
        title:       rm.title,
        createdAt:   rm.createdAt,
        updatedAt:   rm.updatedAt,
        preview:     '',
        model:       rm.model,
        providerId:  rm.providerId,
        pinned:      rm.pinned,
        assistantId: rm.assistantId ?? undefined,
      })
      changed = true
    }
  }
  if (changed) await atomicWrite(indexPath, JSON.stringify(localIndex, null, 2))

  // Push local conversations not on remote (covers first-time migration + failed-upload retry)
  const remoteIds = new Set(remote.map(r => r.id))
  const localOnly = localIndex.filter(m => !remoteIds.has(m.id))
  if (localOnly.length > 0) {
    const localConvs: Conversation[] = []
    for (const meta of localOnly) {
      const convPath = `${dir}/${meta.id}.json`
      const conv = await readJsonFile<Conversation>(convPath)
      if (conv) localConvs.push(conv)
    }
    if (remote.length === 0) {
      migrateConvsToServer(localConvs).catch(() => {})
    } else {
      for (const conv of localConvs) pushConvToServer(conv).catch(() => {})
    }
  }
}

// ─── Travel notes list merge ──────────────────────────────────────────────────

interface RemoteTravelMeta {
  id: string; title: string; lat: number; lng: number
  categoryL1: string; categoryL2: string; tags: string[]
  rating: number; date: string; cover: string
  status: 'visited' | 'upcoming'; updatedAt: string; deletedAt: string | null
}

async function syncTravelList() {
  try {
    const remote = await apiGet<RemoteTravelMeta[]>('/api/travel/notes')
    if (!remote || remote.length === 0) {
      // Possibly first time: migrate local notes to server
      const { listTravelNotes, loadTravelNote } = await import('../utils/travelStorage')
      const local = await listTravelNotes()
      if (local.length > 0) {
        const { apiPost } = await import('./api')
        for (const meta of local) {
          const note = await loadTravelNote(meta.id)
          if (!note) continue
          await apiPost('/api/travel/notes', {
            id:          note.id,
            title:       note.title,
            content:     note.content,
            date:        note.date,
            lat:         note.lat,
            lng:         note.lng,
            category_l1: note.categoryL1,
            category_l2: note.categoryL2,
            tags:        note.tags ?? [],
            rating:      note.rating,
            cover:       note.cover,
            status:      note.status ?? 'visited',
            updated_at:  note.updatedAt,
          }).catch(() => {})
        }
      }
      return
    }

    const { saveTravelNote, listTravelNotes, loadTravelNote } = await import('../utils/travelStorage')
    const { apiPost } = await import('./api')
    const dir = await travelNotesDir()

    // Remote → local: fetch notes missing locally
    for (const rm of remote) {
      if (rm.deletedAt) continue
      const localPath = `${dir}/${rm.id}.md`
      if (!(await exists(localPath))) {
        const full = await apiGet<RemoteTravelMeta & { content: string }>(
          `/api/travel/notes/${rm.id}`
        )
        if (full?.content) {
          await saveTravelNote({
            id:          full.id,
            title:       full.title,
            lat:         full.lat,
            lng:         full.lng,
            categoryL1:  full.categoryL1,
            categoryL2:  full.categoryL2,
            tags:        full.tags ?? [],
            rating:      full.rating,
            date:        full.date,
            cover:       full.cover,
            status:      full.status ?? 'visited',
            content:     full.content,
            updatedAt:   full.updatedAt,
          })
        }
      }
    }

    // Local → remote: push notes missing on remote (handles failed uploads)
    const remoteIds = new Set(remote.map(r => r.id))
    const localMetas = await listTravelNotes()
    for (const meta of localMetas) {
      if (remoteIds.has(meta.id)) continue
      const note = await loadTravelNote(meta.id)
      if (!note) continue
      apiPost('/api/travel/notes', {
        id:          note.id,
        title:       note.title,
        content:     note.content,
        date:        note.date,
        lat:         note.lat,
        lng:         note.lng,
        category_l1: note.categoryL1,
        category_l2: note.categoryL2,
        tags:        note.tags ?? [],
        rating:      note.rating,
        cover:       note.cover,
        status:      note.status ?? 'visited',
        updated_at:  note.updatedAt,
      }).catch(() => {})
    }
  } catch { /* ignore */ }
}

// ─── General settings sync ────────────────────────────────────────────────────

interface GeneralSettings {
  locale?: string
  currency?: string
  trashRetentionDays?: number
}

function applyGeneralSettings(s: GeneralSettings) {
  if (s.locale) {
    localStorage.setItem('muse-locale', s.locale)
    // i18n locale will be picked up on next load; for live update the UI layer handles it
  }
  if (s.currency) {
    localStorage.setItem('muse-currency', s.currency)
  }
  if (s.trashRetentionDays !== undefined) {
    localStorage.setItem('muse-trash-retention-days', String(s.trashRetentionDays))
  }
}

export function buildGeneralSettings(): GeneralSettings {
  return {
    locale:            localStorage.getItem('muse-locale') ?? 'zh-CN',
    currency:          localStorage.getItem('muse-currency') ?? 'cny',
    trashRetentionDays: parseInt(localStorage.getItem('muse-trash-retention-days') ?? '30') || 30,
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function syncAllFromServer(): Promise<void> {
  if (!isBackendConfigured()) {
    setSyncState('not_configured')
    return
  }
  setSyncState('syncing')

  try {
    // 1. Pull all settings in one request
    const allSettings = await apiGet<Record<string, unknown>>('/api/settings')
    const [aiStore, chatSettingsStore, webSearchStore, homeStore] = await Promise.all([
      getAiStore(),
      getChatSettingsStore(),
      getWebSearchStore(),
      getHomeStore(),
    ])
    if (allSettings && (allSettings.ai || allSettings.chat || allSettings.webSearch || allSettings.home || allSettings.general)) {
      // Backend has settings → apply them
      await aiStore.syncFromServer(allSettings)
      await chatSettingsStore.syncFromServer(allSettings)
      await webSearchStore.syncFromServer(allSettings)
      await homeStore.syncFromServer()
      if (allSettings.general) {
        applyGeneralSettings(allSettings.general as GeneralSettings)
      }
    } else if (allSettings) {
      // Backend returned {} (first time) → push all local settings to backend
      aiStore.pushToServer().catch(() => {})
      chatSettingsStore.pushToServer().catch(() => {})
      webSearchStore.pushToServer().catch(() => {})
      homeStore.pushToServer()
      pushGeneralSettings().catch(() => {})
    }
  } catch { /* ignore */ }

  // 2. Sync assistants
  try {
    const assistantsStore = await getAssistantsStore()
    await assistantsStore.syncFromServer()
  } catch { /* ignore */ }

  // 3+4. Chat list + travel notes (parallel; errors swallowed individually)
  await Promise.allSettled([
    syncChatList(),
    syncTravelList(),
  ])

  setSyncState('done')
}

/**
 * Push general settings (locale, currency, trashRetentionDays) to the server.
 * Call this from GeneralSettings.vue whenever any of these values change.
 */
export async function pushGeneralSettings(): Promise<void> {
  const { apiPut } = await import('./api')
  await apiPut('/api/settings/general', { value: buildGeneralSettings() }).catch(() => {})
}
