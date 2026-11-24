/**
 * dsh-memory-bank — Host half.
 *
 * One durable, plugin-owned memory bank shared by the agent and the human:
 *
 *  - the agent reaches it through the `remember` tool (list / read / create /
 *    update / delete), so it can recall and maintain notes across sessions;
 *  - the human reaches it through the settings page (client.js), which talks to
 *    the small JSON route below over the existing authenticated connection.
 *
 * Both callers run through the same store functions, so the two surfaces cannot
 * drift apart. Records live in a schema-validated storage domain, not in the
 * session log: memory is cross-session data, and the log is per-session.
 */

import { randomUUID } from 'node:crypto'

/** Cordis plugin name (also the Loader row id in cordis.patch.yml). */
export const name = 'dsh-memory-bank'

/** Host services this plugin cannot work without. */
export const inject = ['tools', 'systemPrompt', 'webServer', 'storageDomain']

/** Route prefix of the human-facing JSON API. */
const ROUTE = '/dsh-memory/api'
/** Storage domain identity; the version gates the record schema. Storage unit
 * names must match `^[a-z][a-z0-9_]*$`, so underscores, not hyphens. */
const DOMAIN = 'dsh_memory_bank'
const DOMAIN_VERSION = 1
/** Bounds keep one model call (and one HTTP body) from flooding the bank. */
const LIMITS = { title: 200, content: 20000, tags: 20, tag: 40, list: 200 }
const SOURCES = ['ai', 'human']
/**
 * Characters of user-pinned (always-on) memory injected into every request.
 * Pinned entries are re-sent on each model step, so this is a hard budget, not
 * a soft hint: the human is told when a pin would exceed it.
 */
const RESIDENT_BUDGET = 2000

/**
 * Raw JSON Schema (the enforced subset) describing one entry in tool output.
 * Shared by the list items and the single-entry field.
 */
const MEMORY_ENTRY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'content', 'tags', 'source', 'pinned', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    content: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    source: { type: 'string', enum: SOURCES },
    pinned: { type: 'boolean' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
}

/** The single table; the record key is the entry id. */
const ENTRY_TABLE = 'entries'

/**
 * Validated record schema for the storage domain. The domain only calls
 * `parse`, so this hand-written guard keeps the plugin free of a build step and
 * of a direct zod/schemastery dependency.
 */
const entrySchema = {
  parse(input) {
    const value = input
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TypeError('memory entry must be an object')
    }
    if (typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 128) {
      throw new TypeError('memory entry id must be a non-empty string')
    }
    const title = requireText(value.title, 'title', LIMITS.title)
    const content = requireText(value.content, 'content', LIMITS.content)
    const tags = normalizeTags(value.tags)
    const source = SOURCES.includes(value.source) ? value.source : 'ai'
    // Legacy records predate pinning; absence means "not always-on".
    const pinned = value.pinned === true
    const createdAt = requireTimestamp(value.createdAt, 'createdAt')
    const updatedAt = requireTimestamp(value.updatedAt, 'updatedAt')
    return { id: value.id, title, content, tags, source, pinned, createdAt, updatedAt }
  },
}

/** The domain declaration handed to `storageDomain.open()`. */
const DOMAIN_SPEC = {
  name: DOMAIN,
  version: DOMAIN_VERSION,
  layout: 'per-record',
  tables: { [ENTRY_TABLE]: { valueSchema: entrySchema } },
}

/* ── record field guards ─────────────────────────────────────────────────── */

function requireText(value, field, max) {
  if (typeof value !== 'string') throw new TypeError(`memory ${field} must be a string`)
  const text = value.trim()
  if (text.length === 0) throw new TypeError(`memory ${field} must not be empty`)
  if (text.length > max) throw new TypeError(`memory ${field} must be at most ${max} characters`)
  return text
}

function requireTimestamp(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 40) {
    throw new TypeError(`memory ${field} must be an ISO timestamp string`)
  }
  return value
}

