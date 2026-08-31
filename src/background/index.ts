import { buildAssignNodeUrl } from '../core/api';
import { queryAddressGroupInfo } from '../core/address';
import {
    getActiveAccount,
    getDappConnection,
    getOrganization,
    hasActiveSession,
    hydrateSession,
    removeDappConnection,
    setDappConnection,
    updateTransactionStatus,
    type UserAccount,
} from '../core/storage';
import { getLockedTXCerIdsByTxId, unlockTXCers } from '../core/txCerLockManager';
import { queryTXStatus } from '../core/txBuilder';
import { buildAndSubmitTransfer, type TransferRecipient } from '../core/transfer';
import { unlockUTXOsByTxId } from '../core/utxoLock';
import {
    clearPendingRequest,
    getPendingRequest,
    savePendingRequest,
    type PendingConnect,
    type PendingRequest,
    type PendingTransaction,
} from '../minimal/approvalStore';
import { APPROVAL_TIMEOUT_MS, remainingApprovalMs } from '../minimal/approvalPolicy';
import {
    isPublicPageMessage,
    isTrustedUiSender,
    normalizeQuickTransfer,
    resolveSenderOrigin,
    type PublicPageMessage,
    type QuickTransferRequest,
} from '../minimal/messages';
import {
    getWalletAccount,
    hasWallet,
    isWalletUnlocked,
    lockWallet,
    protectSessionStorage,
} from '../minimal/walletStore';

const STATUS_POLL_INTERVAL_MS = 2_000;
const STATUS_MAX_WAIT_MS = 120_000;
const SESSION_ALARM = 'pangu-v2-session-expiry';

interface RuntimeResponse {
    success: boolean;
    data?: unknown;
    error?: string;
}

interface UiMessage {
    type: string;
    payload?: unknown;
}

interface PendingResolver {
    resolve: (response: RuntimeResponse) => void;
    timeoutId: ReturnType<typeof setTimeout>;
}

interface PanguAccount {
    accountId: string;
    address: string;
}

const pendingResolvers = new Map<string, PendingResolver>();
const processingApprovals = new Set<string>();

function ok(data?: unknown): RuntimeResponse {
    return { success: true, data };
}

function fail(error: string): RuntimeResponse {
    return { success: false, error };
}

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

function accountView(account: UserAccount): PanguAccount {
    return {
        accountId: account.accountId,
        address: account.defaultAddress || account.mainAddress,
    };
}

function isAllowedLocalOrigin(origin: string): boolean {
    try {
        const hostname = new URL(origin).hostname;
        return hostname === 'localhost' || hostname === '127.0.0.1';
    } catch {
        return false;
    }
}

function senderContext(sender: chrome.runtime.MessageSender): { origin: string; tabId: number } | null {
    const origin = resolveSenderOrigin(sender.tab?.url) || resolveSenderOrigin(sender.url);
    const tabId = sender.tab?.id;
    if (!origin || !isAllowedLocalOrigin(origin) || typeof tabId !== 'number') return null;
    return { origin, tabId };
}

async function notifyTab(tabId: number, origin: string, event: Record<string, unknown>): Promise<void> {
    try {
        await chrome.tabs.sendMessage(tabId, {
            type: 'PANGU_EVENT',
            origin,
            ...event,
        });
    } catch {
        // The requesting tab may have closed or navigated after submission.
    }
}

async function openApprovalPopup(): Promise<void> {
    try {
        await chrome.action.openPopup();
    } catch {
        // Chrome may require the user to open the action manually in some contexts.
    }
}

async function expirePending(requestId: string): Promise<void> {
    const resolver = pendingResolvers.get(requestId);
    pendingResolvers.delete(requestId);
    processingApprovals.delete(requestId);
    await clearPendingRequest(requestId);
    resolver?.resolve(fail('Approval request timed out'));
}

async function waitForApproval(request: PendingRequest): Promise<RuntimeResponse> {
    const existing = await getPendingRequest();
    if (existing) return fail('Another approval request is already pending');
    await savePendingRequest(request);

    return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
            void expirePending(request.requestId);
        }, APPROVAL_TIMEOUT_MS);
        pendingResolvers.set(request.requestId, { resolve, timeoutId });
        void openApprovalPopup();
    });
}

function stopApprovalTimer(requestId: string): void {
    const resolver = pendingResolvers.get(requestId);
    if (resolver) clearTimeout(resolver.timeoutId);
}

async function finishPending(requestId: string, response: RuntimeResponse): Promise<void> {
    const resolver = pendingResolvers.get(requestId);
    if (resolver) clearTimeout(resolver.timeoutId);
    pendingResolvers.delete(requestId);
    processingApprovals.delete(requestId);
    await clearPendingRequest(requestId);
    resolver?.resolve(response);
}

async function requireActiveAccount(): Promise<UserAccount> {
    await hydrateSession();
    const account = await getActiveAccount();
    if (!account) throw new Error('Import a wallet first');
    return account;
}

