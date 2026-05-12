# Muse 同步架构文档（前端视角）

> 版本：v2（统一同步引擎）  
> 适用范围：settings、chat、todo、ebook、travel、assistants

---

## 设计原则

1. **前端只负责收集本地变更并上传到后端**  
   前端通过对比「当前状态」与「上次同步状态」计算出 changeset（upserts + deletes），原样发送到后端。

2. **后端负责所有合并、去重、冲突解决**  
   后端收到前后双方完整状态 + changeset 后，执行三路合并（3-way merge），返回合并后的最终状态。

3. **前端只负责展示后端返回的合并结果**  
   前端拿到 `merged` 后直接调用 `applyState()` 替换本地状态，不做任何额外合并判断。

> ⚠️ 重要：前端代码中**禁止**在同步流程中写任何合并、去重、冲突解决逻辑。所有此类逻辑必须下沉到后端 `modules/sync/engine.py`。

---

## 同步协议

### 请求格式

```http
POST /api/sync/{module}
Content-Type: application/json
Authorization: Bearer <apiKey>
```

支持模块：`settings`、`chat`、`todo`、`ebook`、`travel`、`assistants`

```typescript
interface SyncRequest {
  /** 当前完整状态（经 serialize 后） */
  clientState: any
  /** 本地变更集 */
  changes: Changeset
  /** 上次同步时间戳（ISO 8601）；首次同步为 null */
  since: string | null
}

interface Changeset {
  upserts: any[]      // 新增或修改的项
  deletes: Array<{ id: string; deletedAt: string }>  // 删除的项
}
```

### 响应格式

```typescript
interface SyncResponse {
  /** 后端合并后的完整状态 */
  merged: any
  /** 服务器已确认删除的 tombstones */
  tombstones: Array<{ id: string; tableName: string; deletedAt: string }>
  /** 本次同步时间戳，前端需保存用于下次增量同步 */
  syncedAt: string
  /** 服务端相对于上次同步的变更（用于前端展示/日志） */
  serverChanges: Changeset
}
```

---

## 模块注册

每个数据域需要在 `syncManager2.ts` 中注册一个 `SyncModule`：

```typescript
import { registerSyncModule } from './services/syncEngine'
import type { SyncModule } from './services/syncEngine'

const myModule: SyncModule<MyState> = {
  name: 'myModule',               // 对应 /api/sync/myModule
  getState: async () => { /* 返回当前完整状态 */ },
  getLastSyncedState: () => getLastSyncedState('myModule'),
  applyState: async (state) => { /* 用合并结果覆盖本地状态 */ },
  serialize: (state) => state,    // 上传前加密/转换
  deserialize: (raw) => raw,      // 下载后解密/转换
  // 可选：非数组数据（如 settings）需自定义 changeset 计算
  computeChangeset: (current, previous) => computeObjectChangeset(current, previous),
}

registerSyncModule(myModule)
```

### 数组型数据（默认）

chat、todo、travel、assistants 均为数组型数据，使用 `syncEngine.ts` 内置的 `computeChangeset`：

```typescript
// 自动对比 current 与 previous 的每一项 JSON 差异
computeChangeset(current, previous, tombstones)
```

### 对象型数据（需自定义）

settings 是对象而非数组，需使用 `computeObjectChangeset`：

```typescript
computeObjectChangeset(current, previous)
// → { upserts: [{ id: '__root__', ...current }], deletes: [] }
```

---

## 首次同步 vs 增量同步

| 场景 | `since` 值 | 行为 |
|------|-----------|------|
| 首次同步 | `null` 或 `''` | 后端不会将服务端存量数据标记为「变更」，而是与客户端数据做 LWW 合并 |
| 增量同步 | 上次 `syncedAt` | 后端仅将 `updatedAt > since` 的服务端记录视为变更 |

### 关键 Bug 修复记录

**问题：首次同步覆盖本地数据**  
旧实现中，首次同步时 `since=''` 会导致服务端所有记录被标记为 `server_changed`，从而无条件覆盖客户端本地数据。

**修复：** 后端 `_resolve_sync` 在 `is_first_sync = not since` 时跳过服务端变更标记，所有记录均走 LWW（version > updatedAt）合并。  
回归测试：`modules/sync/test_router.py::TestResolveSyncFirstSync`

---

## 冲突解决策略

后端合并引擎采用以下优先级：

