import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { PairingService } from '../src/host/pairing.ts'
import { makePairingRoutes, type TunnelControl } from '../src/host/routes.ts'
import type { TunnelState } from '../src/host/tunnel.ts'

function request(method: string, remoteAddress = '127.0.0.1', host = 'localhost:3080'): IncomingMessage {
  return { method, headers: { host }, socket: { remoteAddress } } as unknown as IncomingMessage
}

function response(): { value: () => unknown; server: ServerResponse } {
  let body: unknown
  const server = { writeHead: () => {}, end: (value?: string) => { body = value === undefined ? undefined : JSON.parse(value) } } as unknown as ServerResponse
  return { value: () => body, server }
}

function tunnelControl(): { control: TunnelControl; starts: () => number; stops: () => number } {
  let state: TunnelState = { state: 'stopped' }
  let startCount = 0
  let stopCount = 0
  const listeners = new Set<(next: TunnelState) => void>()
  return {
    control: {
      get snapshot() { return state },
      onChange(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      start() { startCount += 1; state = { state: 'starting' }; for (const listener of listeners) listener(state) },
      stop() { stopCount += 1; state = { state: 'stopped' }; for (const listener of listeners) listener(state) },
    },
    starts: () => startCount,
    stops: () => stopCount,
  }
}

describe('pairing routes', () => {
  it('does not start a tunnel while merely reading status', async () => {
    const service = new PairingService({ tokenTtlMs: 60_000, pendingTtlMs: 60_000, offlineAfterMs: 60_000, maxDevices: 1, cookieName: 'device' })
    const fake = tunnelControl()
    const routes = makePairingRoutes(service, 3080, fake.control)
    const status = routes.find(route => route.path === '/harness-remote/pair/status')
    if (status === undefined) throw new Error('status route missing')
    const result = response()
    await status.handler(request('GET'), result.server)
    expect(fake.starts()).toBe(0)
    expect((result.value() as { tunnel: TunnelState }).tunnel.state).toBe('stopped')
  })

  it('starts only from the loopback confirmation route', async () => {
    const service = new PairingService({ tokenTtlMs: 60_000, pendingTtlMs: 60_000, offlineAfterMs: 60_000, maxDevices: 1, cookieName: 'device' })
    const fake = tunnelControl()
    const routes = makePairingRoutes(service, 3080, fake.control)
    const start = routes.find(route => route.path === '/harness-remote/pair/tunnel/start')
    if (start === undefined) throw new Error('tunnel route missing')

    const remote = response()
    await start.handler(request('POST', '192.168.1.40', 'localhost:3080'), remote.server)
    expect(fake.starts()).toBe(0)
    expect((remote.value() as { code: string }).code).toBe('loopback-required')

    const local = response()
    await start.handler(request('POST'), local.server)
    expect(fake.starts()).toBe(1)
    expect((local.value() as { tunnel: TunnelState }).tunnel.state).toBe('starting')
  })
})
