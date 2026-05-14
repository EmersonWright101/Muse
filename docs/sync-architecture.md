# Muse 同步架构说明

## 概览

Muse 的同步系统基于 **manifest-delta + LWW（Last-Write-Wins）** 模型，前端只负责收集变更和展示结果，所有冲突解决由后端完成。

```
前端                             后端
  │  POST /api/sync/{module}      │
  │  { manifest, changes, since } │
  ├──────────────────────────────►│
  │                               │  LWW merge
  │  { mergedItems, deletedIds,   │
  │    tombstones, syncedAt }     │
  │◄──────────────────────────────│
  │  applyIncrementalState()      │
```

---

## 核心概念

### Manifest（轻量清单）
每次同步客户端只发送 `{ id, updatedAt, _version }` 的数组，而非完整数据。后端根据清单判断哪些 item 的完整数据需要返回，客户端根据清单对比判断哪些 item 需要上传。

### Changeset
```typescript
{ upserts: T[], deletes: { id, deletedAt }[] }
```
仅包含自上次 manifest 快照以来**真正变化**的 item。

### Since 游标
每次成功同步后服务端返回 `syncedAt` 时间戳，客户端保存为下次同步的 `since` 参数，使服务端只需扫描该时间点后的数据。

### Tombstone
已删除 item 的服务端确认记录 `{ id, deletedAt }`，防止已确认删除的 item 在下次同步时被重复上报为 delete。

### LWW 冲突解决
以 `updatedAt` 时间戳为准，服务端统一做 LWW merge，客户端无冲突逻辑。

---

## 文件结构

```
src/services/
├── syncEngine.ts         # 核心引擎：SyncModule 接口、syncModule() 主循环
├── syncManager2.ts       # 所有模块注册、实现和编排（syncAllFromServer）
├── sync/
│   ├── state.ts          # 持久化：sync 游标和 tombstone 存文件，localStorage 作降级
│   └── protocol.ts       # 共享 TypeScript 类型定义

Muse-Backbend/modules/sync/
├── router.py             # FastAPI 路由，统一入口 POST /api/sync/{module}
└── engine.py             # LWW merge 逻辑、changeset 计算工具
```

---

## SyncModule 接口

```typescript
interface SyncModule<T> {
  name: string

  /** 读取当前完整本地状态 */
  getState: () => Promise<T> | T

  /** 读取轻量清单（id + updatedAt + _version），用于 delta 计算 */
  getManifest: () => Promise<LightweightItem[]> | LightweightItem[]

  /** 增量应用服务端返回的 mergedItems 和 deletedIds */
  applyIncrementalState: (mergedItems: T, deletedIds: string[]) => Promise<void>

  /**
   * 序列化：在 changeset 发送前调用。
   * 用于加密敏感字段（如 API key），必须在 changeset 计算之后、请求发送之前执行。
   */
  serialize: (state: T) => any | Promise<any>

  /** 反序列化：应用服务端数据前调用，用于解密等 */
  deserialize: (raw: any) => T | Promise<T>
}
```

---

## 新增模块完整流程

### 1. 后端：添加数据库操作

在对应的 `modules/<name>/db.py` 中实现：

```python
def fetch_sync_items() -> list[dict]:
    """返回所有 item，每条包含 id、updatedAt（ISO 字符串）、_version"""
    ...

def list_tombstones(since: str) -> list[dict]:
    """返回 since 之后被删除的 item，格式：{id, table_name, deleted_at}"""
    ...

def apply_sync_changes(upserts: list[dict], deletes: list[dict]) -> None:
    """将 upserts 写入数据库，将 deletes 中的 id 标记为删除"""
    ...
```

### 2. 后端：注册路由处理器

在 `modules/sync/router.py` 的 `_HANDLERS` 字典中添加：

```python
def _do_myfeature_sync(body: SyncRequest, user_id: str) -> dict:
    db_path = get_user_myfeature_db(user_id)
    myfeature_db.init_at(db_path)
    token = myfeature_db.set_db(db_path)
    try:
        server_items = myfeature_db.fetch_sync_items()
        server_tombstones = myfeature_db.list_tombstones(body.since or "")
        client_changes = body.changes or {}
        client_upserts = [dict(u) for u in client_changes.get("upserts", [])]
        client_deletes = [dict(d) for d in client_changes.get("deletes", [])]

        merged_items, deleted_ids, db_upserts, tombstones, server_changes = _resolve_sync_manifest(
            body.manifest, client_upserts, client_deletes,
            server_items, server_tombstones, body.since or "",
        )
        myfeature_db.apply_sync_changes(db_upserts, client_deletes)
        return {
            "mergedItems": merged_items,
            "deletedIds": deleted_ids,
            "tombstones": _fmt_tombstones(tombstones),
            "syncedAt": _now(),
            "serverChanges": server_changes,
        }
    finally:
        myfeature_db.reset_db(token)

_HANDLERS = {
    ...
    "myfeature": _do_myfeature_sync,  # ← 加这一行
}
```

