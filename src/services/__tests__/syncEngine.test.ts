import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  computeChangeset,
  computeObjectChangeset,
  syncModule,
  registerSyncModule,
  clearSyncState,
  getLocalTombstones,
  setLocalTombstones,
  getLastSyncedState,
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

describe('computeChangeset', () => {
  it('returns all items as upserts when previous is empty', () => {
    const current = [{ id: '1', name: 'a', updatedAt: '2024-01-01T00:00:00Z' }]
    const result = computeChangeset(current, [])
    expect(result.upserts).toEqual(current)
    expect(result.deletes).toEqual([])
  })

  it('returns empty when nothing changed', () => {
    const items = [{ id: '1', name: 'a', updatedAt: '2024-01-01T00:00:00Z' }]
    const result = computeChangeset(items, items)
    expect(result.upserts).toEqual([])
    expect(result.deletes).toEqual([])
  })

  it('detects updates', () => {
    const prev = [{ id: '1', name: 'a', updatedAt: '2024-01-01T00:00:00Z' }]
    const cur = [{ id: '1', name: 'b', updatedAt: '2024-01-02T00:00:00Z' }]
    const result = computeChangeset(cur, prev)
    expect(result.upserts).toEqual(cur)
    expect(result.deletes).toEqual([])
  })

  it('detects deletes', () => {
    const prev = [{ id: '1', name: 'a', updatedAt: '2024-01-01T00:00:00Z' }]
    const cur: typeof prev = []
    const result = computeChangeset(cur, prev)
    expect(result.upserts).toEqual([])
    expect(result.deletes).toHaveLength(1)
    expect(result.deletes[0].id).toBe('1')
    expect(result.deletes[0].deletedAt).toBeTypeOf('string')
  })

  it('skips deletes already in tombstones', () => {
    const prev = [{ id: '1', name: 'a', updatedAt: '2024-01-01T00:00:00Z' }]
    const cur: typeof prev = []
    const tombstones: Record<string, string> = { '1': '2024-01-01T00:00:00Z' }
    const result = computeChangeset(cur, prev, tombstones)
    expect(result.deletes).toEqual([])
  })

  it('detects new inserts', () => {
    const prev = [{ id: '1', name: 'a', updatedAt: '2024-01-01T00:00:00Z' }]
    const cur = [
      { id: '1', name: 'a', updatedAt: '2024-01-01T00:00:00Z' },
      { id: '2', name: 'b', updatedAt: '2024-01-02T00:00:00Z' },
    ]
    const result = computeChangeset(cur, prev)
    expect(result.upserts).toEqual([{ id: '2', name: 'b', updatedAt: '2024-01-02T00:00:00Z' }])
    expect(result.deletes).toEqual([])
  })
})

describe('computeObjectChangeset', () => {
  it('returns upsert when previous is null', () => {
    const result = computeObjectChangeset({ theme: 'dark' }, null)
    expect(result.upserts).toHaveLength(1)
    expect(result.upserts[0].id).toBe('__root__')
    expect(result.upserts[0].theme).toBe('dark')
  })

  it('returns empty when objects are identical', () => {
    const obj = { theme: 'dark' }
    const result = computeObjectChangeset(obj, obj)
    expect(result.upserts).toEqual([])
    expect(result.deletes).toEqual([])
  })

  it('detects object changes', () => {
    const prev = { theme: 'dark' }
    const cur = { theme: 'light' }
    const result = computeObjectChangeset(cur, prev)
    expect(result.upserts).toHaveLength(1)
    expect(result.upserts[0].theme).toBe('light')
  })
})

