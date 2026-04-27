import { syncService } from '../../services/sync'
import type { SyncModule } from '../../services/sync/types'

const MOD_LAYOUT = 'variantLayout'
const LS_LAYOUT_KEY = 'muse-variant-layout'
const LS_LAYOUT_MODIFIED_AT = 'muse-variant-layout-modified-at'

const layoutSyncModule: SyncModule = {
  id: MOD_LAYOUT,
  remoteDirs: ['settings'],
  getLocalTimestamp() {
    return localStorage.getItem(LS_LAYOUT_MODIFIED_AT) ?? new Date(0).toISOString()
  },
  async sync(ctx, localChanged) {
    ctx.setProgress('同步消息布局设置…')
    const path = ctx.rp('settings/variant_layout.enc')
    const raw = localStorage.getItem(LS_LAYOUT_KEY)
    const localData = raw ? { layout: raw } : {}

    const remoteData = await ctx.getEncrypted<Record<string, unknown> | null>(path, null)

    if (!remoteData) {
      if (localChanged && Object.keys(localData).length > 0) {
        await ctx.putEncrypted(path, localData)
      }
      return
    }

    const localTs = await this.getLocalTimestamp()
    const remoteTs = (remoteData as Record<string, unknown> & { __syncTs?: string }).__syncTs ?? new Date(0).toISOString()

    if (remoteTs > localTs && remoteData.layout) {
      localStorage.setItem(LS_LAYOUT_KEY, String(remoteData.layout))
    }

    if (!localChanged) return
    await ctx.putEncrypted(path, { ...localData, __syncTs: new Date().toISOString() })
  },
}

syncService.register(layoutSyncModule)
