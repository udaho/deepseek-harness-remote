import type { IncomingMessage } from 'node:http'

export function isIPv4Loopback(value: string | undefined): boolean {
  if (value === undefined) return false
  const parts = value.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

export function isLoopbackAddress(value: string | undefined): boolean {
  if (value === undefined) return false
  const normalized = value.toLowerCase()
  return normalized === '::1' || isIPv4Loopback(normalized) || (normalized.startsWith('::ffff:') && isIPv4Loopback(normalized.slice(7)))
}

export function isLoopbackHostname(value: string | undefined): boolean {
  return value === 'localhost' || value === '::1' || value === '[::1]' || isIPv4Loopback(value)
}

export function requestHostname(request: IncomingMessage): string | undefined {
  const host = request.headers.host
  if (typeof host !== 'string') return undefined
  try { return new URL(`http://${host}`).hostname } catch { return undefined }
}

export function isLoopbackClient(request: IncomingMessage): boolean {
  return isLoopbackAddress(request.socket.remoteAddress) && isLoopbackHostname(requestHostname(request))
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim()
  }
  return undefined
}

export function requestIsHttps(request: IncomingMessage): boolean {
  return request.headers['x-forwarded-proto'] === 'https' || request.headers['forwarded']?.toLowerCase().includes('proto=https') === true
}
