import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { PairingService, PairingSnapshot } from './pairing.ts'
import type { TunnelState } from './tunnel.ts'
import { isLoopbackClient, isLoopbackHostname, readCookie, requestHostname, requestIsHttps } from './loopback.ts'

export const REMOTE_PREFIX = '/harness-remote'
export const PAIR_COOKIE = 'harness_remote_pending'

export interface TunnelControl {
  readonly snapshot: TunnelState
  onChange(listener: (state: TunnelState) => void): () => void
  start(): void
  stop(): void
}

function json(res: ServerResponse, status: number, body: unknown, extra: Record<string, string | string[]> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra })
  res.end(JSON.stringify(body))
}

async function body(req: IncomingMessage, maxBytes = 2 * 1024 * 1024): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.byteLength
    if (size > maxBytes) throw new Error('body-too-large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('bad-payload')
  return parsed as Record<string, unknown>
}

export function advertised(service: PairingService, request: IncomingMessage): boolean {
  const hostname = requestHostname(request)
  if (hostname === undefined) return false
  if (isLoopbackHostname(hostname)) return true
  const publicHost = service.publicBaseUrl === undefined ? undefined : new URL(service.publicBaseUrl).hostname
  return service.lanAddresses.includes(hostname) || hostname === publicHost
}

