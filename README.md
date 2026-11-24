# dsh-memory-bank

A durable memory bank for [DeepSeek Harness](https://github.com/deepseek-ai) (DSH), shared by the agent and the human.

The agent reads and maintains it through a `remember` tool. You manage the same bank from **Settings → Memory**. A small set of entries you pin is injected into every request as standing context; everything else is retrieved on demand. No build step, no external dependencies, no network calls.

```
Agent ── remember tool ──┐
                         ├── Host store ── storage domain ── ~/.dsh/storages/
Human ── Settings page ──┘
```

## Features

- **One bank, two callers.** The agent's tool and the settings page both go through the same Host store methods, so the two surfaces cannot drift.
- **Always-on entries.** Pin the entries that define identity, boundaries, or hard preferences; they are re-rendered into the system prompt on every model step. Unpinned entries stay out of the prompt and cost nothing until retrieved.
- **Human-controlled pinning.** Only the settings page can pin or unpin. The agent's tool has no `pinned` parameter, and the Host ignores a pin in the agent's update path — an agent cannot grant itself new boundaries.
- **Bounded always-on budget.** 2000 characters total (title + content + tags). A pin that would exceed it is rejected with the used / incoming numbers, and the page shows a running counter.
- **Durable and schema-validated.** Records live in a DSH storage domain backed by the JSON storage backend, independent of any session log.
- **Bilingual UI.** English and Chinese, following the DSH locale.
- **Local only.** No telemetry, no third-party requests, no listeners beyond the DSH web server.

## Install

Requires DSH with the web surface (the Settings page is a `settings.section` client plugin).

In DSH's plugin install dialog, paste one of:

```text
github:NamesBlues/dsh-Memory-Bank
```

or the absolute path to a local checkout:

```text
C:\path\to\dsh-Memory-Bank
```

Then open **Settings → Memory**. The plugin row id is `memory-bank`; the package name is `dsh-memory-bank`.

To update: reinstall the same spec (or `git pull` and reload the plugin row). The app itself is not modified.

## Usage

### The agent

One tool, five actions:

| Action | Required arguments | Notes |
| --- | --- | --- |
| `list` | — | Optional `query` (case-insensitive substring) and `limit` (default 50, max 200). Always-on entries sort first. |
| `read` | `id` | Returns one entry. |
| `create` | `title`, `content` | Optional `tags`. |
| `update` | `id` | Any of `title`, `content`, `tags`. |
| `delete` | `id` | Removes one entry. |

A short prompt section tells every agent that the bank exists, that pinned entries are already in context, and that the rest must be retrieved before being relied on.

### The settings page

Search titles, content, and tags; filter by tag; create, edit, pin/unpin, delete (with confirmation). The page polls every 4 seconds, so entries written by the agent appear while it is open.

### Always-on entries

- Pinned entries are rendered into a `memory-bank:resident` system section placed right after the deployment persona (order 10). It is a **section**, not runtime context, so a persona that suppresses optional runtime context cannot silently erase the user's boundaries.
- The block is recomputed after every write, and the domain opens eagerly at plugin activation so the block exists from the first request of the process.
- Budget: **2000 characters** across all pinned entries. Everything else stays tool-retrieved.

## Data

One storage domain (`dsh_memory_bank`, version 1, `per-record` layout) with a single `entries` table. Each entry is one JSON file:

```
~/.dsh/storages/dsh_memory_bank/entries/<uuid>.json
```

Record shape:

```json
{
  "id": "uuid",
  "title": "short name",
  "content": "the note",
  "tags": ["preference"],
  "source": "ai | human",
  "pinned": false,
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

Limits: title 200 characters, content 20000, up to 20 tags of 40 characters.

## Privacy and security

- Everything is stored locally under `~/.dsh/storages/`. The plugin makes no outbound requests and reports no telemetry.
- The settings page talks to the Host over the existing authenticated DSH connection. The route passes the connection's browser trust fence: requests without the browser session are rejected (401), and cross-site or rebound requests are rejected (403).
- The agent cannot read or write the bank over HTTP; it only has the tool, and the tool cannot pin.
- Entries are notes, not an enforcement mechanism. The prompt tells the agent not to store secrets, but that is guidance, not a guarantee — do not put credentials in the bank.

## HTTP API

For tooling and debugging only; the settings page is the intended client. All methods require the authenticated browser session.

`GET /dsh-memory/api` → `{ ok, version, items, resident: { limit, used } }`

`POST /dsh-memory/api` with a JSON body:

```json
{ "action": "create", "title": "...", "content": "...", "tags": ["..."], "pinned": false }
{ "action": "update", "id": "...", "title": "...", "content": "...", "tags": ["..."], "pinned": true }
{ "action": "delete", "id": "..." }
{ "action": "list", "query": "...", "limit": 200 }
```

A rejected body carries `code` and, for the budget case, `details: { used, incoming, limit }`.

## Compatibility

- Built and tested against **DSH 0.2.1-rc.5** on Windows; the client half needs the web surface (`dsh.client` platform `web`).
- No build step: `index.js` and `client.js` are plain ESM / `window.__ModuleLoader__` modules. No `node_modules`, no bundler.
- Node.js >= 20 (uses `node:crypto` `randomUUID`).

## Development

```sh
node --check index.js
node --check client.js
```

Install the folder as a local bundle, then toggle the plugin row (`include:memory-bank`) to reload it. The storage domain keeps its data across reloads.

Files:

| File | Purpose |
| --- | --- |
| `index.js` | Host half: storage domain, `remember` tool, prompt sections, JSON route. |
| `client.js` | Client half: the `settings.section` page. |
| `cordis.patch.yml` | Inserts the `memory-bank` row. |
| `locale/en.json`, `locale/zh.json` | Plugin Manager title and description. |
| `icon.svg` | Plugin icon. |

## License

MIT. See [LICENSE](LICENSE).

---

## 中文说明

给 DeepSeek Harness 用的长期记忆库，AI 和人都能读写。

- **AI 侧**：`remember` 工具，动作为 `list` / `read` / `create` / `update` / `delete`；事实类内容先检索再使用。
- **人侧**：设置里的「记忆库」页，可搜索、按标签筛选、新建、编辑、删除（删除需确认）。
- **常驻**：只有人能把条目设为常驻；常驻内容（身份、边界、硬偏好）每轮注入系统提示，总预算 2000 字符，超出会被拒绝并提示已用/新增数量。AI 的工具没有 `pinned` 参数，也无法通过更新接口改常驻状态。
- **数据**：只存在本机 `~/.dsh/storages/dsh_memory_bank/`，不联网、不埋点；设置页的接口走 DSH 现有登录态，未登录请求返回 401。
- **安装**：在 DSH 插件安装框中填 `github:NamesBlues/dsh-Memory-Bank`，或本地目录绝对路径。
- **许可**：MIT。
