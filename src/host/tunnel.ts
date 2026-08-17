import { existsSync } from 'node:fs'
import { bin, install, Tunnel } from 'cloudflared'

export type TunnelState = { state: 'stopped' | 'starting' | 'running' | 'failed'; url?: string; error?: string }
type Handle = { on(event: string, listener: (...args: unknown[]) => void): unknown; stop(): boolean }

export class TunnelManager {
  private target: string | undefined
  private handle: Handle | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = true
  private attempts = 0
  private state: TunnelState = { state: 'stopped' }
  private readonly listeners = new Set<(state: TunnelState) => void>()

  constructor(private readonly timeoutMs = 30000) {}

  onChange(listener: (state: TunnelState) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  get snapshot(): TunnelState { return this.state }

  start(target: string): void {
    if (this.target === target && !this.stopped && (this.state.state === 'starting' || this.state.state === 'running')) return
    this.stop()
    this.target = target
    this.stopped = false
    this.attempts = 0
    void this.attempt()
  }

  stop(): void {
    this.stopped = true
    this.target = undefined
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.handle?.stop()
    this.handle = undefined
    this.set({ state: 'stopped' })
  }

  private async attempt(): Promise<void> {
    const target = this.target
    if (this.stopped || target === undefined) return
    this.set({ state: 'starting' })
    try {
      if (!existsSync(bin)) await install(bin)
      if (this.stopped || this.target !== target) return
      const handle = Tunnel.quick(target, { '--no-autoupdate': true }) as unknown as Handle
      this.handle = handle
      let seenUrl = false
      this.timer = setTimeout(() => { if (!seenUrl) this.fail('timed out waiting for tunnel URL') }, this.timeoutMs)
      handle.on('url', (url: unknown) => { if (typeof url !== 'string' || this.handle !== handle) return; seenUrl = true; if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.attempts = 0; this.set({ state: 'running', url }) })
      handle.on('exit', () => { if (this.handle === handle && !this.stopped) this.fail('tunnel process exited') })
      handle.on('error', (error: unknown) => { if (this.handle === handle && this.state.state === 'starting') this.set({ state: 'starting', error: error instanceof Error ? error.message : String(error) }) })
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error))
    }
  }

  private fail(error: string): void {
    if (this.stopped) return
    this.handle?.stop()
    this.handle = undefined
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.set({ state: 'failed', error })
    const delay = Math.min(5000 * 2 ** this.attempts, 60000)
    this.attempts += 1
    this.timer = setTimeout(() => { this.timer = undefined; void this.attempt() }, delay)
  }

  private set(state: TunnelState): void { this.state = state; for (const listener of this.listeners) { try { listener(state) } catch { /* observer isolation */ } } }
}
