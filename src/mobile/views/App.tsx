import { useEffect, useMemo, useState } from 'react'
import { RpcError } from '../rpc.ts'
import { workspaces } from '../api.ts'
import { ChatView } from './ChatView.tsx'
import { SessionListView } from './SessionListView.tsx'
import { WorkspaceView } from './WorkspaceView.tsx'

type Stage = 'pairing' | 'loading' | 'workspaces' | 'sessions' | 'chat' | 'error'

export function App(): JSX.Element {
  const query = useMemo(() => new URLSearchParams(location.search), [])
  const [stage, setStage] = useState<Stage>('loading')
  const [pairCode, setPairCode] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [workspaceId, setWorkspaceId] = useState<string | undefined>(query.get('workspace') ?? undefined)
  const [sessionId, setSessionId] = useState<string | undefined>()

  useEffect(() => {
    let disposed = false
    let pairPoll: number | undefined
    const boot = async (): Promise<void> => {
      const token = query.get('pair')
      if (token) {
        try {
          const response = await fetch('/harness-remote/pair/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })
          const result = await response.json() as { ok?: boolean; code?: string }
          if (!result.ok) throw new Error(result.code ?? 'pairing failed')
          const status = await fetch('/harness-remote/pair/status').then(value => value.json()) as { pending?: Array<{ code: string }> }
          if (!disposed) { setPairCode(status.pending?.[0]?.code); setStage('pairing') }
          pairPoll = window.setInterval(() => {
            void fetch('/harness-remote/pair/complete').then(value => value.json()).then((completed: { ok?: boolean; status?: string }) => {
              if (completed.status === 'approved') { if (pairPoll !== undefined) window.clearInterval(pairPoll); pairPoll = undefined; history.replaceState({}, '', `${location.pathname}${workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : ''}`); if (!disposed) { setStage('workspaces'); void loadWorkspace() } }
              else if (completed.status === 'expired' || completed.status === 'rejected') { if (pairPoll !== undefined) window.clearInterval(pairPoll); pairPoll = undefined; if (!disposed) { setError('Pairing was not approved. Scan a fresh QR code.'); setStage('error') } }
            }).catch(() => {})
          }, 1200)
        } catch (value) { if (!disposed) { setError(value instanceof Error ? value.message : String(value)); setStage('error') } }
        return
      }
      await loadWorkspace()
    }
    const loadWorkspace = async (): Promise<void> => {
      try { await workspaces(); if (!disposed) setStage(workspaceId ? 'sessions' : 'workspaces') } catch (value) { if (!disposed) { const message = value instanceof RpcError && value.code === 'unpaired' ? 'This phone is not paired.' : value instanceof Error ? value.message : String(value); setError(message); setStage(value instanceof RpcError && value.code === 'unpaired' ? 'error' : 'error') } }
    }
    void boot()
    return () => { disposed = true; if (pairPoll !== undefined) window.clearInterval(pairPoll) }
  }, [query, workspaceId])

  useEffect(() => {
    if (stage !== 'workspaces' && stage !== 'sessions' && stage !== 'chat') return
    const heartbeat = (): void => { void fetch('/harness-remote/pair/heartbeat', { method: 'POST' }).catch(() => {}) }
    heartbeat()
    const timer = window.setInterval(heartbeat, 10_000)
    return () => window.clearInterval(timer)
  }, [stage])

  const openWorkspace = (id: string): void => { setWorkspaceId(id); setStage('sessions') }
  const openSession = (id: string): void => { setSessionId(id); setStage('chat') }
  if (stage === 'pairing') return <Shell><div className="card"><div className="eyebrow">SECURE PAIRING</div><h1>Waiting for approval</h1><p className="subtle">Confirm this phone on the Harness desktop.</p>{pairCode && <div style={{ fontSize: 34, letterSpacing: 8, fontWeight: 800, margin: '24px 0' }}>{pairCode}</div>}<div className="notice">This request expires automatically if it is not approved.</div></div></Shell>
  if (stage === 'error') return <Shell><div className="card"><div className="eyebrow">HARNESS REMOTE</div><h1>Connection unavailable</h1><p className="error">{error}</p><p className="subtle">Open a fresh pairing QR from the Harness desktop. Existing revoked or expired links cannot be reused.</p></div></Shell>
  if (stage === 'loading') return <Shell><div className="card"><p className="subtle">Connecting to Harness…</p></div></Shell>
  if (stage === 'workspaces') return <Shell><WorkspaceView onOpen={openWorkspace} /></Shell>
  if (stage === 'sessions' && workspaceId) return <Shell><SessionListView workspaceId={workspaceId} onBack={() => setStage('workspaces')} onOpen={openSession} /></Shell>
  if (stage === 'chat' && sessionId) return <Shell><ChatView sessionId={sessionId} onBack={() => { setSessionId(undefined); setStage(workspaceId ? 'sessions' : 'workspaces') }} onOpenSession={openSession} /></Shell>
  return <Shell><WorkspaceView onOpen={openWorkspace} /></Shell>
}

function Shell({ children }: { children: React.ReactNode }): JSX.Element { return <main className="app"><header className="topbar"><div><div className="eyebrow">DEEPSEEK HARNESS</div><div className="brand">Remote workspace</div></div><div className="subtle">v1</div></header>{children}</main> }