1. **version 优先**：如果两项均包含 `_version` 字段，version 大者胜。
2. **updatedAt 次之**：如果 version 相同或不存在，比较 `updatedAt`，新者胜。
3. **删除 vs 修改**：删除操作也有时间戳（`deletedAt`），与修改时间戳做 LWW 比较。

前端**不需要**关心这些细节，只需确保每条记录在上传时携带准确的 `updatedAt`（以及可选的 `_version`）。

---

## 版本控制

- 每条记录（或 settings 的 `__root__`）可携带 `_version: integer` 字段。
- 后端每次写入成功后会将 `_version` 自增 +1。
- 前端通常不主动维护 `_version`，仅在反序列化后透传回本地存储即可。

---

## 错误处理

`syncEngine.ts` 内置了指数退避重试：

```typescript
const MAX_RETRIES = 3
const RETRY_DELAYS_MS = [1000, 2000, 4000]
```

重试结束后仍失败则抛出异常，由 `syncManager2.ts` 的 `syncAllFromServer` 捕获并记录到 `syncStatus` store，**不会中断其他模块的同步**。

### 强制全量同步

如果本地同步状态损坏（如 tombstones 丢失导致删除重复上报），可调用：

```typescript
import { forceSyncAll } from './services/syncManager2'
await forceSyncAll()   // 清除所有 since / state / tombstones 后重新同步
```

### 清除单个模块同步状态

```typescript
import { clearSyncState } from './services/syncEngine'
clearSyncState('chat')   // 下次同步将视为首次同步
```

---

## 迁移指南（从旧同步到新同步）

### 旧同步方式

旧同步（`syncManager.ts`）特点：
- 每个模块有独立的 REST API（如 `GET /api/settings`、`POST /api/chat/sync` 等）
- 前端需要自行合并服务端数据到本地（如 `mergeConversationsByContent`、`mergeConversation`）
- 首次使用后端时需要手动调用 `migrateConvsToServer` 等迁移函数

### 新同步方式

新同步（`syncManager2.ts` + `syncEngine.ts`）特点：
- 统一端点 `POST /api/sync/{module}`
- 前端不做合并，只负责收集变更和展示结果
- 自动处理首次同步，无需手动迁移

### 迁移步骤

1. **后端**：确保对应模块已实现 `_HANDLERS`（见后端文档）。
2. **前端**：在 `syncManager2.ts` 中注册 `SyncModule`（参考已有模块示例）。
3. **替换调用点**：将旧同步调用替换为 `syncModule('xxx')` 或 `syncAllFromServer()`。
4. **删除旧逻辑**：删除前端的合并/去重代码（如 `mergeConversation`、`mergeConversationsByContent`）。
5. **测试首次同步**：删除本地 `muse-sync-since-*` 和 `muse-sync-state-*` 后重启应用，验证本地数据不会被服务端覆盖。

---

## 已知问题与注意事项

### 1. 不支持真正的离线队列

当前实现仅在**有网络连接时**才会尝试同步。如果在离线期间产生了本地变更：
- 变更会保存在本地存储中；
- 但**不会**被排队等待网络恢复后自动上传；
- 用户需要手动触发同步（或等待下次自动同步）。

> 未来改进方向：在 `syncEngine` 中加入离线变更队列，网络恢复后自动批量上报。

### 2. 大状态全量上传

`clientState` 字段会携带当前模块的**完整状态**，对于 chat 等数据量大的模块，首次同步时请求体可能较大。后端合并引擎依赖完整状态进行三路合并，因此暂无法改为纯增量上传。

### 3. Tombstones 依赖 localStorage

`tombstones`、`lastSyncedState`、`since` 均存储在 `localStorage` 中：
- 用户清除浏览器数据会导致同步状态丢失，下次同步将视为首次同步；
- 由于后端也保存了 tombstones，数据不会丢失，但可能出现短暂的重复删除上报（后端会忽略）。

### 4. 并发同步风险

如果用户在同步过程中继续操作本地数据，可能导致「本次 changeset」与「实际操作」不一致。当前缓解措施：
- 同步操作通常在应用启动或用户手动触发时执行；
- 同步期间不会阻塞 UI，但可能产生短暂的最终一致性延迟。

### 5. Settings 的 `__root__` ID

settings 模块使用 `id: '__root__'` 作为对象型数据的伪主键。如果后端模块也使用对象型数据，请保持一致约定。
