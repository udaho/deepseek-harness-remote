import type { HistoryEntry, SessionModels, SessionSummary } from '@deepseek-ai/dsh-host-apiproxy/api/sessions'
import type { WorkspaceView } from '@deepseek-ai/dsh-host-apiproxy/api/workspace'
import { call } from './rpc.ts'

export type WorkspacePage = { items: WorkspaceView[]; archivedSessionIds: string[] }
export type SessionPage = { items: SessionSummary[]; hasMore: boolean; nextCursor?: string }
export type HistoryPage = { events: HistoryEntry[]; hasMore: boolean; projections?: unknown }

export const workspaces = (): Promise<WorkspacePage> => call('workspace.list', {})
export const sessions = (cursor?: string): Promise<SessionPage> => call('session.list', cursor ? { cursor } : {})
export const history = (sessionId: string, beforeSeq?: number, maxMessages = 50): Promise<HistoryPage> => call('session.history', { sessionId, ...(beforeSeq === undefined ? {} : { beforeSeq }), maxMessages })
export const createSession = (workspaceId: string): Promise<{ sessionId: string }> => call('session.create', { workspaceId })
export const searchSessions = (query: string): Promise<{ items: Array<{ sessionId: string; snippet: string }>; hasMore: boolean }> => call('session.search', { query })
export const prompt = (sessionId: string, content: Array<{ type: 'text'; text: string } | { type: 'image'; mediaType: string; data: string; name?: string }>, mode: 'queue' | 'steer' = 'queue'): Promise<unknown> => call('session.prompt', { sessionId, mode, content, clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
export const models = (sessionId: string): Promise<SessionModels> => call('session.models', { sessionId })
export const selectModel = (sessionId: string, provider: string, model: string, reasoningEffort?: string): Promise<unknown> => call('session.selectModel', { sessionId, provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) })
export const rename = (sessionId: string, title: string): Promise<unknown> => call('session.rename', { sessionId, title })
export const fork = (sessionId: string, atSeq?: number): Promise<{ sessionId: string }> => call('session.fork', { sessionId, ...(atSeq === undefined ? {} : { atSeq }) })
export const cancel = (sessionId: string): Promise<unknown> => call('session.cancel', { sessionId })
export const archive = (sessionId: string): Promise<unknown> => call('workspace.archiveSession', { sessionId })
export const attachment = (sessionId: string, attachmentId: string): Promise<{ attachment: { attachmentId: string; mediaType: string; name?: string }; data: string }> => call('session.attachment', { sessionId, attachmentId })
