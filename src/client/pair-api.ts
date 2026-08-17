export interface PendingPairing { id: string; code: string; status: string; userAgent?: string; address?: string; expiresAt: number }
export interface PairState { phase: string; deviceCount: number; onlineCount: number; pending: PendingPairing[]; tokenExpiresAt?: number; publicUrl?: string }
export type IssueResponse = { ok: true; url: string; expiresAt: number; lanAddresses: string[]; publicBaseUrl?: string } | { ok: false; code: string }

export async function issuePair(): Promise<IssueResponse> {
  const response = await fetch('/harness-remote/pair/issue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  return await response.json() as IssueResponse
}

export async function pairAction(action: 'approve' | 'reject', id: string): Promise<void> {
  await fetch(`/harness-remote/pair/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) })
}

export async function stopPair(): Promise<void> {
  await fetch('/harness-remote/pair/stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
}
