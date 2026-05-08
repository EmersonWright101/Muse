/**
 * Home store — animal poster wall.
 *
 * Manages AI-generated animal posters, generation settings, and daily usage stats.
 * Posters are stored as JSON files in {dataRoot}/home_posters/.
 * Usage stats mirror the copilot pattern so they appear in the statistics module.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { resolveDataRoot, normalizePath } from '../utils/path'
import { readTextFile, writeTextFile, exists, mkdir, readDir, remove } from '@tauri-apps/plugin-fs'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { useAiSettingsStore } from './aiSettings'
import { apiGet, apiPut, apiDelete, apiPostForm, apiGetBinary, isBackendConfigured } from '../services/api'
import { beginSyncOp, endSyncOp } from './syncStatus'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AnimalPoster {
  id: string
  date: string          // YYYY-MM-DD
  animalName: string
  description: string
  imageBase64: string   // base64 PNG/JPEG data
  prompt: string
  generatedAt: string   // ISO timestamp
  modelId: string
  providerId: string
  costUsd: number
}

export interface HomeSettings {
  enabled: boolean
  providerId: string
  modelId: string
  frequency: 'daily' | 'every3days' | 'weekly'
  promptTemplate: string
  maxPosters: number
  animals?: AnimalEntry[]  // persisted custom list; undefined = use ANIMAL_LIST default
}

export interface PosterDailyStat {
  costUsd: number
  requests: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LS_KEY             = 'muse-home-settings'
const LS_MODIFIED_AT_KEY = 'muse-home-posters-modified-at'
const LS_DELETED_POSTERS_KEY = 'muse-deleted-posters'

function getDeletedPosters(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LS_DELETED_POSTERS_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch { return {} }
}

function setDeletedPosters(map: Record<string, string>) {
  localStorage.setItem(LS_DELETED_POSTERS_KEY, JSON.stringify(map))
}

export const DEFAULT_PROMPT = '请给我生成一张介绍{animal}的海报，你的图片必须是横幅的16:9，然后文字必须是中文'

export interface AnimalEntry {
  zh: string   // 显示用中文名
  en: string   // 提示词用英文名（图像 AI 识别更准确）
}

export const ANIMAL_LIST: AnimalEntry[] = [
  { zh: '雪豹',     en: 'Snow Leopard' },
  { zh: '北极狐',   en: 'Arctic Fox' },
  { zh: '孟加拉虎', en: 'Bengal Tiger' },
  { zh: '蝠鲼',     en: 'Manta Ray' },
  { zh: '帝企鹅',   en: 'Emperor Penguin' },
  { zh: '科莫多巨蜥', en: 'Komodo Dragon' },
  { zh: '鸳鸯',     en: 'Mandarin Duck' },
  { zh: '游隼',     en: 'Peregrine Falcon' },
  { zh: '白鲸',     en: 'Beluga Whale' },
  { zh: '小熊猫',   en: 'Red Panda' },
  { zh: '长鼻猴',   en: 'Proboscis Monkey' },
  { zh: '琴鸟',     en: 'Superb Lyrebird' },
  { zh: '独角鲸',   en: 'Narwhal' },
  { zh: '马来熊',   en: 'Sun Bear' },
  { zh: '穿山甲',   en: 'Pangolin' },
  { zh: '耳廓狐',   en: 'Fennec Fox' },
  { zh: '薮猫',     en: 'Serval' },
  { zh: '霍加狓',   en: 'Okapi' },
  { zh: '水豚',     en: 'Capybara' },
  { zh: '大食蚁兽', en: 'Giant Anteater' },
  { zh: '鬃狼',     en: 'Maned Wolf' },
  { zh: '树袋鼠',   en: 'Tree Kangaroo' },
  { zh: '短尾矮袋鼠', en: 'Quokka' },
  { zh: '格查尔鸟', en: 'Resplendent Quetzal' },
  { zh: '白腹锦鸡', en: 'Golden Pheasant' },
  { zh: '美西螈',   en: 'Axolotl' },
  { zh: '小飞象章鱼', en: 'Dumbo Octopus' },
  { zh: '螳螂虾',   en: 'Mantis Shrimp' },
  { zh: '月水母',   en: 'Moon Jellyfish' },
  { zh: '叶海龙',   en: 'Leafy Sea Dragon' },
  { zh: '云豹',     en: 'Clouded Leopard' },
  { zh: '熊狸',     en: 'Binturong' },
  { zh: '狞猫',     en: 'Caracal' },
  { zh: '长尾虎猫', en: 'Margay' },
  { zh: '貘',       en: 'Tapir' },
  { zh: '短吻针鼹', en: 'Short-beaked Echidna' },
  { zh: '几维鸟',   en: 'Kiwi' },
  { zh: '鸮鹦鹉',   en: 'Kakapo' },
  { zh: '华美极乐鸟', en: 'Superb Bird-of-Paradise' },
  { zh: '七彩麒麟鱼', en: 'Mandarinfish' },
  { zh: '日本猕猴', en: 'Japanese Macaque' },
  { zh: '眼镜猴',   en: 'Spectral Tarsier' },
  { zh: '指猴',     en: 'Aye-aye' },
  { zh: '马岛獴',   en: 'Fossa' },
  { zh: '高鼻羚羊', en: 'Saiga Antelope' },
  { zh: '长颈羚',   en: 'Gerenuk' },
  { zh: '邦戈羚',   en: 'Bongo' },
  { zh: '鲸头鹳',   en: 'Shoebill Stork' },
  { zh: '通草企鹅', en: 'Macaroni Penguin' },
  { zh: '蓝脚鲣鸟', en: 'Blue-footed Booby' },
]

export const FREQUENCY_OPTIONS: Array<{ value: HomeSettings['frequency']; labelZh: string; labelEn: string; days: number }> = [
  { value: 'daily',      labelZh: '每天',    labelEn: 'Daily',        days: 1 },
  { value: 'every3days', labelZh: '每3天',   labelEn: 'Every 3 days', days: 3 },
  { value: 'weekly',     labelZh: '每周',    labelEn: 'Weekly',       days: 7 },
]

// ─── File helpers ─────────────────────────────────────────────────────────────

async function getPostersDir(): Promise<string> {
  return `${await resolveDataRoot()}/home_posters`
}

async function getPosterStatsPath(): Promise<string> {
  return `${await resolveDataRoot()}/poster-stats.json`
}

async function ensurePostersDir(): Promise<string> {
  const dir = await getPostersDir()
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  return dir
}

async function writePosterFile(poster: AnimalPoster): Promise<void> {
  const dir = await ensurePostersDir()
  await writeTextFile(`${dir}/${poster.id}.json`, JSON.stringify(poster, null, 2))
}

async function loadPosterFile(id: string): Promise<AnimalPoster | null> {
  try {
    const dir = await getPostersDir()
    const path = `${dir}/${id}.json`
    if (!(await exists(path))) return null
    return JSON.parse(await readTextFile(path)) as AnimalPoster
  } catch { return null }
}

async function listPosterIds(): Promise<string[]> {
  try {
    const dir = await getPostersDir()
    if (!(await exists(dir))) return []
    const entries = await readDir(dir)
    return entries
      .filter(e => e.name?.endsWith('.json') && !e.name?.endsWith('.tmp.json'))
      .map(e => e.name!.replace('.json', ''))
  } catch { return [] }
}

async function savePosterStats(stats: Record<string, PosterDailyStat>): Promise<void> {
  try {
    const path = await getPosterStatsPath()
    const dir = normalizePath(path).slice(0, normalizePath(path).lastIndexOf('/'))
    if (!(await exists(dir))) await mkdir(dir, { recursive: true })
    await writeTextFile(path, JSON.stringify(stats, null, 2))
  } catch { /* ignore */ }
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function pickAnimalFrom(list: AnimalEntry[], recentZhNames: string[]): AnimalEntry {
  const available = list.filter(a => !recentZhNames.includes(a.zh))
  const pool = available.length > 0 ? available : list
  return pool[Math.floor(Math.random() * pool.length)]
}

