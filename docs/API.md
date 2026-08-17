# Harness Remote API Contract

## Contents

- [Scope](#scope)
- [Transport and authentication](#transport-and-authentication)
  - [Pairing](#pairing)
  - [Mobile RPC](#mobile-rpc)
  - [Live events](#live-events)
- [Allowlisted operations](#allowlisted-operations)
- [Unsupported operations](#unsupported-operations)
- [Related implementation](#related-implementation)

## Scope

[↑ Top](#harness-remote-api-contract)

This document records the narrow wire contract implemented by the private
[@udaho/deepseek-harness-remote](../package.json) plugin for the current
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) rc.6 SDK
surface. The host adapter is implemented in
[`src/host/mobile-api.ts`](../src/host/mobile-api.ts); the browser client uses
[`src/mobile/rpc.ts`](../src/mobile/rpc.ts) and
[`src/mobile/api.ts`](../src/mobile/api.ts).

## Transport and authentication

[↑ Top](#harness-remote-api-contract)

### Pairing

[↑ Top](#harness-remote-api-contract)

- The desktop-only routes under `/harness-remote/pair/*` mint a short-lived,
  one-time token.
- The phone exchanges that token at `POST /harness-remote/pair/accept` and
  receives only a pending challenge at first.
- The desktop operator explicitly approves the challenge. Only then does
  `POST /harness-remote/pair/complete` set the HttpOnly device cookie.
- The device cookie is `Secure` for an HTTPS request and `SameSite=Strict`.
- The pairing state machine and cap are in
  [`src/host/pairing.ts`](../src/host/pairing.ts). The default
  `maxDevices` value is `1`.

### Mobile RPC

[↑ Top](#harness-remote-api-contract)

The phone sends `Content-Type: application/json` to
`POST /harness-remote/api/{method}`:

```json
{
  "rpcId": "phone-42",
  "payload": {}
}
```

Responses use the same correlation id:

```json
{
  "type": "server-response",
  "rpcId": "phone-42",
  "result": { "ok": true, "value": {} }
}
```

Requests require a live device cookie and are rejected unless the request is
made through an advertised LAN or configured public authority. The separate
Harness `/api` bridge is protected by the global gate in
[`src/host/gate.ts`](../src/host/gate.ts); the phone never receives a generic
proxy.

### Live events

[↑ Top](#harness-remote-api-contract)

`GET /harness-remote/api/events.mux` opens an SSE stream. Each data record is
an `events.mux` server-request envelope containing the official Harness mux
frame. The phone validates and folds these frames in
[`src/mobile/mux.ts`](../src/mobile/mux.ts) and
[`src/mobile/messages.ts`](../src/mobile/messages.ts). If SSE fails, the app
falls back to bounded `session.history` polling.

## Allowlisted operations

[↑ Top](#harness-remote-api-contract)

The adapter currently permits only these Harness operations:

- `workspace.list`
- `workspace.archiveSession`
- `session.list`
- `session.create`
- `session.history`
- `session.search`
- `session.prompt`
- `session.models`
- `session.selectModel`
- `session.rename`
- `session.fork`
- `session.cancel`
- `session.attachment`
- `session.respond` (validated approval/question response over
  `apiProxy.respond`)

Prompt content is limited to text parts and raster `image/png`, `image/jpeg`,
`image/webp`, or `image/gif` parts. Body, text, image,
history, and list sizes are bounded in the host adapter. Images are sent as
base64 payloads and history attachment references are fetched through the
explicit attachment method.

## Unsupported operations

[↑ Top](#harness-remote-api-contract)

The rc.6 API exposes no distinct `session.duplicate`, hard-delete, permission
preset, or interrupt method. Duplicate is represented by `session.fork`; the
mobile removal action uses `workspace.archiveSession`; stop uses
`session.cancel`. Push notifications, native background execution, and
restart-surviving pairing are intentionally outside this v1 contract.

## Related implementation

[↑ Top](#harness-remote-api-contract)

- [Plugin entry](../src/index.ts)
- [Desktop pairing routes](../src/host/routes.ts)
- [Mobile app](../src/mobile/index.tsx)
- [Official Harness repository](https://github.com/deepseek-ai/deepseek-harness)
- [Audited reference package](../../ThirdParty/dsh-web-ui/packages/dsh-remote-web-ui)

[↑ Top](#harness-remote-api-contract)
