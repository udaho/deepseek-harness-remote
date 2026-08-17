import { describe, expect, it } from 'vitest'
import { fold } from '../src/mobile/messages.ts'

const event = (seq: number, type: string, data: unknown) => ({ seq, type, time: seq, data })

describe('mobile message fold', () => {
  it('folds user text, assistant deltas, and tools idempotently', () => {
    const events = [
      event(1, 'user/message', { id: 'u1', content: [{ type: 'text', text: 'hello' }] }),
      event(2, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'hi' } }),
      event(3, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: { command: 'pwd' } }),
      event(4, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: ' there' } }),
      event(5, 'assistant/message', { turn: 1, step: 1, message: { id: 'a1', content: [{ type: 'text', text: 'hi there' }] } }),
    ]
    const result = fold([], events)
    expect(result).toHaveLength(2)
    expect(result[1]).toMatchObject({ id: 'a1', text: 'hi there', pending: false })
    expect(result[1]?.tools[0]?.name).toBe('bash')
    expect(fold(result, events)).toEqual(result)
  })

  it('keeps streamed chunks in one row across live fold calls and replaces it with the final message', () => {
    const first = fold([], [event(1, 'assistant/chunk', { turn: 3, step: 0, chunk: { type: 'text-delta', text: 'Hel' } })])
    const second = fold(first, [event(2, 'assistant/chunk', { turn: 3, step: 0, chunk: { type: 'text-delta', text: 'lo' } })])
    expect(second).toHaveLength(1)
    expect(second[0]).toMatchObject({ text: 'Hello', pending: true })

    const final = fold(second, [event(3, 'assistant/message', { turn: 3, step: 0, message: { id: 'a-final', content: [{ type: 'text', text: 'Hello!' }] } })])
    expect(final).toHaveLength(1)
    expect(final[0]).toMatchObject({ id: 'a-final', text: 'Hello!', pending: false })
  })

  it('retains source kind so injected system/plugin prompts can be hidden by the view', () => {
    const result = fold([], [event(1, 'user/message', { id: 'system-1', source: { kind: 'plugin' }, content: [{ type: 'text', text: '<system-reminder>context</system-reminder>' }] })])
    expect(result[0]).toMatchObject({ kind: 'user', sourceKind: 'plugin', text: '<system-reminder>context</system-reminder>' })
  })
})
