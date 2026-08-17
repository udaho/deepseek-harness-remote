import { networkInterfaces } from 'node:os'

export function lanIPv4Addresses(): string[] {
  return Object.values(networkInterfaces()).flat().filter((value): value is NonNullable<typeof value> => value !== undefined && value.family === 'IPv4' && !value.internal).map(value => value.address)
}
