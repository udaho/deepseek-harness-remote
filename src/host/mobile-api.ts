import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId, type RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { PairingService } from './pairing.ts'
import { advertised, REMOTE_PREFIX } from './routes.ts'
import { readCookie } from './loopback.ts'

const API_PREFIX = `${REMOTE_PREFIX}/api`
const EVENTS_PATH = `${API_PREFIX}/events.mux`
const ALLOWLIST = new Set([
  'workspace.list', 'workspace.archiveSession', 'session.list', 'session.create', 'session.history',
  'session.search', 'session.prompt', 'session.models', 'session.selectModel',
  'session.rename', 'session.fork', 'session.cancel', 'session.attachment',
  'session.respond',
])
const MAX_BODY_BYTES = 160 * 1024 * 1024
const MAX_HISTORY_MESSAGES = 100
const MAX_PROMPT_TEXT = 200_000
const MAX_IMAGE_BYTES = 100 * 1024 * 1024
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) throw new Error('body-too-large')
    chunks.push(buffer)
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('bad-request')
  return parsed as Record<string, unknown>
}

function envelope(rpcId: string, result: unknown): unknown {
  return { type: 'server-response', rpcId, result }
}

function wrap(rpcId: string, response: { result: unknown }): unknown { return envelope(rpcId, response.result) }

function requestId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) throw new Error('missing-rpc-id')
  return value
}

function objectPayload(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('bad-payload')
  return value as Record<string, unknown>
}

function stringField(payload: Record<string, unknown>, name: string, max = 512): string {
  const value = payload[name]
  if (typeof value !== 'string' || value.length < 1 || value.length > max) throw new Error(`bad-${name}`)
  return value
}

function optionalStringField(payload: Record<string, unknown>, name: string, max = 512): string | undefined {
  if (payload[name] === undefined) return undefined
  return stringField(payload, name, max)
}

function sessionPayload(value: unknown): { sessionId: string } {
  const payload = objectPayload(value)
  return { sessionId: stringField(payload, 'sessionId') }
}

function safePrompt(payload: Record<string, unknown>): void {
  if (typeof payload.sessionId !== 'string' || (payload.mode !== 'queue' && payload.mode !== 'steer') || !Array.isArray(payload.content) || payload.content.length < 1 || payload.content.length > 16) throw new Error('bad-prompt')
  let imageBytes = 0
  for (const part of payload.content) {
    if (typeof part !== 'object' || part === null) throw new Error('bad-prompt')
    const item = part as Record<string, unknown>
    if (item.type === 'text') {
      if (typeof item.text !== 'string' || item.text.length > MAX_PROMPT_TEXT) throw new Error('bad-prompt')
    } else if (item.type === 'image') {
      if (typeof item.mediaType !== 'string' || !IMAGE_MEDIA_TYPES.has(item.mediaType) || typeof item.data !== 'string') throw new Error('bad-image')
      imageBytes += Math.floor(item.data.length * 0.75)
      if (imageBytes > MAX_IMAGE_BYTES) throw new Error('image-too-large')
    } else throw new Error('bad-prompt')
  }
}

function safeResponse(payload: Record<string, unknown>): { rpcId: string; result: { ok: true; value: unknown } } {
  const responseId = requestId(payload.rpcId)
  const result = payload.result
  if (typeof result !== 'object' || result === null || (result as Record<string, unknown>).ok !== true) throw new Error('bad-response')
  const value = (result as Record<string, unknown>).value
  if (typeof value !== 'object' || value === null) throw new Error('bad-response')
  const record = value as Record<string, unknown>
  const sessionId = typeof record.sessionId === 'string' && record.sessionId.length > 0
  const approval = sessionId && typeof record.approvalId === 'string' && (record.outcome === 'allowed-once' || record.outcome === 'rejected')
  const answer = record.answer
  const answerRecord = typeof answer === 'object' && answer !== null && !Array.isArray(answer) ? answer as Record<string, unknown> : undefined
  const answers = answerRecord !== undefined && Array.isArray(answerRecord.answers) ? answerRecord.answers as unknown[] : undefined
  const question = sessionId && answers !== undefined && answers.every((item: unknown) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return false
      const entry = item as Record<string, unknown>
      return typeof entry.id === 'string' && Array.isArray(entry.selected) && entry.selected.every(label => typeof label === 'string')
        && (entry.custom === undefined || typeof entry.custom === 'string')
    })
  if (!approval && !question) throw new Error('bad-response')
  return { rpcId: responseId, result: result as { ok: true; value: unknown } }
}

