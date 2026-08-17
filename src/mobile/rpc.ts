export class RpcError extends Error {
  constructor(message: string, readonly code = 'transport') { super(message); this.name = 'RpcError' }
}

let sequence = 0
function rpcId(): string {
  sequence += 1
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${random}-${sequence.toString(36)}`
}

export async function call<T>(method: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  const id = rpcId()
  let response: Response
  try {
    response = await fetch(`/harness-remote/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: id, method, payload }), signal })
  } catch (error) { throw new RpcError(error instanceof Error ? error.message : String(error)) }
  if (!response.ok) throw new RpcError(`HTTP ${String(response.status)}`, response.status === 403 ? 'unpaired' : 'http')
  const envelope = await response.json() as { type?: string; rpcId?: string; result?: { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } } }
  if (envelope.type !== 'server-response' || envelope.rpcId !== id || envelope.result === undefined) throw new RpcError('Malformed response')
  if (envelope.result.ok === true) return envelope.result.value as T
  throw new RpcError(envelope.result.error?.message ?? 'Harness request failed', envelope.result.error?.code ?? 'remote')
}

export async function respond(rpcIdValue: string, value: unknown): Promise<void> {
  await call('session.respond', { rpcId: rpcIdValue, result: { ok: true, value } })
}
