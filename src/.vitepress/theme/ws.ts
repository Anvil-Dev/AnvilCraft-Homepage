// 官网匿名 WebSocket 事件订阅：贡献者条目变更时通知页面刷新。
// 需后端 ws.allow_anonymous 开启；连接失败由调用方的定时轮询兜底。
// 注意：模块顶层不得触碰 window（VitePress SSR 构建）。

type Listener = () => void

const EVENTS = ['contributor.created', 'contributor.updated', 'contributor.deleted']

const listeners = new Set<Listener>()
let conn: WebSocket | null = null
let wsBase = ''
let reconnectTimer: number | undefined
let reconnectDelay = 2000
const maxReconnectDelay = 30000

function buildURL(base: string): string {
  return `${base.replace(/\/$/, '').replace(/^http/, 'ws')}/api/v1/ws`
}

function closeConn() {
  if (reconnectTimer !== undefined) {
    clearTimeout(reconnectTimer)
    reconnectTimer = undefined
  }
  if (conn) {
    conn.onopen = conn.onmessage = conn.onclose = conn.onerror = null
    try {
      conn.close()
    } catch { /* ignore */ }
    conn = null
  }
}

function scheduleReconnect() {
  if (listeners.size === 0 || reconnectTimer !== undefined) return
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined
    reconnectDelay = Math.min(reconnectDelay * 2, maxReconnectDelay)
    connect()
  }, reconnectDelay)
}

function connect() {
  if (conn || !wsBase || listeners.size === 0) return
  const ws = new WebSocket(buildURL(wsBase))
  conn = ws
  ws.onopen = () => {
    reconnectDelay = 2000
    ws.send(JSON.stringify({ type: 'subscribe', events: EVENTS }))
  }
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data as string)
      if (msg.type !== 'event') return
      for (const cb of listeners) {
        try {
          cb()
        } catch (e) {
          console.error('[ws] 事件回调异常', e)
        }
      }
    } catch { /* 非 JSON 帧忽略 */ }
  }
  ws.onclose = () => {
    if (conn === ws) conn = null
    scheduleReconnect()
  }
  ws.onerror = () => { /* 交由 onclose 处理重连 */ }
}

/**
 * 订阅贡献者变更事件；返回取消函数。
 * apiBase 形如 https://api.anvilcraft.dev（与页面数据接口一致）。
 */
export function onContributorChange(apiBase: string, cb: Listener): () => void {
  wsBase = apiBase
  listeners.add(cb)
  connect()
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0) closeConn()
  }
}
