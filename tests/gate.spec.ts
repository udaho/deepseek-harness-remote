import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { makeApiGate } from '../src/host/gate.ts'
import { PairingService } from '../src/host/pairing.ts'

function request(remoteAddress: string, host: string, cookie?: string): IncomingMessage {
  return {
    headers: { host, ...(cookie ? { cookie } : {}) },
    socket: { remoteAddress },
  } as unknown as IncomingMessage
}

function pairedDevice(service: PairingService): string {
  const issued = service.issue()
  const accepted = service.accept(issued.token)
  if (!accepted.ok) throw new Error('pairing setup failed')
  const approved = service.approve(accepted.pendingId)
  if (!approved.ok) throw new Error('approval setup failed')
  return approved.deviceId
}

describe('Harness API gate', () => {
  it('allows loopback desktop traffic and rejects an unpaired remote client', async () => {
    const service = new PairingService({ tokenTtlMs: 60_000, pendingTtlMs: 60_000, offlineAfterMs: 60_000, maxDevices: 1, cookieName: 'device' })
    service.setLanBases([{ address: '192.168.1.20', base: 'http://192.168.1.20:3080' }])
    const gate = makeApiGate(service)
    let continued = 0
    const next = () => { continued += 1; return true }

    expect(await gate(request('127.0.0.1', 'localhost:3080'), undefined, next)).toBe(true)
    expect(await gate(request('192.168.1.40', '192.168.1.20:3080'), undefined, next)).toBe(false)
    expect(continued).toBe(1)
  })

  it('allows a remote client only after a live paired-device cookie is present', async () => {
    const service = new PairingService({ tokenTtlMs: 60_000, pendingTtlMs: 60_000, offlineAfterMs: 60_000, maxDevices: 1, cookieName: 'device' })
    service.setLanBases([{ address: '192.168.1.20', base: 'http://192.168.1.20:3080' }])
    const deviceId = pairedDevice(service)
    const gate = makeApiGate(service)
    let continued = 0
    const next = () => { continued += 1; return true }

    expect(await gate(request('192.168.1.40', '192.168.1.20:3080', `device=${deviceId}`), undefined, next)).toBe(true)
    service.stop()
    expect(await gate(request('192.168.1.40', '192.168.1.20:3080', `device=${deviceId}`), undefined, next)).toBe(false)
    expect(continued).toBe(1)
  })
})
