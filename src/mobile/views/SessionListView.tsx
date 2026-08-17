import { useEffect, useMemo, useState } from 'react'
import type { SessionSummary } from '@deepseek-ai/dsh-host-apiproxy/api/sessions'
import { createSession, searchSessions, sessions, workspaces } from '../api.ts'

export function SessionListView({ workspaceId, onBack, onOpen }: { workspaceId: string; onBack: () => void; onOpen: (id: string) => void }): JSX.Element {
  const [all, setAll] = useState<SessionSummary[]>([])
  const [workspaceSessionIds, setWorkspaceSessionIds] = useState<string[]>([])
  const [cursor, setCursor] = useState<string>()
  const [hasMore, setHasMore] = useState(false)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<Array<{ sessionId: string; snippet: string }>>([])
  const [error, setError] = useState<string>()
  const load = async (next?: string): Promise<void> => { try { const [page, registry] = await Promise.all([sessions(next), workspaces()]); const rows = next ? [...all, ...page.items] : page.items; setAll(rows); setCursor(page.nextCursor); setHasMore(page.hasMore); setWorkspaceSessionIds(registry.items.find(item => String(item.workspaceId) === workspaceId)?.sessionIds.map(String) ?? []) } catch (value) { setError(value instanceof Error ? value.message : String(value)) } }
  useEffect(() => { void load() }, [])
  const visible = useMemo(() => all.filter(item => workspaceSessionIds.includes(String(item.sessionId)) && !item.blank), [all, workspaceSessionIds])
  const newSession = async (): Promise<void> => { try { const result = await createSession(workspaceId); onOpen(result.sessionId) } catch (value) { setError(value instanceof Error ? value.message : String(value)) } }
  const runSearch = async (): Promise<void> => { if (!query.trim()) { setSearch([]); return } try { setSearch((await searchSessions(query.trim())).items) } catch (value) { setError(value instanceof Error ? value.message : String(value)) } }
  return <section><div className="toolbar"><button className="icon" onClick={onBack}>←</button><div><h1 style={{ margin: 0 }}>Sessions</h1><p className="subtle">Your active conversations.</p></div><button className="primary" onClick={() => void newSession()}>New</button></div><div style={{ display: 'flex', gap: 8, margin: '14px 0' }}><input className="field" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void runSearch() }} placeholder="Search all sessions"/><button className="icon" onClick={() => void runSearch()}>⌕</button></div>{error && <p className="error">{error}</p>}{search.length > 0 && <div className="card" style={{ marginBottom: 12 }}><div className="eyebrow">SEARCH RESULTS</div>{search.map(item => <button className="rowbutton" key={item.sessionId} onClick={() => onOpen(String(item.sessionId))}><div className="title">{item.sessionId}</div><div className="subtle">{item.snippet}</div></button>)}</div>}<div className="list">{visible.map(item => <button key={String(item.sessionId)} onClick={() => onOpen(String(item.sessionId))}><div className="title">{String(item.sessionId).slice(0, 80)}</div><div className="subtle">{item.running ? 'Running' : 'Idle'} · {new Date(item.updatedAt).toLocaleString()}</div></button>)}</div>{visible.length === 0 && !error && <div className="card subtle">No completed sessions here yet. Start a new one to begin.</div>}{hasMore && <button className="rowbutton" style={{ marginTop: 12 }} onClick={() => void load(cursor)}>Load more</button>}</section>
}
