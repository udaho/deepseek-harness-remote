import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { MuxFrame } from '@deepseek-ai/dsh-host-apiproxy/api/events'
import { attachment, archive, cancel, fork, history, models, prompt, rename, selectModel } from '../api.ts'
import { MuxClient } from '../mux.ts'
import { fold, type RenderMessage } from '../messages.ts'
import { respond } from '../rpc.ts'

type ImagePart = { type: 'image'; mediaType: string; data: string; name?: string }
type QuestionState = { rpcId: string; questions: Array<{ id: string; question: string; detail?: string; options?: Array<{ label: string; description?: string }>; multiSelect?: boolean }> }
type PermissionState = { currentValue: PermissionMode; options: Array<{ value: PermissionMode; name: string }> }
type PermissionMode = 'read-only' | 'workspace-write' | 'danger-full-access'
const PERMISSION_MODES: PermissionMode[] = ['read-only', 'workspace-write', 'danger-full-access']

export function ChatView({ sessionId, onBack, onOpenSession }: { sessionId: string; onBack: () => void; onOpenSession: (id: string) => void }): JSX.Element {
  const [messages, setMessages] = useState<RenderMessage[]>([])
  const [text, setText] = useState('')
  const [images, setImages] = useState<ImagePart[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [approval, setApproval] = useState<{ rpcId: string; approvalId: string; toolName: string; reason?: string }>()
  const [question, setQuestion] = useState<QuestionState>()
  const [permission, setPermission] = useState<PermissionState>()
  const [permissionSheet, setPermissionSheet] = useState(false)
  const [modelSheet, setModelSheet] = useState<Awaited<ReturnType<typeof models>>>()
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState('')
  const mux = useMemo(() => new MuxClient(), [])
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    void history(sessionId, undefined, 60).then(page => { if (alive) { setMessages(fold([], page.events.map(entry => entry.event as unknown as Parameters<typeof fold>[1][number]))); setPermission(readPermissionProjection(page.projections)); setLoading(false) } }).catch(value => { if (alive) { setError(value instanceof Error ? value.message : String(value)); setLoading(false) } })
    const off = mux.onFrame((rpcId, frame: MuxFrame) => {
      if (frame.type === 'session/event' && String(frame.sessionId) === sessionId) setMessages(previous => fold(previous, [frame.event as unknown as Parameters<typeof fold>[1][number]]))
      else if (frame.type === 'approval/requested' && String(frame.sessionId) === sessionId) setApproval({ rpcId, approvalId: String(frame.approvalId), toolName: frame.toolName, reason: frame.reason })
      else if (frame.type === 'question/requested' && String(frame.sessionId) === sessionId) setQuestion({ rpcId, questions: frame.questions })
      else if (frame.type === 'approval/resolved' && String(frame.sessionId) === sessionId) setApproval(undefined)
      else if (frame.type === 'question/resolved' && String(frame.sessionId) === sessionId) setQuestion(undefined)
      else if (frame.type === 'session/projection' && String(frame.sessionId) === sessionId && frame.key === 'permissions') setPermission(parsePermission(frame.value))
    })
    mux.observe(sessionId); mux.start()
    return () => { alive = false; off(); mux.stop() }
  }, [mux, sessionId])

  const send = async (): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed && images.length === 0) return
    setError(undefined)
    try { await prompt(sessionId, [...(trimmed ? [{ type: 'text' as const, text: trimmed }] : []), ...images]); setText(''); setImages([]) } catch (value) { setError(value instanceof Error ? value.message : String(value)) }
  }
  const chooseFiles = async (files: FileList | null): Promise<void> => {
    if (!files) return
    try {
      const next: ImagePart[] = []
      for (const file of Array.from(files).slice(0, 4)) { if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) continue; const dataUrl = await readFile(file); const divider = dataUrl.indexOf(','); next.push({ type: 'image', mediaType: file.type, data: divider >= 0 ? dataUrl.slice(divider + 1) : dataUrl, name: file.name }) }
      setImages(previous => [...previous, ...next].slice(0, 4))
    } catch (value) { setError(value instanceof Error ? value.message : String(value)) }
  }
  const doFork = async (): Promise<void> => { try { const result = await fork(sessionId); onOpenSession(result.sessionId) } catch (value) { setError(value instanceof Error ? value.message : String(value)) } }
  const doCancel = async (): Promise<void> => { try { await cancel(sessionId) } catch (value) { setError(value instanceof Error ? value.message : String(value)) } }
  const doArchive = async (): Promise<void> => { if (!window.confirm('Archive this session? Its log remains on the host.')) return; try { await archive(sessionId); onBack() } catch (value) { setError(value instanceof Error ? value.message : String(value)) } }
  const doRename = async (): Promise<void> => { if (!title.trim()) return; try { await rename(sessionId, title.trim()); setRenaming(false) } catch (value) { setError(value instanceof Error ? value.message : String(value)) } }
  const applyPermission = async (value: PermissionMode): Promise<void> => {
    if (value === 'danger-full-access' && !window.confirm('Enable full access for this Harness session? Tools may modify files or run commands without approval.')) return
    try { await prompt(sessionId, [{ type: 'text', text: `/permission ${value}` }]); setPermission(previous => previous ? { ...previous, currentValue: value } : previous); setPermissionSheet(false) } catch (value) { setError(value instanceof Error ? value.message : String(value)) }
  }
  const answerQuestion = async (answers: Array<{ id: string; selected: string[] }>): Promise<void> => { if (!question) return; try { await respond(question.rpcId, { sessionId, answer: { answers } }); setQuestion(undefined) } catch (value) { setError(value instanceof Error ? value.message : String(value)) } }

  return <section><div className="toolbar"><button className="icon" onClick={onBack}>←</button><div style={{ minWidth: 0, flex: 1 }}><div className="eyebrow">SESSION</div><div className="title" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{sessionId}</div></div><button className="icon" onClick={() => { setTitle(''); setRenaming(true) }}>✎</button><button className="icon" onClick={() => void models(sessionId).then(setModelSheet).catch(value => setError(value instanceof Error ? value.message : String(value)))}>◈</button>{permission && <button className="icon" onClick={() => setPermissionSheet(true)} aria-label="Permission mode">⚿ {permission.options.find(option => option.value === permission.currentValue)?.name ?? permission.currentValue}</button>}<button className="icon" onClick={() => void doFork()}>⧉</button><button className="icon" onClick={() => void doCancel()} aria-label="Stop session">■</button><button className="danger" onClick={() => void doArchive()}>Archive</button></div>{error && <p className="error">{error}</p>}{approval && <div className="notice"><strong>Permission requested: {approval.toolName}</strong><div className="subtle">{approval.reason ?? 'Harness is waiting for confirmation.'}</div><div className="toolbar" style={{ marginTop: 10 }}><button className="primary" onClick={() => void respond(approval.rpcId, { sessionId, approvalId: approval.approvalId, outcome: 'allowed-once' }).then(() => setApproval(undefined)).catch(value => setError(value instanceof Error ? value.message : String(value)))}>Allow once</button><button className="danger" onClick={() => void respond(approval.rpcId, { sessionId, approvalId: approval.approvalId, outcome: 'rejected' }).then(() => setApproval(undefined)).catch(value => setError(value instanceof Error ? value.message : String(value)))}>Reject</button></div></div>}{question && <QuestionPanel question={question} onSubmit={answerQuestion} />}{loading ? <div className="card subtle">Loading conversation…</div> : <div className="messages">{messages.map(message => <MessageView key={message.id} message={message} sessionId={sessionId} />)}{messages.length === 0 && <div className="card subtle">No messages yet. Send a prompt to start this session.</div>}</div>}<div className="composer"><div className="composebox"><button className="icon" onClick={() => fileInput.current?.click()} aria-label="Attach images">＋</button><textarea value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} placeholder="Message Harness…"/><button className="primary" onClick={() => void send()}>Send</button></div>{images.length > 0 && <div className="attachment">{images.length} image{images.length === 1 ? '' : 's'} attached · <button className="icon" onClick={() => setImages([])}>clear</button></div>}<input ref={fileInput} hidden type="file" accept="image/*" multiple onChange={event => void chooseFiles(event.target.files)} /></div>{permissionSheet && permission && <PermissionSheet value={permission} onClose={() => setPermissionSheet(false)} onSelect={value => void applyPermission(value)} />}{modelSheet && <ModelSheet value={modelSheet} sessionId={sessionId} onClose={() => setModelSheet(undefined)} onSelect={(provider, model, effort) => void selectModel(sessionId, provider, model, effort).then(() => setModelSheet(undefined)).catch(value => setError(value instanceof Error ? value.message : String(value)))} />}{renaming && <div className="sheet"><div><h2>Rename session</h2><input className="field" value={title} onChange={event => setTitle(event.target.value)} autoFocus/><div className="toolbar" style={{ marginTop: 12 }}><button className="primary" onClick={() => void doRename()}>Save</button><button className="icon" onClick={() => setRenaming(false)}>Cancel</button></div></div></div>}</section>
}