describe('syncModule', () => {
  beforeEach(() => {
    localStorage.clear()
    mockIsBackendConfigured.mockReturnValue(true)
    mockApiPost.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  const makeModule = (overrides?: Partial<SyncModule<any>>): SyncModule<any> => ({
    name: 'test-module',
    getState: () => Promise.resolve([{ id: '1', title: 'hello' }]),
    getLastSyncedState: () => null,
    applyState: vi.fn().mockResolvedValue(undefined),
    serialize: (state: any) => state,
    deserialize: (raw: any) => raw,
    ...overrides,
  })

  it('returns false when backend is not configured', async () => {
    mockIsBackendConfigured.mockReturnValue(false)
    const mod = makeModule()
    registerSyncModule(mod)
    const result = await syncModule('test-module')
    expect(result).toBe(false)
    expect(mockApiPost).not.toHaveBeenCalled()
  })

  it('returns false for unknown module', async () => {
    const result = await syncModule('unknown-module')
    expect(result).toBe(false)
    expect(mockApiPost).not.toHaveBeenCalled()
  })

  it('performs full sync flow on success', async () => {
    const mod = makeModule()
    registerSyncModule(mod)

    mockApiPost.mockResolvedValueOnce({
      merged: [{ id: '1', title: 'merged' }],
      tombstones: [],
      syncedAt: '2024-06-01T00:00:00Z',
      serverChanges: { upserts: [], deletes: [] },
    })

    const result = await syncModule('test-module')
    expect(result).toBe(true)
    expect(mockApiPost).toHaveBeenCalledTimes(1)
    expect(mod.applyState).toHaveBeenCalledWith([{ id: '1', title: 'merged' }])
    expect(localStorage.getItem('muse-sync-since-test-module')).toBe('2024-06-01T00:00:00Z')
  })

  it('sends correct changeset for first sync', async () => {
    const mod = makeModule()
    registerSyncModule(mod)

    mockApiPost.mockResolvedValueOnce({
      merged: [{ id: '1', title: 'hello' }],
      tombstones: [],
      syncedAt: '2024-06-01T00:00:00Z',
      serverChanges: { upserts: [], deletes: [] },
    })

    await syncModule('test-module')
    const callArg = mockApiPost.mock.calls[0][1] as any
    expect(callArg.clientState).toEqual([{ id: '1', title: 'hello' }])
    expect(callArg.changes.upserts).toEqual([{ id: '1', title: 'hello' }])
    expect(callArg.changes.deletes).toEqual([])
    expect(callArg.since).toBeNull()
  })

  it('uses custom computeChangeset when provided', async () => {
    const customChangeset = { upserts: [{ id: '__root__', foo: 'bar' }], deletes: [] }
    const mod = makeModule({
      computeChangeset: () => customChangeset,
    })
    registerSyncModule(mod)

    mockApiPost.mockResolvedValueOnce({
      merged: { foo: 'bar' },
      tombstones: [],
      syncedAt: '2024-06-01T00:00:00Z',
      serverChanges: { upserts: [], deletes: [] },
    })

    await syncModule('test-module')
    const callArg = mockApiPost.mock.calls[0][1] as any
    expect(callArg.changes).toEqual(customChangeset)
  })

  it('retries on transient failure and eventually succeeds', async () => {
    const mod = makeModule()
    registerSyncModule(mod)

    mockApiPost
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({
        merged: [{ id: '1', title: 'hello' }],
        tombstones: [],
        syncedAt: '2024-06-01T00:00:00Z',
        serverChanges: { upserts: [], deletes: [] },
      })

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

  it('saves tombstones returned by server', async () => {
    const mod = makeModule()
    registerSyncModule(mod)

    mockApiPost.mockResolvedValueOnce({
      merged: [],
      tombstones: [{ id: '1', tableName: 'items', deletedAt: '2024-06-01T00:00:00Z' }],
      syncedAt: '2024-06-01T00:00:00Z',
      serverChanges: { upserts: [], deletes: [] },
    })

    await syncModule('test-module')
    const ts = getLocalTombstones('test-module')
    expect(ts['1']).toBe('2024-06-01T00:00:00Z')
  })

  it('merges tombstones with existing ones', async () => {
    setLocalTombstones('test-module', { '1': '2024-01-01T00:00:00Z' })

    const mod = makeModule()
    registerSyncModule(mod)

    mockApiPost.mockResolvedValueOnce({
      merged: [],
      tombstones: [{ id: '2', tableName: 'items', deletedAt: '2024-06-01T00:00:00Z' }],
      syncedAt: '2024-06-01T00:00:00Z',
      serverChanges: { upserts: [], deletes: [] },
    })

    await syncModule('test-module')
    const ts = getLocalTombstones('test-module')
    expect(ts['1']).toBe('2024-01-01T00:00:00Z')
    expect(ts['2']).toBe('2024-06-01T00:00:00Z')
  })

  it('saves last synced state', async () => {
    const mod = makeModule()
    registerSyncModule(mod)

    mockApiPost.mockResolvedValueOnce({
      merged: [{ id: '1', title: 'hello' }],
      tombstones: [],
      syncedAt: '2024-06-01T00:00:00Z',
      serverChanges: { upserts: [], deletes: [] },
    })

    await syncModule('test-module')
    expect(getLastSyncedState('test-module')).toEqual([{ id: '1', title: 'hello' }])
  })

  it('handles null response as failure', async () => {
    const mod = makeModule()
    registerSyncModule(mod)
    mockApiPost.mockResolvedValueOnce(null)

    const result = await syncModule('test-module')
    expect(result).toBe(false)
  })
})

describe('clearSyncState', () => {
  it('removes all sync keys for a module', async () => {
    localStorage.setItem('muse-sync-since-test', '2024-01-01T00:00:00Z')
    localStorage.setItem('muse-sync-state-test', '{}')
    localStorage.setItem('muse-sync-tombstones-test', '{}')

    await clearSyncState('test')

    expect(localStorage.getItem('muse-sync-since-test')).toBeNull()
    expect(localStorage.getItem('muse-sync-state-test')).toBeNull()
    expect(localStorage.getItem('muse-sync-tombstones-test')).toBeNull()
  })
})