function shouldGenerate(frequency: HomeSettings['frequency'], lastDate: string | null): boolean {
  if (!lastDate) return true
  const freq = FREQUENCY_OPTIONS.find(f => f.value === frequency)
  if (!freq) return true
  const last = new Date(lastDate + 'T00:00:00')
  const today = new Date(todayStr() + 'T00:00:00')
  const diffDays = Math.floor((today.getTime() - last.getTime()) / 86_400_000)
  return diffDays >= freq.days
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useHomeStore = defineStore('home', () => {
  const settings = ref<HomeSettings>({
    enabled: false,
    providerId: '',
    modelId: '',
    frequency: 'daily',
    promptTemplate: DEFAULT_PROMPT,
    maxPosters: 30,
  })

  // Custom animal list — starts from built-in defaults, user can edit
  const animals = ref<AnimalEntry[]>([...ANIMAL_LIST])

  const posters = ref<AnimalPoster[]>([])
  const posterIds = ref<string[]>([])
  const isGenerating = ref(false)
  const generateError = ref('')
  const lastGeneratedDate = ref<string | null>(null)
  const posterStats = ref<Record<string, PosterDailyStat>>({})

  // ─── Settings ──────────────────────────────────────────────────────────────

  function loadSettings() {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) {
        const s = JSON.parse(raw) as Partial<HomeSettings>
        settings.value = {
          enabled:        s.enabled        ?? false,
          providerId:     s.providerId     ?? '',
          modelId:        s.modelId        ?? '',
          frequency:      s.frequency      ?? 'daily',
          promptTemplate: s.promptTemplate ?? DEFAULT_PROMPT,
          maxPosters:     s.maxPosters     ?? 30,
        }
        if (Array.isArray(s.animals) && s.animals.length > 0) {
          animals.value = s.animals
        }
      }
    } catch { /* ignore */ }
    try {
      lastGeneratedDate.value = localStorage.getItem('muse-home-last-generated')
    } catch { /* ignore */ }
  }

  function saveSettings() {
    localStorage.setItem(LS_KEY, JSON.stringify({ ...settings.value, animals: animals.value }))
    localStorage.setItem(LS_MODIFIED_AT_KEY, new Date().toISOString())
    apiPut('/api/settings/home', {
      value: { ...settings.value, animals: animals.value },
    }).catch(() => {})
  }

  function updateSettings(patch: Partial<Omit<HomeSettings, 'animals'>>) {
    Object.assign(settings.value, patch)
    saveSettings()
  }

  // ─── Animal list CRUD ──────────────────────────────────────────────────────

  function addAnimal(entry: AnimalEntry) {
    if (!entry.zh.trim() || !entry.en.trim()) return
    animals.value = [...animals.value, { zh: entry.zh.trim(), en: entry.en.trim() }]
    saveSettings()
  }

  function updateAnimal(index: number, entry: AnimalEntry) {
    if (index < 0 || index >= animals.value.length) return
    if (!entry.zh.trim() || !entry.en.trim()) return
    const list = [...animals.value]
    list[index] = { zh: entry.zh.trim(), en: entry.en.trim() }
    animals.value = list
    saveSettings()
  }

  function deleteAnimal(index: number) {
    animals.value = animals.value.filter((_, i) => i !== index)
    saveSettings()
  }

  function resetAnimals() {
    animals.value = [...ANIMAL_LIST]
    saveSettings()
  }

  function deduplicateAnimals() {
    const usedNames = new Set(posters.value.map(p => p.animalName))
    const beforeCount = animals.value.length
    animals.value = animals.value.filter(a => !usedNames.has(a.zh))
    if (animals.value.length !== beforeCount) {
      saveSettings()
    }
  }

  // ─── Posters ───────────────────────────────────────────────────────────────

  // Prevents duplicate backend sync within the same app session
  let _backendSynced = false

  async function loadPosters() {
    // Step 1: load from local files immediately (always fast)
    const localIds = await listPosterIds()
    const localLoaded: AnimalPoster[] = []
    for (const id of localIds) {
      const p = await loadPosterFile(id)
      if (p) localLoaded.push(p)
    }
    localLoaded.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
    posters.value = localLoaded
    posterIds.value = localLoaded.map(p => p.id)

    // Step 2: background sync — only once per session, only missing posters
    if (!isBackendConfigured() || _backendSynced) return
    _backendSynced = true
    beginSyncOp()
    ;(async () => {
      try {
        interface RemotePoster { id: string; date: string; animalName: string; description: string; prompt: string; generatedAt: string; modelId: string; providerId: string; costUsd: number; deletedAt: string | null }
        const remote = await apiGet<RemotePoster[]>('/api/home/posters')
        if (!remote) return

        const localIdSet = new Set(localIds)
        const remoteActive = remote.filter(r => !r.deletedAt)

        if (remoteActive.length === 0) {
          // Backend empty → upload all local posters
          for (const id of localIds) {
            const p = await loadPosterFile(id)
            if (!p?.imageBase64) continue
            try {
              const binary = Uint8Array.from(atob(p.imageBase64), c => c.charCodeAt(0))
              const form = new FormData()
              form.append('meta', JSON.stringify({ id: p.id, date: p.date, animal_name: p.animalName, description: p.description, prompt: p.prompt, generated_at: p.generatedAt, model_id: p.modelId, provider_id: p.providerId, cost_usd: p.costUsd }))
              form.append('image', new Blob([binary], { type: 'image/png' }), `${p.id}.png`)
              await apiPostForm<{ id: string }>('/api/home/posters', form)
            } catch { /* ignore */ }
          }
          return
        }

        // Download remote posters not cached locally
        const newPosters: AnimalPoster[] = []
        for (const rp of remoteActive) {
          if (localIdSet.has(rp.id)) continue
          const binary = await apiGetBinary(`/api/home/posters/${rp.id}/image`)
          if (!binary) continue
          let bin = ''
          for (let i = 0; i < binary.length; i += 8192) {
            bin += String.fromCharCode(...Array.from(binary.subarray(i, i + 8192)))
          }
          const poster: AnimalPoster = {
            id: rp.id, date: rp.date, animalName: rp.animalName,
            description: rp.description, imageBase64: btoa(bin),
            prompt: rp.prompt, generatedAt: rp.generatedAt,
            modelId: rp.modelId, providerId: rp.providerId, costUsd: rp.costUsd,
          }
          await writePosterFile(poster)
          newPosters.push(poster)
        }
        if (newPosters.length > 0) {
          const merged = [...posters.value, ...newPosters]
          merged.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
          posters.value = merged
          posterIds.value = merged.map(p => p.id)
        }

        // Upload local-only posters to backend
        const remoteIdSet = new Set(remote.map(r => r.id))
        for (const id of localIds) {
          if (remoteIdSet.has(id)) continue
          const p = await loadPosterFile(id)
          if (!p?.imageBase64) continue
          try {
            const binary = Uint8Array.from(atob(p.imageBase64), c => c.charCodeAt(0))
            const form = new FormData()
            form.append('meta', JSON.stringify({ id: p.id, date: p.date, animal_name: p.animalName, description: p.description, prompt: p.prompt, generated_at: p.generatedAt, model_id: p.modelId, provider_id: p.providerId, cost_usd: p.costUsd }))
            form.append('image', new Blob([binary], { type: 'image/png' }), `${p.id}.png`)
            await apiPostForm<{ id: string }>('/api/home/posters', form)
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      finally { endSyncOp() }
    })()
  }

  // ─── Image generation ─────────────────────────────────────────────────────

  async function generatePoster(forceAnimalZh?: string): Promise<void> {
    const forceAnimal = forceAnimalZh
    if (isGenerating.value) return
    isGenerating.value = true
    generateError.value = ''

    try {
      const ai = useAiSettingsStore()
      const pId = settings.value.providerId || ai.activeProviderId
      const provider = ai.providers.find(p => p.id === pId)
      if (!provider) throw new Error('未配置 AI 供应商')
      if (!provider.apiKey) throw new Error(`${provider.name} 未配置 API Key`)

      const mId = settings.value.modelId || provider.selectedModelId
      const animalEntry = forceAnimal
        ? (animals.value.find(a => a.zh === forceAnimal) ?? { zh: forceAnimal, en: forceAnimal })
        : pickAnimalFrom(animals.value, posters.value.slice(0, 10).map(p => p.animalName))
      // Prompt uses English name for better image AI recognition; display uses Chinese
      const prompt = settings.value.promptTemplate.replace('{animal}', animalEntry.en)

      const url = provider.baseUrl.replace(/\/$/, '') + '/images/generations'
      const body = JSON.stringify({
        model: mId,
        prompt,
        n: 1,
        size: '1792x1024',
        response_format: 'b64_json',
      })

      const resp = await tauriFetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
      })

      if (!resp.ok) {
        const errText = await resp.text()
        throw new Error(`API 错误 ${resp.status}: ${errText}`)
      }

      const json = await resp.json() as { data?: Array<{ b64_json?: string; url?: string }>; usage?: { total_tokens?: number } }
      const imageItem = json.data?.[0]
      if (!imageItem) throw new Error('API 未返回图像数据')

      let imageBase64 = imageItem.b64_json ?? ''

      if (!imageBase64 && imageItem.url) {
        try {
          const imgResp = await tauriFetch(imageItem.url, { method: 'GET' })
          if (imgResp.ok) {
            const buf   = await imgResp.arrayBuffer()
            const bytes = new Uint8Array(buf)
            let binary  = ''
            const chunk = 8192
            for (let i = 0; i < bytes.length; i += chunk) {
              binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunk)))
            }
            imageBase64 = btoa(binary)
          }
        } catch { /* leave imageBase64 empty; error shown below */ }
      }

      const model = provider.models.find(m => m.id === mId)
      // DALL-E 3 HD 1792x1024 ≈ $0.12; gpt-image-1 varies; fallback $0.04
      const costUsd = model?.pricePerRequest ?? 0.04

      const today = todayStr()
      const poster: AnimalPoster = {
        id:          `poster_${Date.now()}`,
        date:        today,
        animalName:  animalEntry.zh,
        description: animalEntry.zh,
        imageBase64,
        prompt,
        generatedAt: new Date().toISOString(),
        modelId:     mId,
        providerId:  pId,
        costUsd,
      }

      await writePosterFile(poster)

      // Upload to backend (fire-and-forget)
      if (isBackendConfigured() && poster.imageBase64) {
        ;(async () => {
          try {
            const binary = Uint8Array.from(atob(poster.imageBase64), c => c.charCodeAt(0))
            const form = new FormData()
            form.append('meta', JSON.stringify({
              id:          poster.id,
              date:        poster.date,
              animal_name: poster.animalName,
              description: poster.description,
              prompt:      poster.prompt,
              generated_at: poster.generatedAt,
              model_id:    poster.modelId,
              provider_id: poster.providerId,
              cost_usd:    poster.costUsd,
            }))
            form.append('image', new Blob([binary], { type: 'image/png' }), `${poster.id}.png`)
            await apiPostForm('/api/home/posters', form)
          } catch { /* ignore */ }
        })()
      }

      posters.value = [poster, ...posters.value]
      posterIds.value = posters.value.map(p => p.id)

      // Trim old posters over limit
      if (posters.value.length > settings.value.maxPosters) {
        const toRemove = posters.value.slice(settings.value.maxPosters)
        for (const old of toRemove) {
          try {
            const dir = await getPostersDir()
            await remove(`${dir}/${old.id}.json`)
          } catch { /* ignore */ }
        }
        posters.value = posters.value.slice(0, settings.value.maxPosters)
        posterIds.value = posters.value.map(p => p.id)
      }

      lastGeneratedDate.value = today
      localStorage.setItem('muse-home-last-generated', today)
      localStorage.setItem(LS_MODIFIED_AT_KEY, new Date().toISOString())

      const stat = posterStats.value[today] ?? { costUsd: 0, requests: 0 }
      stat.costUsd  += costUsd
      stat.requests += 1
      posterStats.value = { ...posterStats.value, [today]: stat }
      await savePosterStats(posterStats.value)
      apiPut(`/api/home/stats/${today}`, { cost_usd: stat.costUsd, requests: stat.requests }).catch(() => {})
    } catch (e: unknown) {
      generateError.value = e instanceof Error ? e.message : String(e)
      console.error('Poster generation failed:', e)
    } finally {
      isGenerating.value = false
    }
  }

  async function maybeAutoGenerate() {
    if (!settings.value.enabled) return
    if (!shouldGenerate(settings.value.frequency, lastGeneratedDate.value)) return
    await generatePoster()
  }

  // ─── 11:00 daily scheduler ─────────────────────────────────────────────────
  // Schedules the next generation for 11 AM, then re-schedules for the following day.
  // This way the timer never drifts — each setTimeout targets the exact wall-clock time.

  let _schedulerTimer: ReturnType<typeof setTimeout> | null = null

  function startDailyScheduler() {
    if (_schedulerTimer !== null) return   // already running

    function scheduleNext() {
      const now = new Date()
      const target = new Date(now)
      target.setHours(11, 0, 0, 0)
      if (target <= now) target.setDate(target.getDate() + 1)  // past 11 AM → next day
      const delay = target.getTime() - now.getTime()

      _schedulerTimer = setTimeout(async () => {
        _schedulerTimer = null
        await maybeAutoGenerate()
        scheduleNext()          // re-schedule for next 11 AM
      }, delay)
    }

    scheduleNext()
  }

  async function deletePoster(id: string) {
    try {
      const dir = await getPostersDir()
      await remove(`${dir}/${id}.json`)
    } catch { /* ignore */ }
    posters.value = posters.value.filter(p => p.id !== id)
    posterIds.value = posters.value.map(p => p.id)
    const deleted = getDeletedPosters()
    deleted[id] = new Date().toISOString()
    setDeletedPosters(deleted)
    localStorage.setItem(LS_MODIFIED_AT_KEY, new Date().toISOString())
    apiDelete(`/api/home/posters/${id}`).catch(() => {})
  }

  function pushToServer() {
    apiPut('/api/settings/home', { value: { ...settings.value, animals: animals.value } }).catch(() => {})
  }

  async function syncFromServer() {
    if (!isBackendConfigured()) return
    try {
      const allSettings = await apiGet<Record<string, unknown>>('/api/settings')
      if (allSettings?.home) {
        const s = allSettings.home as Partial<HomeSettings & { animals?: AnimalEntry[] }>
        if (s.enabled        !== undefined) settings.value.enabled        = s.enabled
        if (s.providerId)                   settings.value.providerId     = s.providerId
        if (s.modelId)                      settings.value.modelId        = s.modelId
        if (s.frequency)                    settings.value.frequency      = s.frequency
        if (s.promptTemplate)               settings.value.promptTemplate = s.promptTemplate
        if (s.maxPosters     !== undefined) settings.value.maxPosters     = s.maxPosters
        if (Array.isArray(s.animals) && s.animals.length > 0) animals.value = s.animals
        localStorage.setItem(LS_KEY, JSON.stringify({ ...settings.value, animals: animals.value }))
      }
    } catch { /* ignore */ }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  loadSettings()
  loadPosters().catch(() => {})
  ;(async () => {
    try {
      const path = await getPosterStatsPath()
      if (await exists(path)) {
        posterStats.value = JSON.parse(await readTextFile(path)) as Record<string, PosterDailyStat>
      }
    } catch { /* ignore */ }
  })()

  return {
    settings,
    animals,
    posters,
    posterIds,
    isGenerating,
    generateError,
    lastGeneratedDate,
    posterStats,
    loadSettings,
    updateSettings,
    addAnimal,
    updateAnimal,
    deleteAnimal,
    resetAnimals,
    deduplicateAnimals,
    loadPosters,
    generatePoster,
    maybeAutoGenerate,
    startDailyScheduler,
    deletePoster,
    pushToServer,
    syncFromServer,
  }
})

// ─── Stats file export (used by statistics store) ─────────────────────────────

export async function loadPosterStatsFile(): Promise<Record<string, PosterDailyStat>> {
  try {
    const path = `${await resolveDataRoot()}/poster-stats.json`
    if (!(await exists(path))) return {}
    return JSON.parse(await readTextFile(path)) as Record<string, PosterDailyStat>
  } catch { return {} }
}