function normalizeTags(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new TypeError('memory tags must be an array of strings')
  const tags = []
  for (const raw of value) {
    if (typeof raw !== 'string') throw new TypeError('memory tags must be an array of strings')
    const tag = raw.trim()
    if (tag.length === 0) continue
    if (tag.length > LIMITS.tag) throw new TypeError(`memory tag must be at most ${LIMITS.tag} characters`)
    if (!tags.includes(tag)) tags.push(tag)
    if (tags.length > LIMITS.tags) throw new TypeError(`memory may carry at most ${LIMITS.tags} tags`)
  }
  return tags
}

function normalizeSource(value) {
  if (value === undefined || value === null) return 'human'
  if (!SOURCES.includes(value)) throw new TypeError(`memory source must be one of ${SOURCES.join(', ')}`)
  return value
}

/* ── store: the one implementation of every operation ────────────────────── */

/**
 * Pure, JSON-in/JSON-out operations over the domain table. The tool and the
 * HTTP route each resolve the table and call these, so behavior is identical
 * for both callers. `onChange` runs after a committed write so the always-on
 * block can be recomputed without either caller remembering to do it.
 *
 * Pinning is the human's call: `source === 'human'` is the gate, and the tool
 * path never presents that source, so the agent cannot pin itself.
 */
function createStore(table, onChange = () => {}) {
  /** Always-on first, then newest; ties broken by id so a bank always renders the same. */
  function entries() {
    const rows = []
    for (const [, value] of table.entries()) rows.push(value)
    rows.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
    })
    return rows
  }

  function matches(entry, query) {
    if (query === undefined || query.length === 0) return true
    const haystack = [entry.title, entry.content, entry.tags.join(' ')].join('\n').toLowerCase()
    return haystack.includes(query.toLowerCase())
  }

  function list(options = {}) {
    const query = typeof options.query === 'string' ? options.query.trim() : ''
    const limit = Number.isInteger(options.limit) && options.limit > 0
      ? Math.min(options.limit, LIMITS.list)
      : 50
    const all = entries()
    const filtered = query.length === 0 ? all : all.filter((entry) => matches(entry, query))
    return {
      items: filtered.slice(0, limit),
      total: filtered.length,
      truncated: filtered.length > limit,
    }
  }

  function read(id) {
    const key = requireId(id)
    const entry = table.get(key)
    if (entry === undefined) throw new MemoryError('not-found', `no memory with id ${JSON.stringify(key)}`)
    return entry
  }

  function create(input, source) {
    requireCreateFields(input)
    const now = new Date().toISOString()
    const entry = entrySchema.parse({
      id: randomUUID(),
      title: input.title,
      content: input.content,
      tags: input.tags,
      source: normalizeSource(source),
      pinned: source === 'human' && input.pinned === true,
      createdAt: now,
      updatedAt: now,
    })
    assertResidentBudget(entry)
    return table.put(entry.id, entry).then(() => {
      onChange()
      return entry
    })
  }

  function update(id, patch, source) {
    const key = requireId(id)
    const current = read(key)
    const next = entrySchema.parse({
      ...current,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      // Only the human surface may change pinning; the agent keeps the old value.
      ...(source === 'human' && patch.pinned !== undefined ? { pinned: patch.pinned === true } : {}),
      ...(source !== undefined ? { source: normalizeSource(source) } : {}),
      updatedAt: new Date().toISOString(),
    })
    assertResidentBudget(next)
    return table.update(key, () => next).then(() => {
      onChange()
      return next
    })
  }

  function remove(id) {
    const key = requireId(id)
    const current = read(key)
    return table.delete(key).then(() => {
      onChange()
      return current
    })
  }

  function pinned() {
    return entries().filter((entry) => entry.pinned)
  }

  /** Reject a pin that would push the always-on block over budget. */
  function assertResidentBudget(candidate) {
    if (!candidate.pinned) return
    const others = entries().filter((entry) => entry.pinned && entry.id !== candidate.id)
    const incoming = entryWeight(candidate)
    const used = others.reduce((sum, entry) => sum + entryWeight(entry), 0)
    if (used + incoming > RESIDENT_BUDGET) {
      throw new MemoryError(
        'budget',
        `always-on memory would exceed its budget: ${used} used + ${incoming} new > ${RESIDENT_BUDGET} characters`,
        { used, incoming, limit: RESIDENT_BUDGET },
      )
    }
  }

  function snapshot() {
    const rows = entries()
    return {
      version: DOMAIN_VERSION,
      items: rows,
      resident: {
        limit: RESIDENT_BUDGET,
        used: rows.filter((entry) => entry.pinned).reduce((sum, entry) => sum + entryWeight(entry), 0),
      },
    }
  }

  return { list, read, create, update, remove, pinned, snapshot }
}

