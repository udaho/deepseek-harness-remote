import { useCallback, useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { issuePair, pairAction, stopPair, type PairState } from './pair-api.ts'

export function RemoteEntry({ wide }: { wide: boolean }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState<string | undefined>()
  const [state, setState] = useState<PairState>({ phase: 'stopped', deviceCount: 0, onlineCount: 0, pending: [] })
  const [error, setError] = useState<string | undefined>()
  const source = useRef<EventSource | undefined>()

  const refresh = useCallback(async (): Promise<void> => {
    const result = await issuePair()
    if (!result.ok) { setError(result.code); return }
    setError(undefined)
    setUrl(result.url)
    setState(previous => ({ ...previous, phase: 'waiting', tokenExpiresAt: result.expiresAt, publicUrl: result.publicBaseUrl }))
  }, [])

  const openPanel = useCallback(() => {
    setOpen(true)
    void refresh()
    const events = new EventSource('/harness-remote/pair/events')
    source.current = events
    events.onmessage = event => {
      try { const frame = JSON.parse(event.data) as { type?: string } & PairState; if (frame.type === 'state') setState(frame) } catch { /* ignore malformed status */ }
    }
  }, [refresh])

  useEffect(() => () => source.current?.close(), [])

  if (!open) return <button type="button" title="Harness Remote" aria-label="Harness Remote" onClick={openPanel} style={styles.trigger}>{wide ? '⌁ Remote' : '⌁'}</button>
  return <>
    <button type="button" title="Harness Remote" aria-label="Harness Remote" onClick={() => setOpen(false)} style={styles.trigger}>{wide ? '⌁ Remote' : '⌁'}</button>
    <div style={styles.backdrop} role="presentation">
      <div style={styles.card} role="dialog" aria-modal="true" aria-label="Harness Remote pairing">
        <div style={styles.header}><div><div style={styles.eyebrow}>HARNESS REMOTE</div><h2 style={styles.title}>Pair your phone</h2></div><button type="button" onClick={() => setOpen(false)} style={styles.close}>×</button></div>
        {error ? <p style={styles.error}>Pairing is unavailable: {error}</p> : url ? <div style={styles.qr}><QRCodeSVG value={url} size={240} bgColor="#ffffff" fgColor="#090b10" level="M"/><code style={styles.url}>{url}</code></div> : <p style={styles.muted}>Preparing a one-time link…</p>}
        <p style={styles.muted}>Scan the QR code, then approve the phone below. The link expires automatically.</p>
        {state.pending.length > 0 && <div style={styles.pending}><strong>Approval requested</strong>{state.pending.map(pair => <div key={pair.id} style={styles.pendingRow}><div><span style={styles.code}>{pair.code}</span><div style={styles.muted}>{pair.userAgent ?? 'Unknown device'}{pair.address ? ` · ${pair.address}` : ''}</div></div><div><button type="button" onClick={() => void pairAction('approve', pair.id)} style={styles.approve}>Approve</button><button type="button" onClick={() => void pairAction('reject', pair.id)} style={styles.reject}>Reject</button></div></div>)}</div>}
        <div style={styles.status}>Status: <strong>{state.phase}</strong> · {state.onlineCount}/{state.deviceCount} online</div>
        <div style={styles.actions}><button type="button" onClick={() => void refresh()} style={styles.secondary}>Refresh QR</button><button type="button" onClick={() => void stopPair()} style={styles.danger}>Stop and revoke</button></div>
      </div>
    </div>
  </>
}

const styles: Record<string, React.CSSProperties> = {
  trigger: { border: 0, background: 'transparent', color: 'inherit', padding: '8px 10px', cursor: 'pointer', borderRadius: 8 },
  backdrop: { position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,.62)', display: 'grid', placeItems: 'center', padding: 20 },
  card: { width: 'min(460px, 100%)', maxHeight: '90vh', overflow: 'auto', background: '#11151d', color: '#e8edf7', border: '1px solid #2c3545', borderRadius: 20, padding: 24, boxShadow: '0 28px 90px rgba(0,0,0,.5)', fontFamily: 'system-ui, sans-serif' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  eyebrow: { color: '#8fa8ff', fontSize: 11, letterSpacing: 2, fontWeight: 700 },
  title: { margin: '6px 0 16px', fontSize: 24 },
  close: { border: 0, background: 'transparent', color: '#9da8ba', fontSize: 28, cursor: 'pointer' },
  qr: { display: 'grid', gap: 12, justifyItems: 'center', background: '#fff', padding: 14, borderRadius: 14 },
  url: { maxWidth: '100%', overflowWrap: 'anywhere', color: '#273041', fontSize: 11 },
  muted: { color: '#9da8ba', fontSize: 13, lineHeight: 1.5 },
  error: { color: '#ff9d9d', background: '#351d25', padding: 12, borderRadius: 10 },
  pending: { marginTop: 16, background: '#1a2230', borderRadius: 12, padding: 14 },
  pendingRow: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', paddingTop: 12, marginTop: 12, borderTop: '1px solid #2c3545' },
  code: { color: '#b9c8ff', fontWeight: 800, letterSpacing: 3 },
  approve: { border: 0, borderRadius: 8, padding: '8px 10px', background: '#76e0b5', color: '#10241b', cursor: 'pointer', marginRight: 6 },
  reject: { border: 0, borderRadius: 8, padding: '8px 10px', background: '#43252d', color: '#ffb2b2', cursor: 'pointer' },
  status: { marginTop: 18, fontSize: 13, color: '#bdc7d8' },
  actions: { display: 'flex', gap: 8, marginTop: 18 },
  secondary: { border: '1px solid #354258', borderRadius: 9, padding: '9px 12px', background: '#1a2230', color: '#e8edf7', cursor: 'pointer' },
  danger: { border: '1px solid #6b3540', borderRadius: 9, padding: '9px 12px', background: '#351d25', color: '#ffb2b2', cursor: 'pointer' },
}
