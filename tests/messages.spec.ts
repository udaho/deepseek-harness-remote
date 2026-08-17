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
})