/** What one always-on entry costs in the injected block (tags included). */
function entryWeight(entry) {
  return entry.title.length + entry.content.length + (entry.tags ?? []).join('').length
}

/** A failure the caller should report rather than treat as a crash. */
class MemoryError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'MemoryError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

function requireId(id) {
  if (typeof id !== 'string' || id.trim().length === 0) throw new MemoryError('invalid', 'memory id must be a non-empty string')
  return id.trim()
}

function requireCreateFields(input) {
  if (typeof input.title !== 'string' || input.title.trim().length === 0) {
    throw new MemoryError('invalid', 'title is required')
  }
  if (typeof input.content !== 'string' || input.content.trim().length === 0) {
    throw new MemoryError('invalid', 'content is required')
  }
}

/* ── Host plugin ─────────────────────────────────────────────────────────── */

export function apply(ctx) {
  /** Opened once; both callers await the same promise. */
  let opening
  let domainHandle
  let storeHandle
  /** Rendered always-on block; recomputed on open and after every write. */
  let residentText = ''

  function recomputeResident() {
    residentText = storeHandle === undefined ? '' : renderResident(storeHandle.pinned())
  }

  function store() {
    if (opening === undefined) {
      opening = ctx.storageDomain.open(DOMAIN_SPEC).then(
        (domain) => {
          domainHandle = domain
          storeHandle = createStore(domain.table(ENTRY_TABLE), recomputeResident)
          recomputeResident()
          return storeHandle
        },
        (error) => {
          opening = undefined
          throw error
        },
      )
    }
    return opening
  }

  // One owner for the domain lifetime: closing waits for an in-flight open so a
  // teardown racing the first access cannot leak the handle.
  ctx.effect(() => () => {
    const pending = opening
    if (pending === undefined) return undefined
    return pending
      .then(() => domainHandle?.close?.())
      .catch(() => {})
  }, 'memory-bank.domain')

  registerTool(ctx, store)
  registerPromptSection(ctx, () => residentText)
  registerHttpRoute(ctx, store)
  // Open at activation, not on first use: the always-on block must exist from
  // the first request of the process, before anyone calls the tool or the page.
  store().catch(() => {})
}

/** The always-on block injected into every request; empty when nothing is pinned. */
function renderResident(pinnedEntries) {
  if (pinnedEntries.length === 0) return ''
  const body = pinnedEntries
    .map((entry) => {
      const tags = entry.tags.length > 0 ? ` [${entry.tags.join(', ')}]` : ''
      return `### ${entry.title}${tags}\n${entry.content}`
    })
    .join('\n\n')
  return [
    'Always-on memory — entries the user pinned for every turn. Treat these as standing instructions and background facts:',
    '',
    body,
  ].join('\n')
}

/**
 * The agent-facing tool. One tool with an `action` parameter keeps a single
 * vocabulary for all five operations and one result shape.
 */
