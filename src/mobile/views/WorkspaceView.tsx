import { useEffect, useState } from 'react'
import type { WorkspaceView as Workspace } from '@deepseek-ai/dsh-host-apiproxy/api/workspace'
import { workspaces } from '../api.ts'

export function WorkspaceView({ onOpen }: { onOpen: (id: string) => void }): JSX.Element {
  const [items, setItems] = useState<Workspace[]>([])
  const [error, setError] = useState<string>()
  useEffect(() => { void workspaces().then(value => setItems(value.items)).catch(value => setError(value instanceof Error ? value.message : String(value))) }, [])
  return <section><div className="toolbar" style={{ marginBottom: 14 }}><div><h1 style={{ margin: 0 }}>Workspaces</h1><p className="subtle">Choose where you want to work.</p></div></div>{error && <p className="error">{error}</p>}{items.length === 0 && !error && <div className="card subtle">No workspaces are registered in Harness yet.</div>}<div className="list">{items.map(item => <button key={String(item.workspaceId)} onClick={() => onOpen(String(item.workspaceId))}><div className="eyebrow">WORKSPACE</div><div className="title">{item.title}</div><div className="subtle">{item.sessionIds.length} sessions · {item.path}</div></button>)}</div></section>
}
