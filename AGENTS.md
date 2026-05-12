# Muse Agent 指南

> 本文件为 AI Agent 提供项目背景、编码规范和常见任务的上下文信息。

---

## 项目概述

Muse 是一个基于 Tauri + Vue 3 + TypeScript 的桌面端 AI 助手应用，配套 Python FastAPI 后端。主要功能模块包括：AI 对话（chat）、待办（todo）、电子书（ebook）、旅行笔记（travel）、助手管理（assistants）、设置（settings）等。

---

## 技术栈

- **前端**：Vue 3（Composition API）+ TypeScript + Tailwind CSS + Vite
- **后端**：Python 3.11+ + FastAPI + SQLite（每个用户独立数据库）
- **通信**：HTTP REST API（Tauri `fetch`）+ 可选本地文件系统（Tauri FS API）

---

## 同步系统相关指南

### 添加新模块时如何接入统一同步框架

1. **前端**：在 `src/services/syncManager2.ts` 中注册 `SyncModule`：
   - 实现 `getState`（收集当前完整状态）
   - 实现 `applyState`（用后端合并结果覆盖本地状态）
   - 实现 `serialize / deserialize`（加密/格式转换）
   - 数组型数据无需自定义 `computeChangeset`；对象型数据使用 `computeObjectChangeset`
   - 在 `registerAllModules()` 中调用 `registerSyncModule(yourModule)`
   - 在 `syncAllFromServer()` 的模块列表中加入新模块名

2. **后端**：在 `modules/sync/router.py` 中：
   - 实现 `_do_<module>_sync` 函数（参考已有 `_do_chat_sync` 等）
   - 如果模块内包含多表实体，实现 `_normalize_<module>_item` 添加前缀
   - 在 `_HANDLERS` 字典中注册映射
   - 确保数据库 `db.py` 已实现 `fetch_sync_items`、`list_tombstones`、`apply_sync_changes`

3. **数据库 Schema**：
   - 所有参与同步的表必须包含 `_version INTEGER NOT NULL DEFAULT 0`
   - 软删除必须同时写入 tombstones 表（`id`, `table_name`, `deleted_at`）
   - tombstones 保留期建议 365 天

### 修改同步逻辑时的注意事项

- **禁止在前端做合并/去重/冲突解决**。所有此类逻辑必须下沉到后端 `modules/sync/engine.py` 或 `modules/sync/router.py`。
- 修改 `_resolve_sync` 后，必须运行回归测试：
  ```bash
  cd /Users/qichengwen/Documents/My_App_UI/Muse-Backbend
  python -m pytest modules/sync/test_router.py -v
  ```
- 首次同步（`since=''`）与增量同步（`since=ISO 时间戳`）行为不同，修改时需同时验证两种场景。
- 后端返回的 `merged` 是完整状态，前端应直接 `applyState(merged)`，不要与本地状态二次合并。
- `clientState` 上传的是完整状态而非增量，注意大模块（chat）的请求体大小。
- Tombstones 保存在前端 `localStorage`（`muse-sync-tombstones-{module}`），用户清除浏览器数据会导致同步状态丢失，但数据不会丢失（后端也有 tombstones）。

---

## 代码风格

- 使用单引号字符串（除非需要模板字符串或 JSON）
- 前端文件使用 2 空格缩进
- 优先使用 `async/await` 而非回调
- 避免在 `store` 初始化时产生副作用（使用 lazy import 打破循环依赖）
