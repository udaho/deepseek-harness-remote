import { describe, expect, it } from 'vitest'
import { PairingService } from '../src/host/pairing.ts'

function setup() {
  let now = 1000
  const service = new PairingService({ tokenTtlMs: 100, pendingTtlMs: 50, offlineAfterMs: 20, maxDevices: 1, cookieName: 'device' }, () => now)
  service.setLanBases([{ address: '192.168.1.20', base: 'http://192.168.1.20:3080' }])
  return { service, advance: (ms: number) => { now += ms } }
}

describe('PairingService', () => {
  it('consumes a token into an approval challenge, then issues a device only after approval', () => {
    const { service } = setup()
    const issued = service.issue()
    const pending = service.accept(issued.token, { userAgent: 'phone', address: '192.168.1.40' })
    expect(pending.ok).toBe(true)
    if (!pending.ok) return
    expect(service.snapshot().pending[0]?.code).toBe(pending.code)
    expect(service.complete(pending.pendingId).status).toBe('pending')
    const approved = service.approve(pending.pendingId)
    expect(approved.ok).toBe(true)
    expect(service.complete(pending.pendingId).status).toBe('approved')
  })

  it('rejects token reuse and expires pending challenges', () => {
    const { service, advance } = setup()
    const issued = service.issue()
    expect(service.accept(issued.token).ok).toBe(true)
    expect(service.accept(issued.token)).toEqual({ ok: false, code: 'used' })
    advance(101)
    expect(service.issue().token).toBeTypeOf('string')
    const second = service.accept(service.issue().token)
    expect(second.ok).toBe(true)
    if (second.ok) { advance(51); expect(service.complete(second.pendingId).status).toBe('expired') }
  })

  it('enforces the configured device cap without silently evicting a live device', () => {
    const { service } = setup()
    const first = service.accept(service.issue().token)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(service.approve(first.pendingId).ok).toBe(true)
    const second = service.accept(service.issue().token)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(service.approve(second.pendingId)).toEqual({ ok: false, code: 'device-limit' })
  })
})