async function handleConnect(
    message: PublicPageMessage,
    origin: string,
    tabId: number
): Promise<RuntimeResponse> {
    const account = await getWalletAccount();
    if (!account) return fail('Import a wallet first');

    await hydrateSession();
    const connected = await getDappConnection(account.accountId, origin);
    if (connected && await hasActiveSession(account.accountId)) return ok(accountView(account));

    const pending: PendingConnect = {
        kind: 'connect',
        requestId: message.requestId,
        accountId: account.accountId,
        origin,
        tabId,
        createdAt: Date.now(),
    };
    return waitForApproval(pending);
}

async function handleGetAccount(origin: string): Promise<RuntimeResponse> {
    const account = await getWalletAccount();
    if (!account) return ok(null);
    await hydrateSession();
    if (!await hasActiveSession(account.accountId)) return ok(null);
    const connected = await getDappConnection(account.accountId, origin);
    return ok(connected ? accountView(account) : null);
}

async function handleDisconnect(origin: string, tabId: number): Promise<RuntimeResponse> {
    const account = await getWalletAccount();
    if (account) await removeDappConnection(account.accountId, origin);
    await notifyTab(tabId, origin, { event: 'disconnect' });
    return ok(true);
}

async function handleSendTransaction(
    message: PublicPageMessage,
    origin: string,
    tabId: number
): Promise<RuntimeResponse> {
    const account = await getWalletAccount();
    if (!account) return fail('Import a wallet first');
    const connected = await getDappConnection(account.accountId, origin);
    if (!connected) return fail('Connect this site before sending a transaction');

    let request: QuickTransferRequest;
    try {
        request = normalizeQuickTransfer(message.payload);
    } catch (error) {
        return fail(errorMessage(error, 'Invalid quick transfer request'));
    }

    const pending: PendingTransaction = {
        kind: 'transaction',
        requestId: message.requestId,
        accountId: account.accountId,
        origin,
        tabId,
        createdAt: Date.now(),
        request,
    };
    return waitForApproval(pending);
}

async function handlePublicMessage(
    message: PublicPageMessage,
    sender: chrome.runtime.MessageSender
): Promise<RuntimeResponse> {
    const context = senderContext(sender);
    if (!context) return fail('PanguPay is available only to local test sites');

    switch (message.type) {
        case 'PANGU_CONNECT':
            return handleConnect(message, context.origin, context.tabId);
        case 'PANGU_GET_ACCOUNT':
            return handleGetAccount(context.origin);
        case 'PANGU_SEND_TRANSACTION':
            return handleSendTransaction(message, context.origin, context.tabId);
        case 'PANGU_DISCONNECT':
            return handleDisconnect(context.origin, context.tabId);
    }
}

async function currentUiState(): Promise<RuntimeResponse> {
    await hydrateSession();
    const account = await getWalletAccount();
    const pending = await getPendingRequest();
    return ok({
        hasWallet: await hasWallet(),
        unlocked: account ? await hasActiveSession(account.accountId) : false,
        account: account ? accountView(account) : null,
        pending,
    });
}

function requestedPendingId(message: UiMessage): string {
    if (!message.payload || typeof message.payload !== 'object') return '';
    return String((message.payload as Record<string, unknown>).requestId || '');
}

async function loadMatchingPending(message: UiMessage): Promise<PendingRequest> {
    const requestId = requestedPendingId(message);
    const pending = await getPendingRequest();
    if (!requestId || !pending || pending.requestId !== requestId) {
        throw new Error('Approval request expired');
    }
    return pending;
}

async function approveConnect(pending: PendingConnect): Promise<RuntimeResponse> {
    const account = await requireActiveAccount();
    if (account.accountId !== pending.accountId) throw new Error('The active wallet changed');
    if (!await hasActiveSession(account.accountId)) throw new Error('Unlock the wallet before approving');

    stopApprovalTimer(pending.requestId);
    await setDappConnection(account.accountId, pending.origin, {
        address: account.defaultAddress || account.mainAddress,
    });
    const result = accountView(account);
    await finishPending(pending.requestId, ok(result));
    await notifyTab(pending.tabId, pending.origin, { event: 'accountChanged', account: result });
    return ok(result);
}

async function recipientMetadata(request: QuickTransferRequest): Promise<TransferRecipient> {
    const response = await queryAddressGroupInfo(request.toAddress);
    if (!response.success || !response.data) {
        throw new Error(response.error || 'Unable to query recipient metadata');
    }
    const publicKey = response.data.publicKey
        ? `${response.data.publicKey.x},${response.data.publicKey.y}`
        : '';
    if (!publicKey) throw new Error('Recipient public key is unavailable');
    return {
        address: request.toAddress,
        amount: request.amount,
        coinType: 0,
        publicKey,
        orgId: response.data.groupId,
        transferGas: '0',
        seedAnchor: response.data.seedAnchor,
        seedChainStep: response.data.seedChainStep,
        defaultSpendAlgorithm: response.data.defaultSpendAlgorithm,
    };
}

async function unlockFailedInputs(txId: string): Promise<void> {
    await unlockUTXOsByTxId(txId);
    const txCerIds = getLockedTXCerIdsByTxId(txId);
    if (txCerIds.length) unlockTXCers(txCerIds);
}

