export const PUBLIC_PAGE_MESSAGE_TYPES = [
    'PANGU_CONNECT',
    'PANGU_GET_ACCOUNT',
    'PANGU_SEND_TRANSACTION',
    'PANGU_DISCONNECT',
] as const;

export type PublicPageMessageType = typeof PUBLIC_PAGE_MESSAGE_TYPES[number];

export interface PublicPageMessage {
    type: PublicPageMessageType;
    requestId: string;
    payload?: unknown;
}

export interface QuickTransferRequest {
    toAddress: string;
    amount: string;
}

interface SenderLike {
    id?: string;
    url?: string;
    tab?: unknown;
}

export function isPublicPageMessage(value: unknown): value is PublicPageMessage {
    if (!value || typeof value !== 'object') return false;
    const message = value as Record<string, unknown>;
    return typeof message.requestId === 'string'
        && message.requestId.length > 0
        && PUBLIC_PAGE_MESSAGE_TYPES.includes(message.type as PublicPageMessageType);
}

export function isTrustedUiSender(sender: SenderLike, extensionBase: string): boolean {
    const extensionId = new URL(extensionBase).hostname;
    return sender.id === extensionId
        && typeof sender.url === 'string'
        && sender.url.startsWith(extensionBase);
}

export function resolveSenderOrigin(senderUrl?: string): string {
    if (!senderUrl) return '';
    try {
        const url = new URL(senderUrl);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : '';
    } catch {
        return '';
    }
}

function isPositiveDecimal(value: string): boolean {
    if (!/^\d+(?:\.\d+)?$/.test(value)) return false;
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole) > 0n || /[1-9]/.test(fraction);
}

export function normalizeQuickTransfer(value: unknown): QuickTransferRequest {
    if (!value || typeof value !== 'object') throw new Error('Transaction request is required');
    const raw = value as Record<string, unknown>;
    const toAddress = String(raw.toAddress || '').trim();
    if (!/^(?:0x)?[a-fA-F0-9]{40}$/.test(toAddress)) throw new Error('Transaction recipient is invalid');
    const amount = String(raw.amount ?? '').trim();
    if (!isPositiveDecimal(amount)) throw new Error('Transaction amount must be positive');
    return { toAddress, amount };
}
