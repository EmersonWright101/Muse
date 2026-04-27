/**
 * Home store — animal poster wall.
 *
 * Manages AI-generated animal posters, generation settings, and daily usage stats.
 * Posters are stored as JSON files in {dataRoot}/home_posters/.
 * Usage stats mirror the copilot pattern so they appear in the statistics module.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { resolveDataRoot } from '../utils/path'
import { readTextFile, writeTextFile, exists, mkdir, readDir, remove } from '@tauri-apps/plugin-fs'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { useAiSettingsStore } from './aiSettings'
import { syncService } from '../services/sync'
import type { SyncModule } from '../services/sync/types'

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

export const DEFAULT_PROMPT = 'A stunning, photorealistic wide-format nature documentary poster of a {animal}. Cinematic landscape orientation, dramatic natural lighting, lush natural environment, national geographic style, ultra-detailed, 4K quality. No text, no watermarks. 图片必须为横版16:9比例，宽度是高度的1.78倍。'

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
    const dir = path.slice(0, path.lastIndexOf('/'))
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

  // ─── Posters ───────────────────────────────────────────────────────────────

  async function loadPosters() {
    const ids = await listPosterIds()
    const loaded: AnimalPoster[] = []
    for (const id of ids) {
      const p = await loadPosterFile(id)
      if (p) loaded.push(p)
    }
    loaded.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
    posters.value = loaded
    posterIds.value = loaded.map(p => p.id)
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
        const imgResp = await tauriFetch(imageItem.url, { method: 'GET' })
        if (imgResp.ok) {
          const imgText = await imgResp.text()
          imageBase64 = imgText
        }
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
    localStorage.setItem(LS_MODIFIED_AT_KEY, new Date().toISOString())
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
    loadPosters,
    generatePoster,
    maybeAutoGenerate,
    startDailyScheduler,
    deletePoster,
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

// ─── Sync module ──────────────────────────────────────────────────────────────

const MOD_HOME = 'homePoster'

const homeSyncModule: SyncModule = {
  id: MOD_HOME,
  remoteDirs: ['home_posters'],
  getLocalTimestamp() {
    return localStorage.getItem(LS_MODIFIED_AT_KEY) ?? new Date(0).toISOString()
  },
  async sync(ctx, localChanged) {
    ctx.setProgress('同步动物海报…')
    const store = useHomeStore()

    // Sync settings + animal list
    const settingsPath = ctx.rp('home_posters/settings.enc')
    type SyncedSettings = Omit<HomeSettings, 'animals'> & { animals?: AnimalEntry[] }
    const remoteSettings = await ctx.getEncrypted<SyncedSettings | null>(settingsPath, null)
    if (localChanged) {
      await ctx.putEncrypted(settingsPath, { ...store.settings, animals: store.animals })
    } else if (remoteSettings) {
      store.updateSettings(remoteSettings)
      if (Array.isArray(remoteSettings.animals) && remoteSettings.animals.length > 0) {
        store.animals = remoteSettings.animals
      }
    }

    // Sync poster stats
    const statsPath = ctx.rp('home_posters/poster-stats.enc')
    const remoteStats = await ctx.getEncrypted<Record<string, PosterDailyStat> | null>(statsPath, null)
    if (remoteStats) {
      for (const [date, rs] of Object.entries(remoteStats)) {
        const ls = store.posterStats[date]
        if (!ls || rs.costUsd > ls.costUsd) {
          store.posterStats = { ...store.posterStats, [date]: rs }
        }
      }
    }
    if (localChanged) {
      await ctx.putEncrypted(statsPath, store.posterStats)
    }

    // Sync poster manifest (metadata without images)
    type PosterMeta = Omit<AnimalPoster, 'imageBase64'>
    const manifestPath = ctx.rp('home_posters/manifest.enc')
    const localMeta: PosterMeta[] = store.posters.map(({ imageBase64: _img, ...rest }) => rest)
    const remoteMeta = await ctx.getEncrypted<PosterMeta[] | null>(manifestPath, null)

    if (localChanged) {
      await ctx.putEncrypted(manifestPath, localMeta)
    }

    // Pull poster images not present locally
    if (remoteMeta) {
      const localIds = new Set(store.posterIds)
      for (const meta of remoteMeta) {
        if (localIds.has(meta.id)) continue
        const imgPath = ctx.rp(`home_posters/${meta.id}.enc`)
        const imgData = await ctx.getEncrypted<{ imageBase64: string } | null>(imgPath, null)
        if (imgData) {
          const fullPoster: AnimalPoster = { ...meta, imageBase64: imgData.imageBase64 }
          await writePosterFile(fullPoster)
          store.posters.push(fullPoster)
          store.posterIds = store.posters.map(p => p.id)
        }
      }
      store.posters.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
      store.posterIds = store.posters.map(p => p.id)
    }

    // Push local images not on remote
    if (localChanged && remoteMeta) {
      const remoteIds = new Set(remoteMeta.map(m => m.id))
      for (const poster of store.posters) {
        if (remoteIds.has(poster.id)) continue
        const imgPath = ctx.rp(`home_posters/${poster.id}.enc`)
        await ctx.putEncrypted(imgPath, { imageBase64: poster.imageBase64 })
      }
    }

    localStorage.setItem(LS_MODIFIED_AT_KEY, new Date().toISOString())
  },
  async onSynced() {
    const store = useHomeStore()
    store.loadSettings()
    await store.loadPosters()
  },
}

syncService.register(homeSyncModule)