async function watchTransaction(pending: PendingTransaction, txId: string): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < STATUS_MAX_WAIT_MS) {
        await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_INTERVAL_MS));
        try {
            const organization = await getOrganization(pending.accountId);
            if (!organization?.groupId) throw new Error('Wallet organization is unavailable');
            const endpoint = organization.assignAPIEndpoint || organization.assignNodeUrl;
            const status = await queryTXStatus(
                txId,
                organization.groupId,
                endpoint ? buildAssignNodeUrl(endpoint) : undefined
            );
            if (status.status !== 'success' && status.status !== 'failed') continue;

            const error = status.status === 'failed' ? status.error_reason || 'Transaction failed' : '';
            await updateTransactionStatus(pending.accountId, txId, status.status, {
                blockNumber: status.block_height || 0,
                failureReason: error || undefined,
            });
            if (status.status === 'failed') await unlockFailedInputs(txId);
            await notifyTab(pending.tabId, pending.origin, {
                event: 'txStatus',
                txId,
                mode: 'quick',
                status: status.status,
                ...(error ? { error } : {}),
            });
            return;
        } catch (error) {
            console.warn('[PanguPay] Final transaction status check failed:', error);
        }
    }
}

async function approveTransaction(pending: PendingTransaction): Promise<RuntimeResponse> {
    const account = await requireActiveAccount();
    if (account.accountId !== pending.accountId) throw new Error('The active wallet changed');
    if (!await hasActiveSession(account.accountId)) throw new Error('Unlock the wallet before approving');
    const connection = await getDappConnection(account.accountId, pending.origin);
    if (!connection?.address) throw new Error('The requesting site is no longer connected');

    stopApprovalTimer(pending.requestId);
    const recipient = await recipientMetadata(pending.request);
    const submit = await buildAndSubmitTransfer({
        account,
        fromAddresses: [connection.address],
        toAddress: recipient.address,
        amount: recipient.amount,
        coinType: 0,
        transferMode: 'quick',
        recipients: [recipient],
        gas: '0',
        extraGas: '0',
        changeAddresses: { 0: connection.address },
    });
    if (!submit.success || !submit.txId) throw new Error(submit.error || 'Transaction submission failed');

    const result = { txId: submit.txId, mode: 'quick', status: 'submitted' } as const;
    await finishPending(pending.requestId, ok(result));
    await notifyTab(pending.tabId, pending.origin, {
        event: 'txStatus',
        ...result,
    });
    void watchTransaction(pending, submit.txId);
    return ok(result);
}

async function approvePending(message: UiMessage): Promise<RuntimeResponse> {
    const pending = await loadMatchingPending(message);
    if (processingApprovals.has(pending.requestId)) return fail('Approval is already being processed');
    processingApprovals.add(pending.requestId);
    try {
        return pending.kind === 'connect' ? await approveConnect(pending) : await approveTransaction(pending);
    } catch (error) {
        processingApprovals.delete(pending.requestId);
        const messageText = errorMessage(error, 'Approval failed');
        if (!messageText.toLowerCase().includes('unlock')) {
            await finishPending(pending.requestId, fail(messageText));
        }
        return fail(messageText);
    }
}

async function rejectPending(message: UiMessage): Promise<RuntimeResponse> {
    const pending = await loadMatchingPending(message);
    await finishPending(pending.requestId, fail('User rejected the request'));
    return ok(true);
}

async function handleUiMessage(message: UiMessage): Promise<RuntimeResponse> {
    switch (message.type) {
        case 'PANGU_UI_GET_STATE':
            return currentUiState();
        case 'PANGU_UI_APPROVE':
            return approvePending(message);
        case 'PANGU_UI_REJECT':
            return rejectPending(message);
        case 'PANGU_UI_LOCK':
            await lockWallet();
            return currentUiState();
        default:
            return fail('Unsupported extension UI message');
    }
}

chrome.runtime.onMessage.addListener((
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: RuntimeResponse) => void
) => {
    let task: Promise<RuntimeResponse> | null = null;
    const extensionBase = chrome.runtime.getURL('');
    if (isTrustedUiSender(sender, extensionBase) && message && typeof message === 'object') {
        task = handleUiMessage(message as UiMessage);
    } else if (isPublicPageMessage(message)) {
        task = handlePublicMessage(message, sender);
    }
    if (!task) return false;

    void task.then(sendResponse).catch((error: unknown) => {
        sendResponse(fail(errorMessage(error, 'PanguPay request failed')));
    });
    return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== SESSION_ALARM) return;
    void (async () => {
        const account = await getActiveAccount();
        if (account) await hasActiveSession(account.accountId);
    })();
});

async function initialize(): Promise<void> {
    await protectSessionStorage();
    await hydrateSession();
    chrome.alarms.create(SESSION_ALARM, { periodInMinutes: 1 });
    const pending = await getPendingRequest();
    if (pending) {
        const remaining = remainingApprovalMs(pending.createdAt);
        if (remaining <= 0) await clearPendingRequest(pending.requestId);
        else setTimeout(() => void expirePending(pending.requestId), remaining);
    }
}

void initialize().catch((error) => {
    console.error('[PanguPay] Background initialization failed:', error);
});
