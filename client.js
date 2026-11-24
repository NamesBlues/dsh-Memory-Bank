/**
 * dsh-memory-bank — Client half.
 *
 * A Settings page ("Memory") for the same durable bank the `remember` tool
 * uses. Reads and writes go through the Host route /dsh-memory/api over the
 * existing authenticated connection; the Host owns validation, ids, and
 * storage, so the human and the agent always see one bank.
 */
window.__ModuleLoader__.load({
  id: 'dsh-memory-bank',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const API = '/dsh-memory/api'
    const POLL_MS = 4000
    const LIMITS = { title: 200, content: 20000, tag: 40, tags: 20 }

    /* ── text ───────────────────────────────────────────────────────────── */

    const MESSAGES = {
      en: {
        'meta.title': 'Memory',
        'meta.description': 'The durable memory bank shared with the agent.',
        'page.title': 'Memory bank',
        'page.intro':
          'Entries here are permanent notes the agent reads and writes through its remember tool. You can add, edit, and delete them too — both sides see the same bank.',
        'action.refresh': 'Refresh',
        'action.create': 'New memory',
        'action.save': 'Save',
        'action.saving': 'Saving…',
        'action.cancel': 'Cancel',
        'action.edit': 'Edit',
        'action.delete': 'Delete',
        'action.confirmDelete': 'Delete this memory?',
        'action.confirmYes': 'Yes, delete',
        'action.retry': 'Try again',
        'action.pin': 'Pin always-on',
        'action.unpin': 'Unpin',
        'badge.pinned': 'Always-on',
        'resident.usage': 'Always-on: {used} / {limit} chars',
        'resident.full': 'Always-on memory is full: {used} / {limit} chars used, this entry needs {incoming}. Unpin one first.',
        'search.placeholder': 'Search titles, content, and tags',
        'search.clear': 'Clear',
        'filter.all': 'All tags',
        'filter.tagHint': 'Filter by this tag',
        'form.newTitle': 'New memory',
        'form.editTitle': 'Edit memory',
        'form.title': 'Title',
        'form.titlePlaceholder': 'A short, recognizable name',
        'form.content': 'Content',
        'form.contentPlaceholder': 'The fact, preference, or decision worth keeping.',
        'form.tags': 'Tags',
        'form.tagsHint': 'Comma-separated, up to 20.',
        'form.tagsPlaceholder': 'preference, project',
        'form.pinned': 'Always-on (identity / boundaries)',
        'form.pinnedHint': 'Injected into every request. Budget: {limit} characters.',
        'form.titleRequired': 'A title is required.',
        'form.contentRequired': 'Content is required.',
        'list.count': '{count} of {total}',
        'list.emptyTitle': 'No memories yet',
        'list.emptyBody':
          'Add one here, or ask the agent to remember something — it will show up in this list.',
        'list.noMatch': 'No memory matches your filter.',
        'source.ai': 'Agent',
        'source.human': 'You',
        'state.loading': 'Loading memories…',
        'state.error': 'Could not reach the memory bank: {message}',
        'state.saved': 'Saved.',
        'state.deleted': 'Deleted.',
        'time.now': 'just now',
        'time.minutes': '{n} min ago',
        'time.hours': '{n} h ago',
        'time.days': '{n} d ago',
      },
      zh: {
        'meta.title': '记忆库',
        'meta.description': '与 AI 共享的长期记忆库。',
        'page.title': '记忆库',
        'page.intro':
          '这里的条目是 AI 通过 remember 工具读写的长期记忆。你也可以新增、修改和删除——两边看到的是同一个记忆库。',
        'action.refresh': '刷新',
        'action.create': '新建记忆',
        'action.save': '保存',
        'action.saving': '保存中…',
        'action.cancel': '取消',
        'action.edit': '编辑',
        'action.delete': '删除',
        'action.confirmDelete': '确定删除这条记忆？',
        'action.confirmYes': '确认删除',
        'action.retry': '重试',
        'action.pin': '设为常驻',
        'action.unpin': '取消常驻',
        'badge.pinned': '常驻',
        'resident.usage': '常驻：{used} / {limit} 字符',
        'resident.full': '常驻记忆已满：已用 {used} / {limit} 字符，本条需要 {incoming}。先取消一条常驻。',
        'search.placeholder': '搜索标题、内容或标签',
        'search.clear': '清除筛选',
        'filter.all': '全部标签',
        'filter.tagHint': '按这个标签筛选',
        'form.newTitle': '新建记忆',
        'form.editTitle': '编辑记忆',
        'form.title': '标题',
        'form.titlePlaceholder': '简短易认的名称',
        'form.content': '内容',
        'form.contentPlaceholder': '值得长期记住的事实、偏好或决定。',
        'form.tags': '标签',
        'form.tagsHint': '用逗号分隔，最多 20 个。',
        'form.tagsPlaceholder': '偏好, 项目',
        'form.pinned': '常驻（身份 / 边界）',
        'form.pinnedHint': '每轮请求都会注入，预算 {limit} 字符。',
        'form.titleRequired': '标题不能为空。',
        'form.contentRequired': '内容不能为空。',
        'list.count': '{count} / {total}',
        'list.emptyTitle': '还没有记忆',
        'list.emptyBody': '在这里新增一条，或者让 AI 记住某件事——它会出现在这个列表里。',
        'list.noMatch': '没有符合筛选条件的记忆。',
        'source.ai': 'AI',
        'source.human': '我',
        'state.loading': '正在加载记忆…',
        'state.error': '无法连接记忆库：{message}',
        'state.saved': '已保存。',
        'state.deleted': '已删除。',
        'time.now': '刚刚',
        'time.minutes': '{n} 分钟前',
        'time.hours': '{n} 小时前',
        'time.days': '{n} 天前',
      },
    }

    function readLanguage(locale) {
      try {
        const snapshot = locale?.getSnapshot?.() ?? locale?.getLocale?.()
        const active = typeof snapshot?.active === 'string' ? snapshot.active : ''
        return /^zh(?:$|[-_])/i.test(active) ? 'zh' : 'en'
      } catch {
        return 'en'
      }
    }

    function makeT(language) {
      const dict = MESSAGES[language] ?? MESSAGES.en
      return (key, values) => {
        const template = dict[key] ?? MESSAGES.en[key] ?? key
        if (values === undefined) return template
        return template.replace(/\{(\w+)\}/g, (match, name) =>
          Object.hasOwn(values, name) ? String(values[name]) : match,
        )
      }
    }

    /* ── styles (theme tokens only; literal colors stay in the artwork) ──── */

    const S = {
      page: { display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13, color: 'var(--dsw-alias-label-primary)' },
      head: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
      headText: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 240, flex: '1 1 260px' },
      title: { margin: 0, fontSize: 15, fontWeight: 600, lineHeight: 1.3 },
      intro: { margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' },
      actions: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
      button: {
        font: 'inherit', fontSize: 12, lineHeight: 1.4, padding: '5px 11px', borderRadius: 7,
        border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)', cursor: 'pointer',
      },
      buttonPrimary: {
        borderColor: 'var(--dsw-alias-brand-primary)',
        background: 'var(--dsw-alias-brand-primary)',
        color: 'var(--dsw-alias-bg-base)',
      },
      buttonDanger: { borderColor: 'var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)' },
      buttonDisabled: { opacity: 0.5, cursor: 'default' },
      toolbar: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      input: {
        font: 'inherit', fontSize: 12, width: '100%', boxSizing: 'border-box', padding: '6px 9px', borderRadius: 7,
        border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)', outline: 'none',
      },
      search: { flex: '1 1 180px', width: 'auto' },
      textarea: { minHeight: 96, resize: 'vertical', lineHeight: 1.55 },
      count: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' },
      notice: { fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)' },
      error: {
        fontSize: 12, lineHeight: 1.5, padding: '8px 10px', borderRadius: 8,
        border: '1px solid var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)',
      },
      editor: {
        display: 'flex', flexDirection: 'column', gap: 9, padding: '12px 13px', borderRadius: 10,
        border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)',
      },
      editorHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
      editorTitle: { fontSize: 13, fontWeight: 600 },
      field: { display: 'flex', flexDirection: 'column', gap: 4 },
      checkRow: { display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' },
      label: { fontSize: 11, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' },
      hint: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' },
      formError: { fontSize: 11.5, color: 'var(--dsw-alias-state-error-primary)' },
      list: { display: 'flex', flexDirection: 'column', gap: 8 },
      item: {
        display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: 10,
        border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)',
      },
      itemHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
      itemTitleText: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 },
      itemTitle: { fontSize: 13, fontWeight: 600, lineHeight: 1.4, wordBreak: 'break-word' },
      itemMeta: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 11, color: 'var(--dsw-alias-label-secondary)' },
      itemContent: { margin: 0, fontSize: 12, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--dsw-alias-label-primary)' },
      badge: {
        fontSize: 10.5, lineHeight: 1.5, padding: '0 6px', borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-secondary)',
      },
      badgePinned: {
        fontSize: 10.5, lineHeight: 1.5, padding: '0 6px', borderRadius: 999,
        border: '1px solid var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-brand-primary)',
      },
      resident: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' },
      residentWarn: { color: 'var(--dsw-alias-state-warn-primary)' },
      tag: {
        font: 'inherit', fontSize: 10.5, lineHeight: 1.6, padding: '0 6px', borderRadius: 999, cursor: 'pointer',
        border: 'none', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-secondary)',
      },
      pill: {
        font: 'inherit', fontSize: 11.5, lineHeight: 1.4, padding: '3px 9px', borderRadius: 999, cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-secondary)',
      },
      pillActive: {
        borderColor: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-2)',
      },
      empty: {
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, padding: '18px 16px',
        borderRadius: 10, border: '1px dashed var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-secondary)',
      },
      emptyTitle: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      emptyBody: { fontSize: 12, lineHeight: 1.6 },
      confirm: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap',
        padding: '6px 8px', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-2)',
      },
    }

    /* ── helpers ─────────────────────────────────────────────────────────── */

    function parseTags(text) {
      return String(text ?? '')
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag, index, all) => tag.length > 0 && all.indexOf(tag) === index)
    }

    function formatRelative(iso, now, t) {
      const then = Date.parse(iso)
      if (!Number.isFinite(then)) return ''
      const delta = Math.max(0, now - then)
      const minutes = Math.floor(delta / 60000)
      if (minutes < 1) return t('time.now')
      if (minutes < 60) return t('time.minutes', { n: minutes })
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return t('time.hours', { n: hours })
      const days = Math.floor(hours / 24)
      if (days < 30) return t('time.days', { n: days })
      return new Date(then).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    }

    function errorText(error) {
      return String(error && error.message ? error.message : error)
    }

    /* ── controls (module-level components: a parent re-render must not
       remount them, or the editor would lose focus) ─────────────────────── */

    function Button(props) {
      const style = Object.assign(
        {},
        S.button,
        props.primary ? S.buttonPrimary : null,
        props.danger ? S.buttonDanger : null,
        props.disabled ? S.buttonDisabled : null,
      )
      return h(
        'button',
        { type: 'button', style, onClick: props.onClick, disabled: Boolean(props.disabled) },
        props.label,
      )
    }

    function Field(props) {
      return h(
        'label',
        { style: S.field },
        h('span', { style: S.label }, props.label),
        props.children,
        props.hint ? h('span', { style: S.hint }, props.hint) : null,
      )
    }

    function Item(props) {
      const { item, now, busy, confirming, t } = props
      return h(
        'article',
        { style: S.item },
        h(
          'div',
          { style: S.itemHead },
          h(
            'div',
            { style: S.itemTitleText },
            h('span', { style: S.itemTitle }, item.title),
            h(
              'div',
              { style: S.itemMeta },
              h('span', { style: S.badge }, item.source === 'human' ? t('source.human') : t('source.ai')),
              item.pinned ? h('span', { style: S.badgePinned, title: t('form.pinnedHint', { limit: props.limit }) }, t('badge.pinned')) : null,
              h('span', null, formatRelative(item.updatedAt, now, t)),
              (item.tags ?? []).map((tag) =>
                h(
                  'button',
                  {
                    key: tag,
                    type: 'button',
                    style: S.tag,
                    title: t('filter.tagHint'),
                    onClick: () => props.onTag(tag),
                  },
                  `#${tag}`,
                ),
              ),
            ),
          ),
          h(
            'div',
            { style: S.actions },
            h(Button, {
              label: item.pinned ? t('action.unpin') : t('action.pin'),
              onClick: () => props.onPin(item),
              disabled: busy,
            }),
            h(Button, { label: t('action.edit'), onClick: () => props.onEdit(item), disabled: busy }),
            h(Button, {
              label: t('action.delete'),
              onClick: () => props.onDelete(item),
              danger: true,
              disabled: busy,
            }),
          ),
        ),
        h('p', { style: S.itemContent }, item.content),
        confirming
          ? h(
              'div',
              { style: S.confirm, role: 'alertdialog' },
              h('span', { style: S.notice }, t('action.confirmDelete')),
              h(
                'div',
                { style: S.actions },
                h(Button, {
                  label: t('action.confirmYes'),
                  onClick: () => props.onDelete(item),
                  danger: true,
                  disabled: busy,
                }),
                h(Button, { label: t('action.cancel'), onClick: props.onCancelDelete, disabled: busy }),
              ),
            )
          : null,
      )
    }

    /* ── page ────────────────────────────────────────────────────────────── */

    function MemoryPage(props) {
      const ctx = props.ctx
      const [language, setLanguage] = React.useState(() => readLanguage(ctx.locale))
      const t = React.useMemo(() => makeT(language), [language])

      React.useEffect(() => {
        let unsubscribe = () => {}
        try {
          const stop = ctx.locale?.subscribe?.(() => setLanguage(readLanguage(ctx.locale)))
          if (typeof stop === 'function') unsubscribe = stop
        } catch {
          /* a disposed locale service needs no unsubscribe */
        }
        setLanguage(readLanguage(ctx.locale))
        return () => {
          try {
            unsubscribe()
          } catch {
            /* ignore disposal of a gone service */
          }
        }
      }, [ctx])

      const [items, setItems] = React.useState([])
      const [loaded, setLoaded] = React.useState(false)
      const [loadError, setLoadError] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const [query, setQuery] = React.useState('')
      const [activeTag, setActiveTag] = React.useState('')
      const [draft, setDraft] = React.useState(null)
      const [draftError, setDraftError] = React.useState(null)
      const [confirmId, setConfirmId] = React.useState(null)
      const [now, setNow] = React.useState(() => Date.now())
      const [resident, setResident] = React.useState({ limit: 2000, used: 0 })
      const [actionError, setActionError] = React.useState(null)

      // A draft is in progress: background refreshes must not clobber the form.
      const draftRef = React.useRef(null)
      draftRef.current = draft

      React.useEffect(() => {
        let alive = true
        const load = async () => {
          try {
            const response = await fetch(API, { headers: { Accept: 'application/json' } })
            const body = await response.json().catch(() => null)
            if (!alive) return
            if (!response.ok || !body || body.ok !== true) {
              throw new Error(body && body.error ? body.error : `HTTP ${response.status}`)
            }
            setItems(Array.isArray(body.items) ? body.items : [])
            if (body.resident) setResident(body.resident)
            setLoaded(true)
            setLoadError(null)
          } catch (error) {
            if (!alive) return
            setLoadError(errorText(error))
          }
        }
        load()
        const timer = setInterval(() => {
          if (draftRef.current === null && typeof document !== 'undefined' && !document.hidden) load()
        }, POLL_MS)
        const tick = setInterval(() => setNow(Date.now()), 30000)
        return () => {
          alive = false
          clearInterval(timer)
          clearInterval(tick)
        }
      }, [])

      const mutate = React.useCallback(async (payload) => {
        setBusy(true)
        setNotice(null)
        setActionError(null)
        try {
          const response = await fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload),
          })
          const body = await response.json().catch(() => null)
          if (!response.ok || !body || body.ok !== true) {
            const error = new Error(body && body.error ? body.error : `HTTP ${response.status}`)
            if (body && body.code) error.code = body.code
            if (body && body.details) error.details = body.details
            throw error
          }
          if (Array.isArray(body.items)) setItems(body.items)
          if (body.resident) setResident(body.resident)
          setLoaded(true)
          setLoadError(null)
          return body
        } finally {
          setBusy(false)
        }
      }, [])

      /** Localize a host failure; the budget rejection carries its numbers. */
      const describeError = (error) => {
        if (error && error.code === 'budget' && error.details) {
          return t('resident.full', {
            used: error.details.used,
            limit: error.details.limit,
            incoming: error.details.incoming,
          })
        }
        return errorText(error)
      }

      const tags = React.useMemo(() => {
        const seen = new Map()
        for (const item of items) {
          for (const tag of item.tags ?? []) seen.set(tag, (seen.get(tag) ?? 0) + 1)
        }
        return [...seen.entries()]
          .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
          .map(([tag]) => tag)
      }, [items])

      const visible = React.useMemo(() => {
        const needle = query.trim().toLowerCase()
        return items.filter((item) => {
          if (activeTag !== '' && !(item.tags ?? []).includes(activeTag)) return false
          if (needle.length === 0) return true
          return [item.title, item.content, (item.tags ?? []).join(' ')]
            .join('\n')
            .toLowerCase()
            .includes(needle)
        })
      }, [items, query, activeTag])

      const startCreate = () => {
        setDraftError(null)
        setConfirmId(null)
        setNotice(null)
        setActionError(null)
        setDraft({ mode: 'create', id: null, title: '', content: '', tags: '', pinned: false })
      }

      const startEdit = (item) => {
        setDraftError(null)
        setConfirmId(null)
        setNotice(null)
        setActionError(null)
        setDraft({
          mode: 'edit',
          id: item.id,
          title: item.title,
          content: item.content,
          tags: (item.tags ?? []).join(', '),
          pinned: item.pinned === true,
        })
      }

      const cancelDraft = () => {
        setDraft(null)
        setDraftError(null)
      }

      const save = async () => {
        if (draft === null) return
        const title = draft.title.trim()
        const content = draft.content.trim()
        if (title.length === 0) {
          setDraftError(t('form.titleRequired'))
          return
        }
        if (content.length === 0) {
          setDraftError(t('form.contentRequired'))
          return
        }
        const tagsValue = parseTags(draft.tags)
        try {
          if (draft.mode === 'create') {
            await mutate({ action: 'create', title, content, tags: tagsValue, pinned: draft.pinned === true })
          } else {
            await mutate({
              action: 'update',
              id: draft.id,
              title,
              content,
              tags: tagsValue,
              pinned: draft.pinned === true,
            })
          }
          setDraft(null)
          setDraftError(null)
          setNotice(t('state.saved'))
        } catch (error) {
          setDraftError(describeError(error))
        }
      }

      /** Pinning is the human's call, so it is a one-click update from here. */
      const togglePin = async (item) => {
        try {
          await mutate({ action: 'update', id: item.id, pinned: item.pinned !== true })
          setNotice(item.pinned ? t('action.unpin') : t('action.pin'))
        } catch (error) {
          setActionError(describeError(error))
        }
      }

      const remove = async (item) => {
        if (confirmId !== item.id) {
          setConfirmId(item.id)
          return
        }
        try {
          await mutate({ action: 'delete', id: item.id })
          setConfirmId(null)
          if (draft !== null && draft.id === item.id) setDraft(null)
          setNotice(t('state.deleted'))
        } catch (error) {
          setLoadError(errorText(error))
        }
      }

      const refresh = async () => {
        setNotice(null)
        setLoadError(null)
        try {
          await mutate({ action: 'list', limit: 200 })
        } catch (error) {
          setLoadError(errorText(error))
        }
      }

      const filterByTag = (tag) => setActiveTag(activeTag === tag ? '' : tag)

      /* ── list body ── */

      const listBody = (() => {
        if (!loaded && loadError !== null) {
          return h(
            'div',
            { style: S.empty, role: 'alert' },
            h('span', { style: S.emptyTitle }, t('state.error', { message: loadError })),
            h('div', null, h(Button, { label: t('action.retry'), onClick: refresh })),
          )
        }
        if (!loaded) return h('div', { style: S.notice }, t('state.loading'))
        if (items.length === 0) {
          return h(
            'div',
            { style: S.empty },
            h('span', { style: S.emptyTitle }, t('list.emptyTitle')),
            h('span', { style: S.emptyBody }, t('list.emptyBody')),
            h('div', { style: S.actions }, h(Button, { label: t('action.create'), onClick: startCreate, primary: true })),
          )
        }
        if (visible.length === 0) {
          return h(
            'div',
            { style: S.empty },
            h('span', { style: S.emptyBody }, t('list.noMatch')),
            h(
              'div',
              { style: S.actions },
              h(Button, {
                label: t('search.clear'),
                onClick: () => {
                  setQuery('')
                  setActiveTag('')
                },
              }),
            ),
          )
        }
        return h(
          'div',
          { style: S.list },
          visible.map((item) =>
            h(Item, {
              key: item.id,
              item,
              now,
              busy,
              t,
              limit: resident.limit,
              confirming: confirmId === item.id,
              onEdit: startEdit,
              onDelete: remove,
              onPin: togglePin,
              onTag: filterByTag,
              onCancelDelete: () => setConfirmId(null),
            }),
          ),
        )
      })()

      /* ── editor ── */

      const editor = draft === null ? null : h(
        'section',
        { style: S.editor, 'aria-label': draft.mode === 'create' ? t('form.newTitle') : t('form.editTitle') },
        h(
          'div',
          { style: S.editorHead },
          h('span', { style: S.editorTitle }, draft.mode === 'create' ? t('form.newTitle') : t('form.editTitle')),
          h('span', { style: S.count }, draft.mode === 'edit' ? draft.id.slice(0, 8) : ''),
        ),
        h(
          Field,
          { label: t('form.title'), hint: LIMITS.title - draft.title.length <= 20 ? String(LIMITS.title - draft.title.length) : undefined },
          h('input', {
            style: S.input,
            type: 'text',
            value: draft.title,
            maxLength: LIMITS.title,
            placeholder: t('form.titlePlaceholder'),
            autoFocus: true,
            onChange: (event) => setDraft(Object.assign({}, draft, { title: event.target.value })),
          }),
        ),
        h(
          Field,
          { label: t('form.content') },
          h('textarea', {
            style: Object.assign({}, S.input, S.textarea),
            value: draft.content,
            maxLength: LIMITS.content,
            placeholder: t('form.contentPlaceholder'),
            onChange: (event) => setDraft(Object.assign({}, draft, { content: event.target.value })),
          }),
        ),
        h(
          Field,
          { label: t('form.tags'), hint: t('form.tagsHint') },
          h('input', {
            style: S.input,
            type: 'text',
            value: draft.tags,
            placeholder: t('form.tagsPlaceholder'),
            onChange: (event) => setDraft(Object.assign({}, draft, { tags: event.target.value })),
          }),
        ),
        h(
          'label',
          { style: S.checkRow },
          h('input', {
            type: 'checkbox',
            checked: draft.pinned === true,
            onChange: (event) => setDraft(Object.assign({}, draft, { pinned: event.target.checked })),
          }),
          h(
            'span',
            { style: S.field },
            h('span', { style: S.label }, t('form.pinned')),
            h('span', { style: S.hint }, t('form.pinnedHint', { limit: resident.limit })),
          ),
        ),
        draftError ? h('div', { style: S.formError, role: 'alert' }, draftError) : null,
        h(
          'div',
          { style: S.actions },
          h(Button, { label: busy ? t('action.saving') : t('action.save'), onClick: save, primary: true, disabled: busy }),
          h(Button, { label: t('action.cancel'), onClick: cancelDraft, disabled: busy }),
        ),
      )

      return h(
        'div',
        { style: S.page },
        h(
          'header',
          { style: S.head },
          h(
            'div',
            { style: S.headText },
            h('h3', { style: S.title }, t('page.title')),
            h('p', { style: S.intro }, t('page.intro')),
          ),
          h(
            'div',
            { style: S.actions },
            h(Button, { label: t('action.refresh'), onClick: refresh, disabled: busy }),
            h(Button, { label: t('action.create'), onClick: startCreate, primary: true }),
          ),
        ),
        editor,
        notice !== null ? h('div', { style: S.notice, role: 'status' }, notice) : null,
        actionError !== null ? h('div', { style: S.error, role: 'alert' }, actionError) : null,
        loadError !== null && loaded
          ? h('div', { style: S.error, role: 'alert' }, t('state.error', { message: loadError }))
          : null,
        h(
          'div',
          { style: S.toolbar },
          h('input', {
            style: Object.assign({}, S.input, S.search),
            type: 'search',
            value: query,
            placeholder: t('search.placeholder'),
            'aria-label': t('search.placeholder'),
            onChange: (event) => setQuery(event.target.value),
          }),
          h('span', { style: S.count }, t('list.count', { count: visible.length, total: items.length })),
          h(
            'span',
            { style: resident.used >= resident.limit * 0.9 ? Object.assign({}, S.resident, S.residentWarn) : S.resident },
            t('resident.usage', { used: resident.used, limit: resident.limit }),
          ),
        ),
        tags.length > 0
          ? h(
              'div',
              { style: S.toolbar },
              h(Button, {
                label: t('filter.all'),
                onClick: () => setActiveTag(''),
                primary: activeTag === '',
              }),
              tags.map((tag) =>
                h(Button, {
                  key: tag,
                  label: `#${tag}`,
                  onClick: () => filterByTag(tag),
                  primary: activeTag === tag,
                }),
              ),
            )
          : null,
        listBody,
      )
    }

    function register(ctx) {
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'memory-bank',
            order: 27,
            label: () => makeT(readLanguage(ctx.locale))('meta.title'),
          },
          (props) => h(MemoryPage, Object.assign({}, props, { ctx })),
        ),
      )
    }

    return { inject: ['slots', 'locale'], apply: register }
  },
})
