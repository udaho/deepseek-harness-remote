export interface WireEvent { type: string; seq: number; time: number; data: unknown }
export interface ToolInfo { id: string; name: string; arguments?: string }
export interface RenderMessage { id: string; kind: 'user' | 'assistant'; text: string; reasoning?: string; tools: ToolInfo[]; seq: number; time: number; pending?: boolean; failed?: boolean; images?: string[] }

function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function text(content: unknown, kind: string): string { return Array.isArray(content) ? content.filter(block => record(block).type === kind).map(block => typeof record(block).text === 'string' ? record(block).text as string : '').join('') : '' }
function imageIds(content: unknown): string[] { return Array.isArray(content) ? content.map(block => record(block)).filter(block => block.type === 'image' && typeof block.attachmentId === 'string').map(block => block.attachmentId as string) : [] }

export function fold(existing: RenderMessage[], events: WireEvent[]): RenderMessage[] {
  const result = existing.map(item => ({ ...item, tools: [...item.tools] }))
  const byId = new Map(result.map(item => [item.id, item]))
  const byStep = new Map<string, RenderMessage>()
  let watermark = result.reduce((max, item) => Math.max(max, item.seq), -1)
  const replace = (old: RenderMessage, next: RenderMessage): void => { const index = result.indexOf(old); if (index >= 0) result[index] = next; byId.delete(old.id); byId.set(next.id, next); for (const [key, value] of byStep) if (value === old) byStep.set(key, next) }
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.seq <= watermark) continue
    watermark = event.seq
    const data = record(event.data)
    if (event.type === 'user/message') {
      const messageId = typeof data.id === 'string' ? data.id : `user-${String(event.seq)}`
      const next: RenderMessage = { id: messageId, kind: 'user', text: text(data.content, 'text'), images: imageIds(data.content), tools: [], seq: event.seq, time: event.time }
      const old = byId.get(messageId); if (old) replace(old, next); else { result.push(next); byId.set(messageId, next) }
    } else if (event.type === 'assistant/message') {
      const message = record(data.message)
      const messageId = typeof message.id === 'string' ? message.id : typeof data.id === 'string' ? data.id : `assistant-${String(event.seq)}`
      const key = typeof data.turn === 'number' && typeof data.step === 'number' ? `${String(data.turn)}:${String(data.step)}` : undefined
      const old = byId.get(messageId) ?? (key ? byStep.get(key) : undefined)
      const next: RenderMessage = { ...(old ?? { id: messageId, kind: 'assistant' as const, tools: [] }), id: messageId, kind: 'assistant', text: text(message.content ?? data.content, 'text'), reasoning: text(message.content ?? data.content, 'reasoning') || old?.reasoning, tools: old?.tools ?? [], seq: event.seq, time: event.time, pending: false, images: imageIds(message.content ?? data.content) }
      if (old) replace(old, next); else { result.push(next); byId.set(messageId, next) }
      if (key) byStep.set(key, next)
    } else if (event.type === 'assistant/chunk' || event.type === 'message/chunk') {
      const chunk = record(data.chunk)
      const kind = chunk.type === 'reasoning-delta' || data.kind === 'reasoning' ? 'reasoning' : 'text'
      const value = typeof chunk.text === 'string' ? chunk.text : typeof data.text === 'string' ? data.text : ''
      if (!value) continue
      const key = typeof data.turn === 'number' && typeof data.step === 'number' ? `${String(data.turn)}:${String(data.step)}` : undefined
      const old = key ? byStep.get(key) : undefined
      if (old) { const next = { ...old, [kind]: `${old[kind] ?? ''}${value}`, seq: event.seq, time: event.time, pending: true }; replace(old, next); if (key) byStep.set(key, next) }
      else { const next: RenderMessage = { id: `assistant-${key ?? String(event.seq)}`, kind: 'assistant', text: kind === 'text' ? value : '', reasoning: kind === 'reasoning' ? value : undefined, tools: [], seq: event.seq, time: event.time, pending: true }; result.push(next); byId.set(next.id, next); if (key) byStep.set(key, next) }
    } else if (event.type === 'tool/call') {
      const key = typeof data.turn === 'number' && typeof data.step === 'number' ? `${String(data.turn)}:${String(data.step)}` : undefined
      const target = (key ? byStep.get(key) : undefined) ?? [...result].reverse().find(item => item.kind === 'assistant')
      if (target) { const next = { ...target, tools: [...target.tools, { id: typeof data.callId === 'string' ? data.callId : `tool-${String(event.seq)}`, name: typeof data.name === 'string' ? data.name : 'tool', arguments: data.arguments === undefined ? undefined : JSON.stringify(data.arguments) }], seq: event.seq, time: event.time }; replace(target, next); if (key) byStep.set(key, next) }
    } else if (event.type === 'turn/end') {
      const turn = typeof data.turn === 'number' ? data.turn : undefined
      for (const item of result) if (item.kind === 'assistant' && item.pending && (turn === undefined || item.id.includes(`-${String(turn)}:`))) { const next = { ...item, pending: false, failed: record(data.reason).kind === 'error', seq: event.seq, time: event.time }; replace(item, next) }
    }
  }
  return result.sort((a, b) => a.seq - b.seq)
}
