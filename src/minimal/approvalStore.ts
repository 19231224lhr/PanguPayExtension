import type { QuickTransferRequest } from './messages';

export const PENDING_REQUEST_KEY = 'pangu_v2_pending_request';

interface PendingBase {
    requestId: string;
    accountId: string;
    origin: string;
    tabId: number;
    createdAt: number;
}

export interface PendingConnect extends PendingBase {
    kind: 'connect';
}

export interface PendingTransaction extends PendingBase {
    kind: 'transaction';
    request: QuickTransferRequest;
}

export type PendingRequest = PendingConnect | PendingTransaction;

export async function getPendingRequest(): Promise<PendingRequest | null> {
    const stored = await chrome.storage.session.get(PENDING_REQUEST_KEY);
    return (stored[PENDING_REQUEST_KEY] as PendingRequest | undefined) || null;
}

export async function savePendingRequest(request: PendingRequest): Promise<void> {
    await chrome.storage.session.set({ [PENDING_REQUEST_KEY]: request });
}

export async function clearPendingRequest(requestId?: string): Promise<void> {
    if (requestId) {
        const current = await getPendingRequest();
        if (current?.requestId !== requestId) return;
    }
    await chrome.storage.session.remove(PENDING_REQUEST_KEY);
}
