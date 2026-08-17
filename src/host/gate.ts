import type { IncomingMessage } from 'node:http'
import type { PairingService } from './pairing.ts'
import { isLoopbackClient, readCookie } from './loopback.ts'

/** Cordis waterfall listener for the Harness connection plugin's `/api` seam. */
export function makeApiGate(service: PairingService): (request: IncomingMessage, method: string | undefined, next: () => boolean | Promise<boolean>) => boolean | Promise<boolean> {
  return (request, _method, next) => {
    if (isLoopbackClient(request)) return next()
    const deviceId = readCookie(request.headers.cookie, service.config.cookieName)
    return deviceId !== undefined && service.touch(deviceId) ? next() : false
  }
}