function cookie(name: string, value: string, request: IncomingMessage, maxAge: number): string {
  const secure = requestIsHttps(request) || (request.headers.host?.startsWith('https://') ?? false)
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${String(maxAge)}${secure ? '; Secure' : ''}`
}

function baseUrl(service: PairingService, address?: string): string | undefined {
  if (address === undefined && service.publicBaseUrl !== undefined) return service.publicBaseUrl
  if (address !== undefined) return service.lanBaseUrlFor(address)
  return service.lanBaseUrl
}

export function makePairingRoutes(service: PairingService, port: number, tunnel?: TunnelControl): WebRoute[] {
  const snapshot = (): PairingSnapshot & { tunnel: TunnelState } => ({ ...service.snapshot(), tunnel: tunnel?.snapshot ?? { state: 'stopped' } })

  const issue = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'POST') return json(res, 405, { ok: false, code: 'method-not-allowed' })
    if (!isLoopbackClient(req)) return json(res, 403, { ok: false, code: 'loopback-required' })
    try {
      const payload = await body(req)
      const address = typeof payload.address === 'string' ? payload.address : undefined
      const workspaceId = typeof payload.workspaceId === 'string' ? payload.workspaceId : undefined
      const issued = service.issue(address)
      const base = baseUrl(service, address) ?? `http://127.0.0.1:${String(port)}`
      const query = new URLSearchParams({ pair: issued.token, ...(workspaceId ? { workspace: workspaceId } : {}) })
      json(res, 200, { ok: true, url: `${base}${REMOTE_PREFIX}?${query.toString()}`, expiresAt: issued.expiresAt, lanAddresses: service.lanAddresses, ...(service.publicBaseUrl ? { publicBaseUrl: service.publicBaseUrl } : {}) })
    } catch (error) {
      const code = error instanceof Error && (error.message === 'unknown-address' || error.message === 'lan-required') ? error.message : 'bad-payload'
      json(res, code === 'bad-payload' ? 400 : 409, { ok: false, code })
    }
  }

  const accept = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'POST') return json(res, 405, { ok: false, code: 'method-not-allowed' })
    if (!advertised(service, req)) return json(res, 403, { ok: false, code: 'forbidden' })
    try {
      const payload = await body(req, 16 * 1024)
      const token = typeof payload.token === 'string' ? payload.token : ''
      const result = service.accept(token, { userAgent: req.headers['user-agent'], address: requestHostname(req) })
      if (!result.ok) return json(res, result.code === 'used' ? 409 : 404, { ok: false, code: result.code })
      return json(res, 200, { ok: true, pending: true, code: result.code, expiresAt: result.expiresAt }, { 'set-cookie': cookie(PAIR_COOKIE, result.pendingId, req, Math.ceil(service.config.pendingTtlMs / 1000)) })
    } catch { return json(res, 400, { ok: false, code: 'bad-payload' }) }
  }

  const complete = (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== 'GET') return void json(res, 405, { ok: false, code: 'method-not-allowed' })
    if (!advertised(service, req)) return void json(res, 403, { ok: false, code: 'forbidden' })
    const pendingId = readCookie(req.headers.cookie, PAIR_COOKIE)
    if (pendingId === undefined) return void json(res, 401, { ok: false, code: 'not-pairing' })
    const result = service.complete(pendingId)
    if (result.status === 'approved' && result.deviceId !== undefined) return void json(res, 200, { ok: true, status: result.status }, { 'set-cookie': cookie(service.config.cookieName, result.deviceId, req, 60 * 60 * 24 * 30) })
    return void json(res, 200, { ok: true, status: result.status })
  }

  const status = (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== 'GET') return void json(res, 405, { ok: false, code: 'method-not-allowed' })
    if (!advertised(service, req) && !isLoopbackClient(req)) return void json(res, 403, { ok: false, code: 'forbidden' })
    const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
    return void json(res, 200, { ok: true, paired: deviceId !== undefined && service.hasDevice(deviceId), ...snapshot() })
  }

  const startTunnel = (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== 'POST') return void json(res, 405, { ok: false, code: 'method-not-allowed' })
    if (!isLoopbackClient(req)) return void json(res, 403, { ok: false, code: 'loopback-required' })
    if (service.publicBaseUrl === undefined && tunnel === undefined) return void json(res, 503, { ok: false, code: 'tunnel-unavailable' })
    if (service.publicBaseUrl === undefined) tunnel?.start()
    return void json(res, 200, { ok: true, ...snapshot() })
  }

  const heartbeat = (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== 'POST') return void json(res, 405, { ok: false, code: 'method-not-allowed' })
    if (!advertised(service, req)) return void json(res, 403, { ok: false, code: 'forbidden' })
    const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
    return void json(res, 200, service.touch(deviceId ?? '') ? { ok: true } : { ok: false, code: 'unpaired' })
  }

  const stop = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'POST') return json(res, 405, { ok: false, code: 'method-not-allowed' })
    if (!isLoopbackClient(req)) return json(res, 403, { ok: false, code: 'loopback-required' })
    tunnel?.stop()
    service.stop()
    return json(res, 200, { ok: true })
  }

  const approval = async (req: IncomingMessage, res: ServerResponse, action: 'approve' | 'reject'): Promise<void> => {
    if (req.method !== 'POST') return json(res, 405, { ok: false, code: 'method-not-allowed' })
    if (!isLoopbackClient(req)) return json(res, 403, { ok: false, code: 'loopback-required' })
    try {
      const payload = await body(req, 16 * 1024)
      const id = typeof payload.id === 'string' ? payload.id : ''
      const result = action === 'approve' ? service.approve(id) : { ok: service.reject(id) }
      return json(res, action === 'approve' && result.ok === false ? 409 : 200, result)
    } catch { return json(res, 400, { ok: false, code: 'bad-payload' }) }
  }

  const events = (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== 'GET') return void json(res, 405, { ok: false, code: 'method-not-allowed' })
    if (!isLoopbackClient(req)) return void json(res, 403, { ok: false, code: 'loopback-required' })
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' })
    let closed = false
    const write = (next: PairingSnapshot & { tunnel: TunnelState }): void => { if (!closed) res.write(`data: ${JSON.stringify({ type: 'state', ...next })}\n\n`) }
    const offPairing = service.onChange(() => write(snapshot()))
    const offTunnel = tunnel?.onChange(() => write(snapshot()))
    write(snapshot())
    const timer = setInterval(() => { if (!closed) res.write(': ping\n\n') }, 15000)
    const close = (): void => { if (closed) return; closed = true; clearInterval(timer); offPairing(); offTunnel?.() }
    res.on('close', close)
  }

  return [
    { kind: 'exact', path: `${REMOTE_PREFIX}/pair/issue`, handler: issue },
    { kind: 'exact', path: `${REMOTE_PREFIX}/pair/accept`, handler: accept },
    { kind: 'exact', path: `${REMOTE_PREFIX}/pair/complete`, handler: complete },
    { kind: 'exact', path: `${REMOTE_PREFIX}/pair/status`, handler: status },
    { kind: 'exact', path: `${REMOTE_PREFIX}/pair/tunnel/start`, handler: startTunnel },
    { kind: 'exact', path: `${REMOTE_PREFIX}/pair/heartbeat`, handler: heartbeat },
    { kind: 'exact', path: `${REMOTE_PREFIX}/pair/stop`, handler: stop },
    { kind: 'exact', path: `${REMOTE_PREFIX}/pair/approve`, handler: (req, res) => approval(req, res, 'approve') },
    { kind: 'exact', path: `${REMOTE_PREFIX}/pair/reject`, handler: (req, res) => approval(req, res, 'reject') },
    { kind: 'exact', path: `${REMOTE_PREFIX}/pair/events`, handler: events },
  ]
}