function MessageView({ message, sessionId }: { message: RenderMessage; sessionId: string }): JSX.Element { return <div className={`bubble ${message.kind}`}><div className="eyebrow">{message.kind === 'user' ? 'YOU' : 'HARNESS'}{message.pending ? ' · STREAMING' : ''}{message.failed ? ' · FAILED' : ''}</div>{message.reasoning && <details className="reasoning"><summary>Reasoning</summary>{message.reasoning}</details>}{message.kind === 'assistant' ? <SafeMarkdown value={message.text || (message.pending ? '…' : '')} /> : <div>{message.text || (message.pending ? '…' : '')}</div>}{message.images?.map(id => <AttachmentImage key={id} sessionId={sessionId} attachmentId={id} />)}{message.tools.map(tool => <details className="tool" key={tool.id}><summary>{tool.name}</summary><pre>{tool.arguments}</pre></details>)}</div> }

function SafeMarkdown({ value }: { value: string }): JSX.Element {
  const lines = value.split(/\r?\n/)
  const nodes: JSX.Element[] = []
  let code = false
  let codeLines: string[] = []
  const flushCode = (): void => { if (codeLines.length > 0) nodes.push(<pre className="markdown-code" key={`code-${nodes.length}`}><code>{codeLines.join('\n')}</code></pre>); codeLines = [] }
  lines.forEach((line, index) => {
    if (line.trim().startsWith('```')) { if (code) flushCode(); code = !code; return }
    if (code) { codeLines.push(line); return }
    if (line.trim() === '') { nodes.push(<br key={`break-${index}`} />); return }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) { nodes.push(<strong key={`heading-${index}`} style={{ display: 'block', fontSize: heading[1].length === 1 ? 18 : 15, margin: '8px 0 4px' }}>{inlineMarkdown(heading[2])}</strong>); return }
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line)
    nodes.push(<div key={`line-${index}`}>{bullet ? '• ' : ''}{inlineMarkdown(bullet ? bullet[1] : line)}</div>)
  })
  if (code) flushCode()
  return <div>{nodes}</div>
}

