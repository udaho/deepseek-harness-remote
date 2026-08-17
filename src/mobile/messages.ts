/**
 * Fold Harness session events into stable mobile message rows.
 *
 * This follows the reference remote UI's important streaming rules: pending
 * assistant rows are indexed by turn/step across incremental fold calls, and
 * the final assistant message replaces that pending row instead of creating a
 * second bubble. Injected user messages retain source.kind so the UI can hide
 * system/plugin prompts by default.
 */

export interface WireEvent {
  type: string
  seq: number
  time: number
  data: unknown
}

export interface ToolInfo {
  id: string
  name: string
  arguments?: string
}

export interface RenderMessage {
  id: string
  kind: 'user' | 'assistant'
  text: string
  reasoning?: string
  sourceKind?: string
  tools: ToolInfo[]
  seq: number
  time: number
  pending?: boolean
  failed?: boolean
  images?: string[]
}

type FoldState = {
  messages: RenderMessage[]
  byId: Map<string, RenderMessage>
  pendingByTurnStep: Map<string, RenderMessage>
  turnStepMessage: Map<string, RenderMessage>
  messageTurn: Map<string, number>
  toolIds: Map<string, Set<string>>
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined }
function numberValue(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }

function contentText(content: unknown, type: 'text' | 'reasoning'): string {
  if (!Array.isArray(content)) return ''
  return content.map(block => record(block)).filter(block => block.type === type).map(block => stringValue(block.text) ?? '').join('')
}

function imageIds(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  return content.map(block => record(block)).filter(block => block.type === 'image' && typeof block.attachmentId === 'string').map(block => block.attachmentId as string)
}

function turnStep(turn: number | undefined, step: number | undefined): string | undefined {
  return turn === undefined || step === undefined ? undefined : `${turn}.${step}`
}

function syntheticId(prefix: string, seq: number): string { return `${prefix}#${seq}` }

function decodeTurnStep(id: string): { turn: number; step: number } | undefined {
  if (!id.startsWith('assistant,')) return undefined
  const body = id.slice('assistant,'.length).split('#', 1)[0] ?? ''
  const dot = body.indexOf('.')
  if (dot <= 0 || dot === body.length - 1) return undefined
  const turn = Number(body.slice(0, dot))
  const step = Number(body.slice(dot + 1))
  return Number.isInteger(turn) && Number.isInteger(step) ? { turn, step } : undefined
}

function replaceMessage(state: FoldState, oldMessage: RenderMessage, next: RenderMessage): void {
  const index = state.messages.indexOf(oldMessage)
  if (index >= 0) state.messages[index] = next
  state.byId.delete(oldMessage.id)
  state.byId.set(next.id, next)
  for (const [key, value] of state.pendingByTurnStep) if (value === oldMessage) state.pendingByTurnStep.set(key, next)
  for (const [key, value] of state.turnStepMessage) if (value === oldMessage) state.turnStepMessage.set(key, next)
  if (state.messageTurn.has(oldMessage.id)) {
    const turn = state.messageTurn.get(oldMessage.id)
    state.messageTurn.delete(oldMessage.id)
    if (turn !== undefined) state.messageTurn.set(next.id, turn)
  }
  const ids = state.toolIds.get(oldMessage.id)
  if (ids !== undefined) { state.toolIds.delete(oldMessage.id); state.toolIds.set(next.id, ids) }
}

function createState(existing: readonly RenderMessage[]): FoldState {
  const state: FoldState = {
    messages: existing.map(message => ({ ...message, tools: [...message.tools] })),
    byId: new Map(),
    pendingByTurnStep: new Map(),
    turnStepMessage: new Map(),
    messageTurn: new Map(),
    toolIds: new Map(),
  }
  for (const message of state.messages) {
    state.byId.set(message.id, message)
    if (message.tools.length > 0) state.toolIds.set(message.id, new Set(message.tools.map(tool => tool.id)))
    if (message.kind !== 'assistant') continue
    const decoded = decodeTurnStep(message.id)
    if (decoded === undefined) continue
    const key = turnStep(decoded.turn, decoded.step)
    if (key === undefined) continue
    state.turnStepMessage.set(key, message)
    if (message.pending === true) state.pendingByTurnStep.set(key, message)
    state.messageTurn.set(message.id, decoded.turn)
  }
  return state
}

function watermark(existing: readonly RenderMessage[]): number {
  return existing.reduce((max, message) => Math.max(max, message.seq), -1)
}