function registerTool(ctx, store) {
  const definition = {
    name: 'remember',
    description: [
      'Read and maintain your persistent memory bank — durable notes that survive this session: user preferences, project facts, decisions, and anything worth recalling later.',
      'Actions: `list` (optionally filtered by `query`, newest first), `read` (one entry by `id`), `create` (new entry from `title` + `content`, with optional `tags`), `update` (change `title`, `content`, or `tags` of `id`), `delete` (remove `id`).',
      'Entries the user pinned are already visible in the "Always-on memory" block of your prompt; everything else must be fetched with `list` before you rely on it. Only the user can pin or unpin entries.',
      'The user can see and edit the same bank in Settings → Memory, so keep entries short, factual, and written for both audiences. List before assuming nothing is stored.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'read', 'create', 'update', 'delete'],
          description: 'Operation to perform.',
        },
        id: { type: 'string', description: 'Entry id; required by read, update, and delete.' },
        title: { type: 'string', description: 'Short title; required by create.' },
        content: { type: 'string', description: 'Full note text; required by create.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional labels; replaces all tags on update.' },
        query: { type: 'string', description: 'Case-insensitive substring filter for list.' },
        limit: { type: 'integer', description: 'Maximum entries returned by list (default 50, max 200).' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['list', 'read', 'create', 'update', 'delete'] },
          items: { type: 'array', items: MEMORY_ENTRY_SCHEMA },
          total: { type: 'integer' },
          truncated: { type: 'boolean' },
          entry: MEMORY_ENTRY_SCHEMA,
        },
      },
      render: (_args, value) => [{ type: 'text', text: summarize(value) }],
    },
    async execute(args) {
      const action = args?.action
      switch (action) {
        case 'list': {
          const storeValue = await store()
          const page = storeValue.list({ query: args.query, limit: args.limit })
          return { action, items: page.items, total: page.total, truncated: page.truncated }
        }
        case 'read': {
          const storeValue = await store()
          return { action, entry: storeValue.read(args.id) }
        }
        case 'create': {
          const storeValue = await store()
          return { action, entry: await storeValue.create(args, 'ai') }
        }
        case 'update': {
          const storeValue = await store()
          // Pass only the writable fields: pinning stays with the human surface.
          const patch = { title: args.title, content: args.content, tags: args.tags }
          return { action, entry: await storeValue.update(args.id, patch, 'ai') }
        }
        case 'delete': {
          const storeValue = await store()
          return { action, entry: await storeValue.remove(args.id) }
        }
        default:
          throw new MemoryError('invalid', 'action must be one of list, read, create, update, delete')
      }
    },
    presentCall(args) {
      const action = typeof args?.action === 'string' ? args.action : 'memory'
      return { card: 'generic', title: `Memory bank · ${action}`, kind: 'other', rawInput: args }
    },
  }

  ctx.effect(() => ctx.tools.register(definition), 'memory-bank.tool')
}

/**
 * Two prompt contributions: a short usage section, and the always-on block.
 * The block is a section (not runtime context) so a persona that suppresses
 * optional runtime context cannot silently erase the user's boundaries.
 */
function registerPromptSection(ctx, residentText) {
  const text = [
    'You keep a persistent memory bank shared with the user, reachable through the `remember` tool.',
    'Entries the user pinned appear under "Always-on memory" in every prompt and are standing instructions; the rest of the bank must be retrieved with `remember list` before you rely on it.',
    'Use it to recall durable user preferences, project constraints, and agreed decisions instead of re-deriving them from the conversation.',
    'Write entries that stay true across sessions and useful to the user; do not store secrets, transient task state, or long transcripts.',
    'The user can view and edit the same entries in Settings → Memory, and only the user can pin entries.',
  ].join(' ')
  ctx.effect(
    () => ctx.systemPrompt.section({ name: 'memory-bank', order: 2450, text }),
    'memory-bank.prompt',
  )
  ctx.effect(
    () => ctx.systemPrompt.section({ name: 'memory-bank:resident', order: 10, text: residentText }),
    'memory-bank.resident',
  )
}

/**
 * JSON route for the settings page. It reuses the connection's browser trust
 * fence, so a foreign page cannot read or write the bank.
 */