### 3. 前端：实现 SyncModule

在 `syncManager2.ts` 中添加（按模块分区写，参考现有模块）：

```typescript
// ─── MyFeature module ────────────────────────────────────────────────────────

import type { MyItem } from '../utils/myFeatureStorage'

async function getMyFeatureState(): Promise<MyItem[]> {
  // 从本地文件/store 读取完整数据
  return loadMyItems()
}

async function getMyFeatureManifest(): Promise<{ id: string; updatedAt?: string }[]> {
  // 只返回元数据，不加载 content
  const items = await listMyItems()
  return items.map(i => ({ id: i.id, updatedAt: i.updatedAt }))
}

async function applyIncrementalMyFeatureState(
  mergedItems: MyItem[],
  deletedIds: string[],
): Promise<void> {
  for (const item of mergedItems) {
    await saveMyItem(item, { sync: false })
  }
  for (const id of deletedIds) {
    await deleteMyItemLocalOnly(id)
  }
  useMyFeatureStore().loadList()
}

const myFeatureModule: SyncModule<MyItem[]> = {
  name: 'myfeature',
  getState: getMyFeatureState,
  getManifest: getMyFeatureManifest,
  applyIncrementalState: applyIncrementalMyFeatureState,
  serialize: (state) => state,          // 无需加密直接透传
  deserialize: (raw) => Array.isArray(raw) ? raw as MyItem[] : [],
}
```

### 4. 前端：注册模块

在 `registerAllModules()` 中添加：

```typescript
function registerAllModules() {
  registerSyncModule(settingsModule)
  registerSyncModule(chatModule)
  // ...
  registerSyncModule(myFeatureModule)  // ← 加这一行
}
```

在 `syncAllFromServer()` 的 modules 数组中加入名称：

```typescript
const modules = ['settings', 'assistants', 'chat', 'todo', 'ebook', 'travel', 'notes', 'myfeature']
```

以及状态显示文案（可选）：

```typescript
setSyncModule(
  ...
  : moduleName === 'myfeature' ? '我的功能'
  : moduleName,
)
```

---

## 特殊情况处理

### ID 命名空间（多类型共用一张表）
当一个 DB 表存储多种类型的数据（如 todo 的 project/task，ebook 的 book/annotation），用前缀区分：

```typescript
// getState 时加前缀
{ ...item, id: `project:${item.id}`, _type: 'project' }

// applyIncrementalState 时去前缀
if (id.startsWith('project:')) {
  const realId = id.replace('project:', '')
  ...
}
```

后端同样需要在 `fetch_sync_items` 时加前缀，在 `apply_sync_changes` 时去前缀写库。

### 敏感字段加密（如 API key）
在 `serialize()` 中加密，在 `deserialize()` 中解密。加密必须在 changeset 计算之后发生（syncEngine 会先算 changeset，再调用 serialize），这样明文永远不会出现在发给服务端的 payload 中。

参考 settings 模块的 `serializeSettingsItems` / `deserializeSettingsItems`。

### 强制全量重新同步
```typescript
import { clearSyncState } from './syncEngine'
await clearSyncState('myfeature')  // 清除游标 + manifest 快照 + tombstones
await syncModule('myfeature')       // 下次以 since=null + 空 manifest 触发全量
```

---

## 同步状态持久化

| 数据 | 存储位置 | 说明 |
|------|----------|------|
| sync 游标（since 时间戳） | `{dataDir}/sync/cursors.json` | 降级到 `localStorage` |
| tombstone 缓存 | `{dataDir}/sync/tombstones/{module}.json` | 降级到 `localStorage` |
| manifest 快照 | `localStorage: muse-sync-manifest-{module}` | 用于 delta 计算 |

---

## 现有模块一览

| 模块名 | 数据类型 | 特殊处理 |
|--------|----------|----------|
| `settings` | 13 个分类 item（ai/chat/webSearch/…） | api key 加密；per-category LWW |
| `chat` | Conversation（含 messages） | 空对话过滤；图片 base64 上传 |
| `todo` | project/task（id 前缀命名空间） | — |
| `ebook` | book/progress/annotation/session/collection/meta | id 前缀命名空间 |
| `travel` | TravelNote | — |
| `notes` | group/note（id 前缀命名空间） | — |
| `assistants` | Assistant | — |