function inlineMarkdown(value: string): Array<JSX.Element | string> {
  const parts = value.split(/(\[[^\]]+\]\(https?:\/\/[^\s)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g)
  return parts.filter(part => part.length > 0).map((part, index) => {
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part)
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>
    return part
  })
}

function AttachmentImage({ sessionId, attachmentId }: { sessionId: string; attachmentId: string }): JSX.Element { const [src, setSrc] = useState<string>(); useEffect(() => { let live = true; void attachment(sessionId, attachmentId).then(value => { if (live) setSrc(`data:${value.attachment.mediaType};base64,${value.data}`) }).catch(() => {}); return () => { live = false } }, [sessionId, attachmentId]); return src ? <img src={src} alt="Attached image" style={{ display: 'block', maxWidth: '100%', borderRadius: 10, marginTop: 10 }} /> : <div className="attachment">Loading image…</div> }

function readPermissionProjection(value: unknown): PermissionState | undefined {
  const root = record(value)
  return parsePermission(record(root.values).permissions)
}

function parsePermission(value: unknown): PermissionState | undefined {
  const root = record(value)
  const currentValue = root.currentValue
  if (typeof currentValue !== 'string' || !PERMISSION_MODES.includes(currentValue as PermissionMode)) return undefined
  const options = Array.isArray(root.options) ? root.options.map(option => {
    const item = record(option)
    const optionValue = item.value
    return typeof optionValue === 'string' && PERMISSION_MODES.includes(optionValue as PermissionMode) && typeof item.name === 'string' ? { value: optionValue as PermissionMode, name: item.name } : undefined
  }).filter((option): option is { value: PermissionMode; name: string } => option !== undefined) : []
  return options.length > 0 ? { currentValue: currentValue as PermissionMode, options } : undefined
}

