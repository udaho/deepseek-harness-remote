import { useCallback, useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { issuePair, pairAction, startTunnel, stopPair, type PairState } from './pair-api.ts'

const INITIAL_STATE: PairState = { phase: 'stopped', deviceCount: 0, onlineCount: 0, pending: [], tunnel: { state: 'stopped' } }

function tunnelLabel(state: PairState['tunnel']['state']): string {
  if (state === 'starting') return 'Starting'
  if (state === 'running') return 'Running'
  if (state === 'failed') return 'Failed'
  return 'Off'
}

function remaining(expiresAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

export function RemoteEntry({ wide }: { wide: boolean }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [url, setUrl] = useState<string | undefined>()
  const [state, setState] = useState<PairState>(INITIAL_STATE)
  const [error, setError] = useState<string | undefined>()
  const [now, setNow] = useState(() => Date.now())
  const source = useRef<EventSource | undefined>()
  const issuing = useRef(false)

  const refresh = useCallback(async (): Promise<void> => {
    const result = await issuePair()
    if (!result.ok) { setError(result.code); return }
    setError(undefined)
    setUrl(result.url)
    setState(previous => ({ ...previous, phase: 'waiting', tokenExpiresAt: result.expiresAt, publicUrl: result.publicBaseUrl }))
  }, [])

  const connectEvents = useCallback((): void => {
    if (source.current !== undefined) return
    const events = new EventSource('/harness-remote/pair/events')
    source.current = events
    events.onmessage = event => {
      try { const frame = JSON.parse(event.data) as { type?: string } & PairState; if (frame.type === 'state') setState(frame) } catch { /* ignore malformed status */ }
    }
    events.onerror = () => { /* the browser will retry the loopback stream */ }
  }, [])

  const openPanel = useCallback(() => {
    setOpen(true)
    connectEvents()
  }, [connectEvents])

  const confirmStart = useCallback(async (): Promise<void> => {
    setConfirmed(true)
    setUrl(undefined)
    setError(undefined)
    const result = await startTunnel()
    if (!result.ok) { setConfirmed(false); setError(result.code); return }
    setState(previous => ({ ...previous, tunnel: result.tunnel }))
  }, [])

  const stop = useCallback(async (): Promise<void> => {
    await stopPair()
    setConfirmed(false)
    setUrl(undefined)
    setError(undefined)
  }, [])

  useEffect(() => {
    if (!confirmed || url !== undefined || issuing.current) return
    if (state.tunnel.state !== 'running' && state.publicUrl === undefined) return
    issuing.current = true
    void refresh().finally(() => { issuing.current = false })
  }, [confirmed, refresh, state.publicUrl, state.tunnel.state, url])

  useEffect(() => {
    if (!open || state.tokenExpiresAt === undefined) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [open, state.tokenExpiresAt])

  useEffect(() => () => source.current?.close(), [])

  if (!open) return <button type="button" title="Harness Remote" aria-label="Harness Remote" onClick={openPanel} style={styles.trigger}>{wide ? '⌁ Remote' : '⌁'}</button>
  return <>
    <button type="button" title="Harness Remote" aria-label="Harness Remote" onClick={() => setOpen(false)} style={styles.trigger}>{wide ? '⌁ Remote' : '⌁'}</button>
    <div style={styles.backdrop} role="presentation">
      <div style={styles.card} role="dialog" aria-modal="true" aria-label="Harness Remote pairing">
        <div style={styles.header}><div><div style={styles.eyebrow}>HARNESS REMOTE</div><h2 style={styles.title}>Phone remote</h2></div><button type="button" onClick={() => setOpen(false)} style={styles.close}>×</button></div>
        <div style={styles.tunnelStatus}><span>Quick Tunnel</span><strong>{tunnelLabel(state.tunnel.state)}</strong>{state.tunnel.error && <span style={styles.errorText}>{state.tunnel.error}</span>}</div>
        {!confirmed && <div style={styles.warning}><strong>{state.tunnel.state === 'running' ? 'Tunnel is ready.' : 'Private until you confirm.'}</strong><span>{state.tunnel.state === 'running' ? 'The public tunnel is active, but the QR/link stays hidden until you explicitly reveal a pairing link.' : 'Harness will not create a public tunnel or show a phone link just by opening this panel.'}</span><button type="button" onClick={() => void confirmStart()} style={styles.primary}>{state.tunnel.state === 'running' ? 'Show QR for running tunnel' : 'Create tunnel &amp; show QR'}</button></div>}
        {error ? <p style={styles.error}>Remote pairing is unavailable: {error}</p> : confirmed && url ? <div style={styles.qr}><QRCodeSVG value={url} size={240} bgColor="#ffffff" fgColor="#090b10" level="M"/><code style={styles.url}>{url}</code></div> : confirmed ? <p style={styles.muted}>Creating a secure public link… The QR code will appear when the tunnel is ready.</p> : <p style={styles.muted}>Open the tunnel only when you are ready to connect your phone.</p>}
        {confirmed && url && state.tokenExpiresAt !== undefined && <p style={styles.expiry}>Pairing link expires at <strong>{new Date(state.tokenExpiresAt).toLocaleTimeString()}</strong> ({remaining(state.tokenExpiresAt, now)}). The public tunnel remains active until you stop it or Harness exits.</p>}
        <p style={styles.muted}>Scan the QR code, then approve the phone below. Pairing still requires explicit desktop approval.</p>
        {state.pending.length > 0 && <div style={styles.pending}><strong>Approval requested</strong>{state.pending.map(pair => <div key={pair.id} style={styles.pendingRow}><div><span style={styles.code}>{pair.code}</span><div style={styles.muted}>{pair.userAgent ?? 'Unknown device'}{pair.address ? ` · ${pair.address}` : ''}</div></div><div><button type="button" onClick={() => void pairAction('approve', pair.id)} style={styles.approve}>Approve</button><button type="button" onClick={() => void pairAction('reject', pair.id)} style={styles.reject}>Reject</button></div></div>)}</div>}
        <div style={styles.status}>Status: <strong>{state.phase}</strong> · {state.onlineCount}/{state.deviceCount} online</div>
        <div style={styles.actions}>{confirmed && <button type="button" onClick={() => void refresh()} style={styles.secondary}>Refresh QR</button>} {(confirmed || state.tunnel.state === 'running') && <button type="button" onClick={() => void stop()} style={styles.danger}>Stop tunnel &amp; revoke</button>}</div>
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
  errorText: { color: '#ffb2b2', fontSize: 12, overflowWrap: 'anywhere' },
  warning: { display: 'grid', gap: 10, margin: '4px 0 16px', padding: 14, color: '#dce5f6', background: '#1b2535', border: '1px solid #334461', borderRadius: 12, fontSize: 13, lineHeight: 1.45 },
  primary: { border: 0, borderRadius: 9, padding: '10px 13px', background: '#8fa8ff', color: '#101728', cursor: 'pointer', fontWeight: 700 },
  tunnelStatus: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, color: '#bfc9da', fontSize: 13 },
  expiry: { margin: '14px 0', padding: 10, color: '#c8d4ee', background: '#182238', borderRadius: 9, fontSize: 12, lineHeight: 1.5 },
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