function applyUser(state: FoldState, event: WireEvent): void {
  const data = record(event.data)
  const id = stringValue(data.id) ?? syntheticId('user', event.seq)
  const source = record(data.source)
  const sourceKind = stringValue(source.kind)
  const next: RenderMessage = {
    id,
    kind: 'user',
    text: contentText(data.content, 'text'),
    ...(sourceKind !== undefined ? { sourceKind } : {}),
    tools: [],
    images: imageIds(data.content),
    seq: event.seq,
    time: event.time,
  }
  const old = state.byId.get(id)
  if (old === undefined) { state.messages.push(next); state.byId.set(id, next) } else replaceMessage(state, old, { ...old, ...next })
}

function usageFrom(data: Record<string, unknown>): unknown {
  const usage = record(data.usage)
  const inputTokens = numberValue(usage.inputTokens)
  const outputTokens = numberValue(usage.outputTokens)
  return inputTokens !== undefined && outputTokens !== undefined ? { inputTokens, outputTokens } : undefined
}

function applyAssistant(state: FoldState, event: WireEvent): void {
  const data = record(event.data)
  const message = record(data.message)
  const content = message.content ?? data.content
  const id = stringValue(message.id) ?? stringValue(data.id) ?? syntheticId('assistant', event.seq)
  const turn = numberValue(data.turn)
  const key = turnStep(turn, numberValue(data.step))
  const old = state.byId.get(id) ?? (key === undefined ? undefined : state.pendingByTurnStep.get(key))
  const finalReasoning = contentText(content, 'reasoning')
  const usage = usageFrom(data)
  const next: RenderMessage = {
    ...(old ?? { id, kind: 'assistant' as const, tools: [] }),
    id,
    kind: 'assistant',
    text: contentText(content, 'text'),
    ...(finalReasoning !== '' ? { reasoning: finalReasoning } : old?.reasoning !== undefined ? { reasoning: old.reasoning } : {}),
    tools: old?.tools ?? [],
    images: imageIds(content),
    seq: event.seq,
    time: event.time,
    pending: false,
    ...(usage !== undefined ? { usage } : {}),
  } as RenderMessage
  if (old === undefined) { state.messages.push(next); state.byId.set(id, next) } else replaceMessage(state, old, next)
  if (key !== undefined) {
    state.pendingByTurnStep.delete(key)
    state.turnStepMessage.set(key, next)
    if (turn !== undefined) state.messageTurn.set(next.id, turn)
  }
}

function chunkData(data: Record<string, unknown>): { text: string; kind: 'text' | 'reasoning'; id?: string; turn?: number; step?: number } | undefined {
  const chunk = record(data.chunk)
  if (Object.keys(chunk).length > 0) {
    const type = stringValue(chunk.type)
    if (type !== 'text-delta' && type !== 'reasoning-delta') return undefined
    const text = stringValue(chunk.text)
    if (text === undefined) return undefined
    return { text, kind: type === 'reasoning-delta' ? 'reasoning' : 'text', turn: numberValue(data.turn), step: numberValue(data.step) }
  }
  const text = stringValue(data.text)
  if (text === undefined) return undefined
  const id = stringValue(data.messageId) ?? stringValue(data.id)
  return { text, kind: stringValue(data.kind) === 'reasoning' ? 'reasoning' : 'text', id, turn: numberValue(data.turn), step: numberValue(data.step) }
}

function applyChunk(state: FoldState, event: WireEvent): void {
  const data = record(event.data)
  const chunk = chunkData(data)
  if (chunk === undefined) return
  const key = turnStep(chunk.turn, chunk.step)
  const old = chunk.id !== undefined
    ? state.byId.get(chunk.id)
    : key === undefined ? undefined : state.pendingByTurnStep.get(key) ?? state.turnStepMessage.get(key)
  if (old !== undefined && old.kind === 'assistant') {
    const next = chunk.kind === 'reasoning'
      ? { ...old, reasoning: `${old.reasoning ?? ''}${chunk.text}`, seq: event.seq, time: event.time }
      : { ...old, text: `${old.text}${chunk.text}`, seq: event.seq, time: event.time }
    replaceMessage(state, old, next)
    return
  }
  const id = chunk.id ?? (key === undefined ? syntheticId('assistant', event.seq) : syntheticId(`assistant,${key}`, event.seq))
  const next: RenderMessage = { id, kind: 'assistant', text: chunk.kind === 'text' ? chunk.text : '', ...(chunk.kind === 'reasoning' ? { reasoning: chunk.text } : {}), tools: [], seq: event.seq, time: event.time, pending: true }
  state.messages.push(next)
  state.byId.set(id, next)
  if (key !== undefined) {
    state.pendingByTurnStep.set(key, next)
    state.turnStepMessage.set(key, next)
  }
  if (chunk.turn !== undefined) state.messageTurn.set(id, chunk.turn)
}

