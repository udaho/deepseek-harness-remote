import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { REMOTE_PREFIX } from './routes.ts'

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/><meta name="theme-color" content="#090b10"/><meta name="mobile-web-app-capable" content="yes"/><title>Harness Remote</title></head><body><div id="root"></div><script src="${REMOTE_PREFIX}/mobile.js"></script></body></html>`

function send(res: ServerResponse, type: string, value: string): void {
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(value)
}

export function makeMobileRoutes(mobileScript: () => string | undefined): WebRoute[] {
  const page = (_req: IncomingMessage, res: ServerResponse): void => send(res, 'text/html; charset=utf-8', HTML)
  const script = (_req: IncomingMessage, res: ServerResponse): void => {
    const value = mobileScript()
    if (value === undefined) { res.writeHead(503); res.end('mobile bundle not built'); return }
    send(res, 'application/javascript; charset=utf-8', value)
  }
  return [
    { kind: 'exact', path: REMOTE_PREFIX, handler: page },
    { kind: 'exact', path: `${REMOTE_PREFIX}/`, handler: page },
    { kind: 'exact', path: `${REMOTE_PREFIX}/mobile.js`, handler: script },
  ]
}
