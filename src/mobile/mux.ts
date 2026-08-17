import type { MuxFrame } from '@deepseek-ai/dsh-host-apiproxy/api/events'
import { muxFrameSchema } from '@deepseek-ai/dsh-host-apiproxy/api/events.schema'
import { serverRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import { history } from './api.ts'

type Listener = (rpcId: string, frame: MuxFrame) => void
export class MuxClient {
  private source: EventSource | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private stopped = true
  private observed: string | undefined
  private lastData = 0
  private polling = false
  private watermark = new Map<string, number>()
  private readonly listeners = new Set<Listener>()

  onFrame(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  start(): void { if (!this.stopped) return; this.stopped = false; this.lastData = Date.now(); this.connect(); this.timer = setInterval(() => this.tick(), 1000) }
  stop(): void { this.stopped = true; this.source?.close(); this.source = undefined; if (this.timer) clearInterval(this.timer); this.timer = undefined; this.polling = false }
  observe(sessionId: string | undefined): void { this.observed = sessionId }

  private connect(): void {
    if (this.stopped) return
    const source = new EventSource('/harness-remote/api/events.mux')
    this.source = source
    source.onmessage = event => {
      try {
        const request = serverRequestSchema.safeParse(JSON.parse(event.data))
        if (!request.success) return
        const parsed = muxFrameSchema.safeParse(request.data.payload)
        if (!parsed.success) return
        this.lastData = Date.now()
        this.polling = false
        for (const listener of this.listeners) listener(request.data.rpcId, parsed.data)
      } catch { /* reconnect/poll on the next tick */ }
    }
    source.onerror = () => { this.polling = true }
  }

  private tick(): void {
    if (this.stopped || this.observed === undefined) return
    if (!this.polling && Date.now() - this.lastData < 12000) return
    this.polling = true
    void history(this.observed, undefined, 60).then(page => {
      let max = this.watermark.get(this.observed!) ?? -1
      for (const entry of page.events) {
        if (entry.event.seq <= max) continue
        max = entry.event.seq
        for (const listener of this.listeners) listener(`poll-${String(entry.event.seq)}`, { type: 'session/event', sessionId: this.observed! as never, event: entry.event, ...(entry.view ? { view: entry.view } : {}) })
      }
      this.watermark.set(this.observed!, max)
    }).catch(() => {})
  }
}
