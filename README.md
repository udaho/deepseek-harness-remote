# DeepSeek Harness Remote

## Contents

- [Purpose](#purpose)
- [Status](#status)
- [Install and run](#install-and-run)
- [Security model](#security-model)
- [Project layout](#project-layout)
- [Related source](#related-source)

## Purpose

[↑ Top](#deepseek-harness-remote)

This private plugin adds a focused phone remote to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): secure pairing, a dark-first mobile chat surface, session controls, image attachments, live updates with polling fallback, and an optional public Cloudflare Quick Tunnel.

## Status

[↑ Top](#deepseek-harness-remote)

Implementation is in progress. The external [implementation plan](../plans/harness-remote/PLAN.md) is the phase tracker; timestamped reports live beside it.

## Install and run

[↑ Top](#deepseek-harness-remote)

Run Harness using the supported command:

```powershell
npx @deepseek-ai/dsh web --port 3190
```

Build this package, then add the local package to the web profile. The
repository pins pnpm `11.19.0`; install it once with npm if `pnpm` is not
already available:

```powershell
npm install --global pnpm@11.19.0
pnpm --version
pnpm install
pnpm build
npx @deepseek-ai/dsh plugin --profile web add link:C:\HenryProjects\ML\deepseek\harness-remote
npx @deepseek-ai/dsh web --port 3190
```

If global npm installation is unavailable, run the package-manager commands
through `npx` instead:

```powershell
npx --yes pnpm@11.19.0 install
npx --yes pnpm@11.19.0 build
```

The current Harness CLI intentionally rejects `--host 0.0.0.0` for safety.
Use the loopback command above; the desktop Remote panel starts the optional
public tunnel only after explicit confirmation.

The normal `npx @deepseek-ai/dsh web --port 3190` command keeps the tunnel off
until you click `Remote` in the desktop sidebar and confirm `Create tunnel &
show QR`. The popup reports tunnel status, shows the QR/link only after that
confirmation, and displays the pairing-link expiry. The public tunnel remains
active until you stop it or Harness exits.

The plugin is private and is intended to be linked locally. Its main settings
are `maxDevices` (default `1`), `publicBaseUrl` (an explicit HTTPS origin),
and `autoTunnel` (a legacy compatibility setting; tunnel creation is now
always user-triggered from the desktop panel). The package keeps the tunnel
off until explicitly requested.

The package metadata and Harness patch entry are in
[`package.json`](package.json) and [`cordis.patch.yml`](cordis.patch.yml).

## Security model

[↑ Top](#deepseek-harness-remote)

- QR pairing uses a short-lived one-time secret and explicit desktop approval before the phone receives its device cookie.
- The default device cap is one and is configurable through the plugin schema.
- All non-loopback Harness `/api` traffic is denied unless it presents a live paired-device cookie; loopback retains normal local access.
- The phone reaches only the plugin-owned mobile API allowlist; it cannot call settings, credentials, arbitrary host actions, or a generic RPC dispatcher.
- Pairing is intentionally in-memory in v1, so a Harness restart revokes devices. Durable restart-surviving pairing is a secure v2 concern.

## Project layout

[↑ Top](#deepseek-harness-remote)

- [Host plugin](src/index.ts): Cordis integration, configuration, routes, and gate.
- [Pairing state](src/host/pairing.ts): testable token/device/challenge state machine.
- [Mobile API](src/host/mobile-api.ts): authenticated allowlisted Harness adapter.
- [Desktop face](src/client/index.ts): sidebar trigger and approval panel.
- [Mobile app](src/mobile/index.tsx): standalone phone bundle.
- [External plan](../plans/harness-remote/PLAN.md): decisions and checked phase work.

## Related source

[↑ Top](#deepseek-harness-remote)

- Authoritative Harness repository: [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness).
- Behavioral reference: [local dsh-web-ui package](../ThirdParty/dsh-web-ui/packages/dsh-remote-web-ui).
- Reference upstream repository: [zhu1090093659/dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui).

[↑ Top](#deepseek-harness-remote)