function applyTool(state: FoldState, event: WireEvent): void {
  const data = record(event.data)
  const name = stringValue(data.name)
  if (name === undefined) return
  const turn = numberValue(data.turn)
  const key = turnStep(turn, numberValue(data.step))
  let target = key === undefined ? undefined : state.turnStepMessage.get(key)
  if (target === undefined && turn !== undefined) target = [...state.messages].reverse().find(message => message.kind === 'assistant' && state.messageTurn.get(message.id) === turn)
  if (target === undefined) target = [...state.messages].reverse().find(message => message.kind === 'assistant')
  if (target === undefined) return
  const id = stringValue(data.callId) ?? `${name}#${event.seq}`
  const existingIndex = target.tools.findIndex(tool => tool.id === id)
  const args = data.arguments === undefined ? undefined : typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments)
  const tools = existingIndex < 0
    ? [...target.tools, { id, name, ...(args !== undefined ? { arguments: args } : {}) }]
    : target.tools.map((tool, index) => index === existingIndex ? { ...tool, ...(args !== undefined ? { arguments: args } : {}) } : tool)
  const next = { ...target, tools, seq: event.seq, time: event.time }
  replaceMessage(state, target, next)
  if (key !== undefined) state.turnStepMessage.set(key, next)
}

function applyTurnEnd(state: FoldState, event: WireEvent): void {
  const data = record(event.data)
  const turn = numberValue(data.turn)
  const failed = record(data.reason).kind === 'error'
  const targets = state.messages.filter(message => message.kind === 'assistant' && (turn === undefined || state.messageTurn.get(message.id) === turn))
  for (const old of targets) replaceMessage(state, old, { ...old, ...(old.pending === true ? { pending: false } : {}), ...(failed ? { failed: true } : {}), seq: Math.max(old.seq, event.seq), time: event.time })
}

function findMessage(state: FoldState, event: WireEvent): RenderMessage | undefined {
  const data = record(event.data)
  const id = stringValue(data.id)
  if (id !== undefined) return state.byId.get(id)
  const seq = numberValue(data.seq ?? data.messageSeq)
  return seq === undefined ? undefined : state.messages.find(message => message.seq === seq)
}

function applyUpdate(state: FoldState, event: WireEvent): void {
  const old = findMessage(state, event)
  if (old === undefined) return
  const text = stringValue(record(event.data).text)
  replaceMessage(state, old, { ...old, ...(text !== undefined ? { text } : {}), seq: event.seq, time: event.time })
}

function applyDelete(state: FoldState, event: WireEvent): void {
  const old = findMessage(state, event)
  if (old === undefined) return
  const index = state.messages.indexOf(old)
  if (index >= 0) state.messages.splice(index, 1)
  state.byId.delete(old.id)
  state.messageTurn.delete(old.id)
  for (const [key, value] of state.pendingByTurnStep) if (value === old) state.pendingByTurnStep.delete(key)
  for (const [key, value] of state.turnStepMessage) if (value === old) state.turnStepMessage.delete(key)
}

function applyEvent(state: FoldState, event: WireEvent): void {
  if (event.type === 'user/message') applyUser(state, event)
  else if (event.type === 'assistant/message') applyAssistant(state, event)
  else if (event.type === 'assistant/chunk' || event.type === 'message/chunk') applyChunk(state, event)
  else if (event.type === 'tool/call') applyTool(state, event)
  else if (event.type === 'turn/end') applyTurnEnd(state, event)
  else if (event.type === 'message/update') applyUpdate(state, event)
  else if (event.type === 'message/delete') applyDelete(state, event)
}

export function foldEvents(events: readonly WireEvent[], existing: readonly RenderMessage[] = []): RenderMessage[] {
  const state = createState(existing)
  const floor = watermark(existing)
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.seq <= floor) continue
    applyEvent(state, event)
  }
  return [...state.messages].sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id))
}

/** Backward-compatible call shape used by this project's first mobile pass. */
export function fold(existing: RenderMessage[], events: WireEvent[]): RenderMessage[] {
  return foldEvents(events, existing)
}
