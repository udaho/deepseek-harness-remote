import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { RemoteEntry } from './RemoteEntry.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'sidebar.footer.action': { kind: 'list'; scope: 'root'; owner: { wide: boolean } }
  }
}

export const inject = ['slots', 'locale']

function FooterEntry(props: { wide: boolean }): JSX.Element { return createElement(RemoteEntry, { wide: props.wide }) }

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'harness-remote' }, FooterEntry))
}

/** Explicitly exported for unit tests and embedders that mount the face manually. */
export function mountStandalone(element: HTMLElement): () => void {
  const root = createRoot(element)
  root.render(createElement(RemoteEntry, { wide: true }))
  return () => root.unmount()
}

export type FooterSlotProps = PropsRenderSlots<'sidebar.footer.action'>
