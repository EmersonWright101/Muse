import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  computeLightweightChangeset,
  syncModule,
  registerSyncModule,
  clearSyncState,
  getTombstones,
  setTombstones,
  saveLastSyncedManifest,
  getLastSyncedManifest,
} from '../syncEngine'
import type { SyncModule } from '../syncEngine'
import { apiPost, isBackendConfigured } from '../api'

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  exists: vi.fn().mockResolvedValue(false),
  mkdir: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../utils/path', () => ({
  resolveDataRoot: vi.fn().mockResolvedValue('/mock/data'),
}))

vi.mock('../api', () => ({
  apiPost: vi.fn(),
  isBackendConfigured: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public readonly status: number, message: string) {
      super(message)
      this.name = 'ApiError'
    }
  },
}))

const mockApiPost = vi.mocked(apiPost)
const mockIsBackendConfigured = vi.mocked(isBackendConfigured)

// ─── computeLightweightChangeset ─────────────────────────────────────────────

describe('computeLightweightChangeset', () => {
  it('marks all items as upserts on first sync (empty previous manifest)', () => {
    const current = [{ id: '1', updatedAt: '2024-01-01T00:00:00Z' }]
    const full = [{ id: '1', title: 'hello', updatedAt: '2024-01-01T00:00:00Z' }]
    const { changes } = computeLightweightChangeset(current, [], full)
    expect(changes.upserts).toEqual(full)
    expect(changes.deletes).toEqual([])
  })

  it('emits no changes when manifest is identical', () => {
    const manifest = [{ id: '1', updatedAt: '2024-01-01T00:00:00Z' }]
    const full = [{ id: '1', title: 'hello', updatedAt: '2024-01-01T00:00:00Z' }]
    const { changes } = computeLightweightChangeset(manifest, manifest, full)
    expect(changes.upserts).toEqual([])
    expect(changes.deletes).toEqual([])
  })

  it('detects updates by updatedAt change', () => {
    const prev = [{ id: '1', updatedAt: '2024-01-01T00:00:00Z' }]
    const curr = [{ id: '1', updatedAt: '2024-01-02T00:00:00Z' }]
    const full = [{ id: '1', title: 'updated', updatedAt: '2024-01-02T00:00:00Z' }]
    const { changes } = computeLightweightChangeset(curr, prev, full)
    expect(changes.upserts).toEqual(full)
    expect(changes.deletes).toEqual([])
  })

  it('detects updates by _version change', () => {
    const prev = [{ id: '1', updatedAt: '2024-01-01T00:00:00Z', _version: 1 }]
    const curr = [{ id: '1', updatedAt: '2024-01-01T00:00:00Z', _version: 2 }]
    const full = [{ id: '1', title: 'bumped', updatedAt: '2024-01-01T00:00:00Z' }]
    const { changes } = computeLightweightChangeset(curr, prev, full)
    expect(changes.upserts).toEqual(full)
  })

  it('detects deletions', () => {
    const prev = [{ id: '1', updatedAt: '2024-01-01T00:00:00Z' }]
    const curr: typeof prev = []
    const { changes } = computeLightweightChangeset(curr, prev, [])
    expect(changes.deletes).toHaveLength(1)
    expect(changes.deletes[0].id).toBe('1')
  })

  it('skips deletions already confirmed in tombstones', () => {
    const prev = [{ id: '1', updatedAt: '2024-01-01T00:00:00Z' }]
    const { changes } = computeLightweightChangeset([], prev, [], { '1': '2024-01-01T00:00:00Z' })
    expect(changes.deletes).toEqual([])
  })
})

// ─── syncModule ───────────────────────────────────────────────────────────────

