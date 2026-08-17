import { readFileSync } from 'node:fs'
import { setInterval as nodeSetInterval } from 'node:timers'
import type { IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from 'schemastery'
import { lanIPv4Addresses } from './host/lan.ts'
import { makeApiGate } from './host/gate.ts'
import { makeMobileApiRoutes } from './host/mobile-api.ts'
import { makeMobileRoutes } from './host/mobile-routes.ts'
import { PairingService } from './host/pairing.ts'
import { makePairingRoutes } from './host/routes.ts'
import { TunnelManager, type TunnelState } from './host/tunnel.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'api/gate'(
      this: Context,
      request: IncomingMessage,
      method: string | undefined,
      next: () => boolean | Promise<boolean>,
    ): boolean | Promise<boolean>
  }
}

export const name = 'harness-remote'
export const inject = ['webServer', 'apiProxy']

export interface Config {
  enabled?: boolean
  tokenTtlMs?: number
  pendingTtlMs?: number
  offlineAfterMs?: number
  maxDevices?: number
  publicBaseUrl?: string
  /** Legacy profile compatibility; tunnel creation is now always user-triggered. */
  autoTunnel?: boolean
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  tokenTtlMs: z.number().step(1).min(60_000).default(5 * 60_000),
  pendingTtlMs: z.number().step(1).min(30_000).default(2 * 60_000),
  offlineAfterMs: z.number().step(1).min(5_000).default(25_000),
  maxDevices: z.number().step(1).min(1).max(32).default(1),
  publicBaseUrl: z.string(),
  autoTunnel: z.boolean().default(false),
})

const DEFAULTS = { enabled: true, tokenTtlMs: 5 * 60_000, pendingTtlMs: 2 * 60_000, offlineAfterMs: 25_000, maxDevices: 1, autoTunnel: false } as const

export function apply(ctx: Context, config: Config = {}): void {
  const resolved = {
    enabled: config.enabled ?? DEFAULTS.enabled,
    tokenTtlMs: config.tokenTtlMs ?? DEFAULTS.tokenTtlMs,
    pendingTtlMs: config.pendingTtlMs ?? DEFAULTS.pendingTtlMs,
    offlineAfterMs: config.offlineAfterMs ?? DEFAULTS.offlineAfterMs,
    maxDevices: config.maxDevices ?? DEFAULTS.maxDevices,
    publicBaseUrl: config.publicBaseUrl,
    autoTunnel: config.autoTunnel ?? DEFAULTS.autoTunnel,
  }
  const service = new PairingService({ tokenTtlMs: resolved.tokenTtlMs, pendingTtlMs: resolved.pendingTtlMs, offlineAfterMs: resolved.offlineAfterMs, maxDevices: resolved.maxDevices, cookieName: 'harness_remote_device' })
  const port = ctx.webServer.port
  const host = ctx.webServer.host
  service.setLanBases(host === '0.0.0.0' ? lanIPv4Addresses().map(address => ({ address, base: `http://${address}:${String(port)}` })) : [])
  if (!resolved.autoTunnel && resolved.publicBaseUrl !== undefined) {
    try {
      const publicUrl = new URL(resolved.publicBaseUrl)
      if (publicUrl.protocol !== 'https:') throw new Error('publicBaseUrl must use https')
      service.setPublicBase(publicUrl.origin)
    } catch (error) {
      console.warn(`harness-remote: ignoring invalid publicBaseUrl (${error instanceof Error ? error.message : String(error)})`)
    }
  }

  const tunnel = new TunnelManager()
  const configuredPublicBase = service.publicBaseUrl
  const tunnelOff = tunnel.onChange(state => { service.setPublicBase(state.state === 'running' ? state.url : configuredPublicBase) })
  const tunnelControl = {
    get snapshot() { return tunnel.snapshot },
    onChange(listener: (state: TunnelState) => void): () => void { return tunnel.onChange(listener) },
    start(): void { tunnel.start(`http://127.0.0.1:${String(port)}`) },
    stop(): void { tunnel.stop() },
  }
  ctx.effect(() => () => { tunnelOff(); tunnel.stop() }, 'harness-remote: tunnel')

  const apiProxy = ctx.get('apiProxy') as ApiProxy | undefined
  if (apiProxy === undefined) throw new Error('harness-remote requires apiProxy')
  const routes = [
    ...makePairingRoutes(service, port, tunnelControl),
    ...makeMobileRoutes(() => {
      try { return readFileSync(new URL('./mobile.js', import.meta.url), 'utf8') } catch { return undefined }
    }),
    ...makeMobileApiRoutes({ service, apiProxy }),
  ]
  ctx.effect(() => {
    const disposers = resolved.enabled ? routes.map(route => ctx.webServer.register(route)) : []
    return () => { for (const dispose of disposers) dispose() }
  }, 'harness-remote: routes')
  ctx.effect(() => {
    if (!resolved.enabled) return () => {}
    return ctx.on('api/gate', makeApiGate(service))
  }, 'harness-remote: global api gate')
  const timer = nodeSetInterval(() => service.sweep(), 10_000)
  timer.unref()
  ctx.effect(() => () => clearInterval(timer), 'harness-remote: pairing sweep')
}

export { PairingService } from './host/pairing.ts'
export { TunnelManager } from './host/tunnel.ts'
