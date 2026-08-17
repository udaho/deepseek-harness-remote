import { randomBytes } from 'node:crypto'

export interface PairingConfig {
  tokenTtlMs: number
  pendingTtlMs: number
  offlineAfterMs: number
  maxDevices: number
  cookieName: string
}

export interface PendingPairing {
  id: string
  code: string
  createdAt: number
  expiresAt: number
  userAgent?: string
  address?: string
  status: 'pending' | 'approved' | 'rejected'
  reason?: string
  deviceId?: string
}

export interface PairingSnapshot {
  phase: 'lan-required' | 'stopped' | 'waiting' | 'pending' | 'connected' | 'disconnected'
  lanAddresses: string[]
  publicUrl?: string
  tokenExpiresAt?: number
  deviceCount: number
  onlineCount: number
  pending: Array<Omit<PendingPairing, 'deviceId'>>
}

export type PairAcceptResult =
  | { ok: true; pendingId: string; code: string; expiresAt: number }
  | { ok: false; code: 'invalid' | 'used' }

export class PairingService {
  private token: { value: string; expiresAt: number; consumed: boolean } | undefined
  private readonly pending = new Map<string, PendingPairing>()
  private readonly devices = new Map<string, { createdAt: number; lastSeenAt: number }>()
  private readonly listeners = new Set<(snapshot: PairingSnapshot) => void>()
  private stopped = false
  private lanBases = new Map<string, string>()
  private publicBase: string | undefined
  private lastSnapshot = ''

  constructor(public config: PairingConfig, private readonly now: () => number = () => Date.now()) {}

  setLanBases(entries: readonly { address: string; base: string }[]): void {
    this.lanBases = new Map(entries.map(entry => [entry.address, entry.base]))
    this.emit()
  }

  setPublicBase(url: string | undefined): void {
    this.publicBase = url
    this.emit()
  }

  get lanAddresses(): string[] { return [...this.lanBases.keys()] }
  get publicBaseUrl(): string | undefined { return this.publicBase }
  get lanBaseUrl(): string | undefined { return this.lanBases.values().next().value as string | undefined }
  lanBaseUrlFor(address: string): string | undefined { return this.lanBases.get(address) }

  issue(address?: string): { token: string; expiresAt: number } {
    if (this.lanBases.size === 0 && this.publicBase === undefined) throw new Error('lan-required')
    if (address !== undefined && !this.lanBases.has(address)) throw new Error('unknown-address')
    const value = randomBytes(32).toString('base64url')
    const expiresAt = this.now() + this.config.tokenTtlMs
    this.token = { value, expiresAt, consumed: false }
    this.pending.clear()
    this.stopped = false
    this.emit()
    return { token: value, expiresAt }
  }

  accept(value: string, metadata: { userAgent?: string; address?: string } = {}): PairAcceptResult {
    const token = this.token
    if (token === undefined || token.consumed || this.stopped || token.value !== value || this.now() > token.expiresAt) return { ok: false, code: token?.consumed ? 'used' : 'invalid' }
    token.consumed = true
    const id = randomBytes(24).toString('base64url')
    const code = String(Math.floor(100000 + Number.parseInt(randomBytes(4).toString('hex'), 16) % 900000))
    const pending: PendingPairing = { id, code, createdAt: this.now(), expiresAt: this.now() + this.config.pendingTtlMs, status: 'pending', ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}), ...(metadata.address ? { address: metadata.address } : {}) }
    this.pending.set(id, pending)
    this.emit()
    return { ok: true, pendingId: id, code, expiresAt: pending.expiresAt }
  }

  approve(id: string): { ok: true; deviceId: string } | { ok: false; code: 'not-found' | 'expired' | 'device-limit' | 'not-pending' } {
    const pending = this.pending.get(id)
    if (pending === undefined) return { ok: false, code: 'not-found' }
    if (pending.status !== 'pending') return { ok: false, code: 'not-pending' }
    if (this.now() > pending.expiresAt) { pending.status = 'rejected'; pending.reason = 'expired'; this.emit(); return { ok: false, code: 'expired' } }
    if (this.devices.size >= this.config.maxDevices) return { ok: false, code: 'device-limit' }
    const deviceId = randomBytes(32).toString('base64url')
    pending.status = 'approved'
    pending.deviceId = deviceId
    this.devices.set(deviceId, { createdAt: this.now(), lastSeenAt: this.now() })
    this.emit()
    return { ok: true, deviceId }
  }

  reject(id: string, reason = 'rejected'): boolean {
    const pending = this.pending.get(id)
    if (pending === undefined || pending.status !== 'pending') return false
    pending.status = 'rejected'
    pending.reason = reason
    this.emit()
    return true
  }

  complete(id: string): { status: 'pending' | 'rejected' | 'expired' | 'approved'; deviceId?: string } {
    const pending = this.pending.get(id)
    if (pending === undefined) return { status: 'expired' }
    if (pending.status === 'pending' && this.now() > pending.expiresAt) { pending.status = 'rejected'; pending.reason = 'expired'; this.emit(); return { status: 'expired' } }
    return pending.status === 'approved' ? { status: 'approved', deviceId: pending.deviceId } : { status: pending.status }
  }

  stop(): void {
    this.token = undefined
    this.pending.clear()
    this.devices.clear()
    this.stopped = true
    this.emit()
  }

  touch(deviceId: string): boolean {
    const device = this.devices.get(deviceId)
    if (device === undefined || this.stopped) return false
    device.lastSeenAt = this.now()
    this.emit()
    return true
  }

  hasDevice(deviceId: string): boolean { return this.devices.has(deviceId) && !this.stopped }

  sweep(): void {
    const now = this.now()
    for (const [id, pending] of this.pending) {
      if (pending.status === 'pending' && now > pending.expiresAt) { pending.status = 'rejected'; pending.reason = 'expired' }
      if (pending.status !== 'pending' && now - pending.createdAt > this.config.pendingTtlMs) this.pending.delete(id)
    }
    this.emit()
  }

  snapshot(): PairingSnapshot {
    const now = this.now()
    const onlineCount = [...this.devices.values()].filter(device => now - device.lastSeenAt <= this.config.offlineAfterMs).length
    const pending = [...this.pending.values()].filter(pair => pair.status === 'pending').map(({ deviceId: _deviceId, ...pair }) => pair)
    const hasToken = this.token !== undefined && !this.token.consumed && now <= this.token.expiresAt && !this.stopped
    let phase: PairingSnapshot['phase'] = 'stopped'
    if (this.lanBases.size === 0 && this.publicBase === undefined) phase = 'lan-required'
    else if (pending.length > 0) phase = 'pending'
    else if (onlineCount > 0) phase = 'connected'
    else if (this.devices.size > 0) phase = 'disconnected'
    else if (hasToken) phase = 'waiting'
    return { phase, lanAddresses: [...this.lanBases.keys()], ...(this.publicBase ? { publicUrl: this.publicBase } : {}), ...(hasToken ? { tokenExpiresAt: this.token?.expiresAt } : {}), deviceCount: this.devices.size, onlineCount, pending }
  }

  onChange(listener: (snapshot: PairingSnapshot) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  private emit(): void {
    const snapshot = this.snapshot()
    const serialized = JSON.stringify(snapshot)
    if (serialized === this.lastSnapshot) return
    this.lastSnapshot = serialized
    for (const listener of this.listeners) { try { listener(snapshot) } catch { /* one observer cannot break the state machine */ } }
  }
}