describe('syncModule', () => {
  beforeEach(() => {
    localStorage.clear()
    mockIsBackendConfigured.mockReturnValue(true)
    mockApiPost.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  const applyIncrementalState = vi.fn().mockResolvedValue(undefined)

  const makeModule = (overrides?: Partial<SyncModule<any>>): SyncModule<any> => ({
    name: 'test-module',
    getState: () => Promise.resolve([{ id: '1', title: 'hello', updatedAt: '2024-01-01T00:00:00Z' }]),
    getManifest: () => Promise.resolve([{ id: '1', updatedAt: '2024-01-01T00:00:00Z' }]),
    applyIncrementalState,
    serialize: (state: any) => state,
    deserialize: (raw: any) => raw,
    ...overrides,
  })

  const makeSuccessResponse = (overrides?: object) => ({
    mergedItems: [{ id: '1', title: 'merged', updatedAt: '2024-01-01T00:00:00Z' }],
    deletedIds: [],
    tombstones: [],
    syncedAt: '2024-06-01T00:00:00Z',
    serverChanges: { upserts: [], deletes: [] },
    ...overrides,
  })

  it('returns false when backend is not configured', async () => {
    mockIsBackendConfigured.mockReturnValue(false)
    registerSyncModule(makeModule())
    const result = await syncModule('test-module')
    expect(result).toBe(false)
    expect(mockApiPost).not.toHaveBeenCalled()
  })

  it('returns false for unknown module', async () => {
    const result = await syncModule('unknown-module-xyz')
    expect(result).toBe(false)
  })

  it('performs manifest sync flow on success', async () => {
    const mod = makeModule()
    registerSyncModule(mod)
    mockApiPost.mockResolvedValueOnce(makeSuccessResponse())

    const result = await syncModule('test-module')
    expect(result).toBe(true)
    expect(mockApiPost).toHaveBeenCalledTimes(1)
    expect(applyIncrementalState).toHaveBeenCalled()
  })

  it('sends manifest and since in request body', async () => {
    const mod = makeModule()
    registerSyncModule(mod)
    mockApiPost.mockResolvedValueOnce(makeSuccessResponse())

    await syncModule('test-module')
    const body = mockApiPost.mock.calls[0][1] as any
    expect(body.manifest).toEqual([{ id: '1', updatedAt: '2024-01-01T00:00:00Z' }])
    expect(body.since).toBeNull()
    expect(body.changes).toBeDefined()
  })

  it('saves manifest snapshot after successful sync', async () => {
    const mod = makeModule()
    registerSyncModule(mod)
    mockApiPost.mockResolvedValueOnce(makeSuccessResponse())

    await syncModule('test-module')
    const saved = getLastSyncedManifest('test-module')
    expect(saved).toEqual([{ id: '1', updatedAt: '2024-01-01T00:00:00Z' }])
  })

  it('saves tombstones returned by server', async () => {
    const mod = makeModule()
    registerSyncModule(mod)
    mockApiPost.mockResolvedValueOnce(makeSuccessResponse({
      tombstones: [{ id: '99', tableName: 'items', deletedAt: '2024-06-01T00:00:00Z' }],
    }))

    await syncModule('test-module')
    const ts = await getTombstones('test-module')
    expect(ts['99']).toBe('2024-06-01T00:00:00Z')
  })

  it('merges new tombstones with existing ones', async () => {
    await setTombstones('test-module', { '1': '2024-01-01T00:00:00Z' })
    const mod = makeModule()
    registerSyncModule(mod)
    mockApiPost.mockResolvedValueOnce(makeSuccessResponse({
      tombstones: [{ id: '2', tableName: 'items', deletedAt: '2024-06-01T00:00:00Z' }],
    }))

    await syncModule('test-module')
    const ts = await getTombstones('test-module')
    expect(ts['1']).toBe('2024-01-01T00:00:00Z')
    expect(ts['2']).toBe('2024-06-01T00:00:00Z')
  })

  it('retries on transient failure and eventually succeeds', async () => {
    const mod = makeModule()
    registerSyncModule(mod)
    mockApiPost
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(makeSuccessResponse())

    const result = await syncModule('test-module')
    expect(result).toBe(true)
    expect(mockApiPost).toHaveBeenCalledTimes(3)
  })

  it('throws after exhausting retries', async () => {
    const mod = makeModule()
    registerSyncModule(mod)
    mockApiPost.mockRejectedValue(new Error('Server 500'))

    await expect(syncModule('test-module')).rejects.toThrow('Server 500')
    expect(mockApiPost).toHaveBeenCalledTimes(4) // initial + 3 retries
  }, 10000)

  it('handles null response as failure', async () => {
    const mod = makeModule()
    registerSyncModule(mod)
    mockApiPost.mockResolvedValueOnce(null)

    const result = await syncModule('test-module')
    expect(result).toBe(false)
  })
})

// ─── clearSyncState ───────────────────────────────────────────────────────────

describe('clearSyncState', () => {
  it('removes all sync keys for a module', async () => {
    localStorage.setItem('muse-sync-since-test', '2024-01-01T00:00:00Z')
    localStorage.setItem('muse-sync-tombstones-test', '{}')
    saveLastSyncedManifest('test', [{ id: '1', updatedAt: '2024-01-01T00:00:00Z' }])

    await clearSyncState('test')

    expect(localStorage.getItem('muse-sync-since-test')).toBeNull()
    expect(localStorage.getItem('muse-sync-tombstones-test')).toBeNull()
    expect(localStorage.getItem('muse-sync-manifest-test')).toBeNull()
  })
})