function registerHttpRoute(ctx, store) {
  const connection = () => {
    try {
      return typeof ctx.get === 'function' ? ctx.get('connection') : undefined
    } catch {
      return undefined
    }
  }

  function rejectUntrusted(req, res) {
    try {
      const peer = connection()
      if (peer === undefined || typeof peer.requestRejection !== 'function') return false
      const code = peer.requestRejection(req)
      if (code === undefined || code === null || code === false) return false
      const status = typeof code === 'number' ? code : 403
      send(res, status, { ok: false, error: status === 401 ? 'unauthorized' : 'forbidden' })
      return true
    } catch {
      return false
    }
  }

  const handler = async (req, res) => {
    if (rejectUntrusted(req, res)) return
    const method = (req.method || 'GET').toUpperCase()
    try {
      if (method === 'GET') {
        const storeValue = await store()
        send(res, 200, { ok: true, ...storeValue.snapshot() })
        return
      }
      if (method !== 'POST') {
        send(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      const payload = await readJson(req)
      const storeValue = await store()
      const result = await runApiAction(storeValue, payload)
      send(res, 200, { ok: true, ...result, ...storeValue.snapshot() })
    } catch (error) {
      if (error instanceof MemoryError) {
        send(res, 400, {
          ok: false,
          error: error.message,
          ...(error.code !== undefined ? { code: error.code } : {}),
          ...(error.details !== undefined ? { details: error.details } : {}),
        })
        return
      }
      send(res, 500, { ok: false, error: String(error && error.message ? error.message : error) })
    }
  }

  const route = { kind: 'exact', path: ROUTE, handler }
  ctx.effect(() => ctx.webServer.register(route), 'memory-bank.route')
}

/** One action dispatcher shared by the route; all entries are human-authored. */
async function runApiAction(storeValue, payload) {
  const action = payload?.action
  switch (action) {
    case 'list': {
      const page = storeValue.list({ query: payload.query, limit: payload.limit })
      return { items: page.items, total: page.total, truncated: page.truncated }
    }
    case 'create': {
      const entry = await storeValue.create(
        { title: payload.title, content: payload.content, tags: payload.tags, pinned: payload.pinned },
        'human',
      )
      return { entry }
    }
    case 'update': {
      const entry = await storeValue.update(payload.id, payload, 'human')
      return { entry }
    }
    case 'delete': {
      const entry = await storeValue.remove(payload.id)
      return { entry }
    }
    default:
      throw new MemoryError('invalid', 'action must be one of list, create, update, delete')
  }
}

/** Small human/model-readable summary of one tool result. */
function summarize(value) {
  if (value.action === 'list') {
    if (value.items.length === 0) return 'Memory bank: no matching entries.'
    const lines = value.items.map(formatEntry)
    const suffix = value.truncated ? `\n… ${value.total - value.items.length} more; refine the query or raise limit.` : ''
    return `Memory bank: ${value.total} matching entr${value.total === 1 ? 'y' : 'ies'}.\n${lines.join('\n')}${suffix}`
  }
  const entry = value.entry
  if (value.action === 'delete') return `Deleted memory ${entry.id} (${entry.title}).`
  if (value.action === 'create') return `Created memory ${entry.id}.\n${formatEntry(entry)}`
  if (value.action === 'update') return `Updated memory ${entry.id}.\n${formatEntry(entry)}`
  return formatEntry(entry)
}

function formatEntry(entry) {
  const tags = entry.tags.length > 0 ? ` [${entry.tags.join(', ')}]` : ''
  const pin = entry.pinned ? ' (always-on)' : ''
  return `- ${entry.id} · ${entry.title}${tags}${pin}\n  ${entry.content.replace(/\n/g, '\n  ')}`
}

function send(res, code, payload) {
  let body
  try {
    body = Buffer.from(JSON.stringify(payload), 'utf8')
  } catch {
    body = Buffer.from('{"ok":false,"error":"unserializable result"}', 'utf8')
  }
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': String(body.length),
  })
  res.end(body)
}

function readJson(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        req.destroy()
        reject(new MemoryError('invalid', 'request body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (text.trim().length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new MemoryError('invalid', 'request body must be JSON'))
      }
    })
    req.on('error', (error) => reject(error))
  })
}