export interface MobileApiDeps { service: PairingService; apiProxy: ApiProxy }

export function makeMobileApiRoutes({ service, apiProxy }: MobileApiDeps): WebRoute[] {
  const authenticated = (req: IncomingMessage): boolean => {
    if (!advertised(service, req)) return false
    const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
    return deviceId !== undefined && service.touch(deviceId)
  }

  const dispatch = async (method: string, payload: unknown, rpcId: string): Promise<unknown> => {
    const request: RpcRequest<unknown> = { rpcId: RpcId(rpcId), payload }
    if (method === 'workspace.list') return wrap(rpcId, await apiProxy.workspace.list({ ...request, payload: {} } as never))
    if (method === 'workspace.archiveSession') return wrap(rpcId, await apiProxy.workspace.archiveSession({ ...request, payload: sessionPayload(payload) } as never))
    if (method === 'session.list') {
      const input = objectPayload(payload)
      const requestedCursor = optionalStringField(input, 'cursor', 256)
      const value = await apiProxy.sessions.list({ ...request, payload: requestedCursor === undefined ? {} : { cursor: requestedCursor } } as never)
      if (!value.result.ok) return wrap(rpcId, value)
      const items = [...value.result.value.items].sort((a, b) => b.updatedAt - a.updatedAt || String(a.sessionId).localeCompare(String(b.sessionId)))
      const start = requestedCursor === undefined ? 0 : Math.max(0, items.findIndex(item => `${item.updatedAt}:${String(item.sessionId)}` === requestedCursor) + 1)
      const page = items.slice(start, start + 20)
      const last = page.at(-1)
      const nextCursor = last !== undefined && start + page.length < items.length ? `${last.updatedAt}:${String(last.sessionId)}` : undefined
      return envelope(rpcId, { ok: true, value: { items: page, hasMore: nextCursor !== undefined, ...(nextCursor ? { nextCursor } : {}) } })
    }
    if (method === 'session.history') {
      const input = objectPayload(payload)
      const sessionId = stringField(input, 'sessionId')
      const beforeSeq = input.beforeSeq === undefined ? undefined : typeof input.beforeSeq === 'number' && Number.isSafeInteger(input.beforeSeq) && input.beforeSeq >= 0 ? input.beforeSeq : (() => { throw new Error('bad-beforeSeq') })()
      const maxMessages = input.maxMessages === undefined ? 50 : typeof input.maxMessages === 'number' && Number.isSafeInteger(input.maxMessages) ? Math.min(MAX_HISTORY_MESSAGES, Math.max(1, input.maxMessages)) : (() => { throw new Error('bad-maxMessages') })()
      return wrap(rpcId, await apiProxy.sessions.history({ ...request, payload: { sessionId, ...(beforeSeq === undefined ? {} : { beforeSeq }), maxMessages } } as never))
    }
    if (method === 'session.prompt') {
      const input = objectPayload(payload)
      safePrompt(input)
      const clientTimeZone = optionalStringField(input, 'clientTimeZone', 128)
      const normalized = { sessionId: stringField(input, 'sessionId'), mode: input.mode, content: input.content, ...(clientTimeZone === undefined ? {} : { clientTimeZone }) }
      return wrap(rpcId, await apiProxy.sessions.prompt({ ...request, payload: normalized } as never))
    }
    if (method === 'session.create') {
      const input = objectPayload(payload)
      const workspaceId = stringField(input, 'workspaceId')
      return wrap(rpcId, await apiProxy.sessions.create({ ...request, payload: { workspaceId } } as never))
    }
    if (method === 'session.search') {
      const input = objectPayload(payload)
      return wrap(rpcId, await apiProxy.sessions.search({ ...request, payload: { query: stringField(input, 'query', 1000) } } as never, new AbortController().signal))
    }
    if (method === 'session.models') return wrap(rpcId, await apiProxy.sessions.models({ ...request, payload: sessionPayload(payload) } as never))
    if (method === 'session.selectModel') {
      const input = objectPayload(payload)
      const reasoningEffort = optionalStringField(input, 'reasoningEffort', 128)
      return wrap(rpcId, await apiProxy.sessions.selectModel({ ...request, payload: { sessionId: stringField(input, 'sessionId'), provider: stringField(input, 'provider', 256), model: stringField(input, 'model', 512), ...(reasoningEffort === undefined ? {} : { reasoningEffort }) } } as never))
    }
    if (method === 'session.rename') {
      const input = objectPayload(payload)
      return wrap(rpcId, await apiProxy.sessions.rename({ ...request, payload: { sessionId: stringField(input, 'sessionId'), title: stringField(input, 'title', 500) } } as never))
    }
    if (method === 'session.fork') {
      const input = objectPayload(payload)
      const atSeq = input.atSeq === undefined ? undefined : typeof input.atSeq === 'number' && Number.isSafeInteger(input.atSeq) && input.atSeq >= 0 ? input.atSeq : (() => { throw new Error('bad-atSeq') })()
      return wrap(rpcId, await apiProxy.sessions.fork({ ...request, payload: { sessionId: stringField(input, 'sessionId'), ...(atSeq === undefined ? {} : { atSeq }) } } as never))
    }
    if (method === 'session.cancel') return wrap(rpcId, await apiProxy.sessions.cancel({ ...request, payload: sessionPayload(payload) } as never))
    if (method === 'session.attachment') {
      const input = objectPayload(payload)
      return wrap(rpcId, await apiProxy.sessions.attachment({ ...request, payload: { sessionId: stringField(input, 'sessionId'), attachmentId: stringField(input, 'attachmentId', 512) } } as never))
    }
    if (method === 'session.respond') {
      const response = safeResponse(payload as Record<string, unknown>)
      const receipt = await apiProxy.respond({ type: 'client-response', rpcId: RpcId(response.rpcId), result: response.result })
      return envelope(rpcId, { ok: true, value: receipt })
    }
    throw new Error('forbidden-method')
  }

  const method = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'POST') return json(res, 405, { ok: false, code: 'method-not-allowed' })
    if (req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return json(res, 415, { ok: false, code: 'json-required' })
    if (!authenticated(req)) return json(res, 403, { ok: false, code: 'unpaired' })
    const pathname = new URL(req.url ?? '/', 'http://harness-remote').pathname
    const name = pathname.slice(`${API_PREFIX}/`.length)
    if (!ALLOWLIST.has(name)) return json(res, 403, { ok: false, code: 'forbidden-method' })
    let rpcId = 'invalid'
    try {
      const payload = await readBody(req)
      rpcId = requestId(payload.rpcId)
      return json(res, 200, await dispatch(name, payload.payload, rpcId))
    } catch (error) {
      const code = error instanceof Error ? error.message : 'internal'
      return json(res, code === 'body-too-large' ? 413 : 400, envelope(rpcId, { ok: false, error: { code, message: code } }))
    }
  }

  const events = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'GET') return json(res, 405, { ok: false, code: 'method-not-allowed' })
    if (!authenticated(req)) { res.writeHead(403); res.end('forbidden'); return }
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' })
    res.write(': connected\n\n')
    const abort = new AbortController()
    let closed = false
    const touch = (): void => { const id = readCookie(req.headers.cookie, service.config.cookieName); if (id) service.touch(id) }
    const timer = setInterval(() => { touch(); if (!closed) res.write(': ping\n\n') }, 15000)
    const close = (): void => { if (closed) return; closed = true; abort.abort(); clearInterval(timer) }
    res.on('close', close)
    try {
      const frames = apiProxy.events.mux({ rpcId: RpcId(`remote-${Date.now().toString(36)}`), payload: {} }, abort.signal)
      for await (const frame of frames) {
        if (closed) break
        res.write(`data: ${JSON.stringify({ type: 'server-request', rpcId: frame.rpcId, method: 'events.mux', payload: frame.payload })}\n\n`)
      }
    } catch { /* the browser reconnects; polling is the fallback */ }
    close()
    if (!res.writableEnded) res.end()
  }

  return [
    { kind: 'prefix', path: API_PREFIX, handler: method },
    { kind: 'exact', path: EVENTS_PATH, handler: events },
  ]
}

export { API_PREFIX, EVENTS_PATH, ALLOWLIST }