function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {} }

function PermissionSheet({ value, onClose, onSelect }: { value: PermissionState; onClose: () => void; onSelect: (value: PermissionMode) => void }): JSX.Element {
  return <div className="sheet"><div><div className="toolbar"><h2 style={{ flex: 1 }}>Permission mode</h2><button className="icon" onClick={onClose}>×</button></div><p className="subtle">Changes apply to the next Harness turn for this session.</p>{value.options.map(option => <button className="option" key={option.value} onClick={() => onSelect(option.value)}>{option.value === value.currentValue ? '✓ ' : ''}{option.name}<div className="subtle">{option.value === 'danger-full-access' ? 'Tools may modify files or run commands without approval.' : option.value === 'workspace-write' ? 'Tools may modify files inside the workspace.' : 'Read-only tool access.'}</div></button>)}</div></div>
}

function QuestionPanel({ question, onSubmit }: { question: QuestionState; onSubmit: (answers: Array<{ id: string; selected: string[] }>) => void }): JSX.Element { const [selected, setSelected] = useState<Record<string, string[]>>({}); return <div className="notice"><strong>Harness needs an answer</strong>{question.questions.map(item => <div key={item.id} style={{ marginTop: 12 }}><div>{item.question}</div>{item.detail && <div className="subtle">{item.detail}</div>}{item.options?.map(option => <button className="option" key={option.label} onClick={() => setSelected(previous => ({ ...previous, [item.id]: item.multiSelect ? [...(previous[item.id] ?? []).filter(value => value !== option.label), ...(previous[item.id]?.includes(option.label) ? [] : [option.label])] : [option.label] }))}>{(selected[item.id] ?? []).includes(option.label) ? '✓ ' : ''}{option.label}<div className="subtle">{option.description}</div></button>)}</div>)}<button className="primary" style={{ marginTop: 14 }} onClick={() => onSubmit(question.questions.map(item => ({ id: item.id, selected: selected[item.id] ?? [] })))}>Submit answer</button></div> }

function ModelSheet({ value, sessionId: _sessionId, onClose, onSelect }: { value: Awaited<ReturnType<typeof models>>; sessionId: string; onClose: () => void; onSelect: (provider: string, model: string, effort?: string) => void }): JSX.Element { return <div className="sheet"><div><div className="toolbar"><h2 style={{ flex: 1 }}>Model</h2><button className="icon" onClick={onClose}>×</button></div><p className="subtle">Current: {value.current.provider} / {value.current.model}</p>{value.groups.map(group => <div key={group.id}><div className="eyebrow">{group.name}</div>{group.models.map(model => <button className="option" key={model.id} onClick={() => onSelect(group.id, model.id, model.reasoning?.defaultEffort)}>{model.name}<div className="subtle">{model.description}</div></button>)}</div>)}</div></div> }

function readFile(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error ?? new Error('Could not read image')); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read image')); reader.readAsDataURL(file) }) }
