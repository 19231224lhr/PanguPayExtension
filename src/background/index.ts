/**
 * Background Service Worker
 * 
 * Extension background script:
 * - message transport
 * - session and DApp state
 * - scheduled tasks
 */

import {
    getActiveAccount,
    clearSession,
    getOrganization,
    saveTransaction,
    hydrateSession,
    hasActiveSession,
    getDappConnection,
    setDappConnection,
    removeDappConnection,
    saveDappPendingConnection,
    getDappPendingConnection,
    getDappPendingConnectionById,
    clearDappPendingConnection,
    saveDappSignPendingConnection,
    getDappSignPendingConnection,
    getDappSignPendingConnectionById,
    clearDappSignPendingConnection,
    saveDappPendingTransaction,
    getDappPendingTransaction,
    getDappPendingTransactionById,
    clearDappPendingTransaction,
    saveDappTxWatch,
    consumeDappTxWatches,
    getDappTxWatches,
    updateTransactionStatus,
    getOnboardingStep,
    type DappPendingTransaction,
    type DappTransactionRequest,
} from '../core/storage';
import type { PanguMessage, PanguResponse } from '../core/types';
import { buildAndSubmitTransfer, type TransferMode, type TransferRecipient } from '../core/transfer';
import { queryAddressGroupInfo } from '../core/address';
import { buildAssignNodeUrl } from '../core/api';
import { queryTXStatus, type TXStatusResponse } from '../core/txBuilder';
import { unlockUTXOsByTxId } from '../core/utxoLock';
import { getLockedTXCerIdsByTxId, unlockTXCers } from '../core/txCerLockManager';
import { normalizeDappTxRequest } from '../core/dappTxRequest';

// ========================================
// 娑堟伅澶勭悊
// ========================================

const CONNECT_TIMEOUT_MS = 120000;
const DAPP_TX_STATUS_POLL_INTERVAL_MS = 2000;
const DAPP_TX_STATUS_MAX_WAIT_MS = 60000;
const DAPP_TX_STATUS_ALARM = 'dappTxStatus';
let uiPort: chrome.runtime.Port | null = null;

type PendingConnect = {
    accountId: string;
    origin: string;
    timeoutId: number;
    resolve: (response: PanguResponse) => void;
};

const pendingConnects = new Map<string, PendingConnect>();
const pendingSignConnects = new Map<string, PendingConnect>();
const pendingTransactions = new Map<string, PendingConnect>();
const backgroundDappTxWatchers = new Set<string>();

type SiteInfo = {
    origin: string;
    title?: string;
    icon?: string;
};

function normalizeOrigin(origin: string): string {
    return String(origin || '').trim().toLowerCase();
}

function resolveSiteInfo(message: PanguMessage, sender: chrome.runtime.MessageSender): SiteInfo {
    let origin = message.site?.origin || '';
    if (!origin && sender?.url) {
        try {
            origin = new URL(sender.url).origin;
        } catch {
            origin = '';
        }
    }
    origin = normalizeOrigin(origin);

    const title = message.site?.title || (origin ? new URL(origin).hostname : '');
    const icon = message.site?.icon || '';

    return { origin, title, icon };
}

async function openPopupWindow(): Promise<void> {
    try {
        if (chrome.action?.openPopup) {
            await chrome.action.openPopup();
            return;
        }
    } catch {
        // ignore
    }
}

chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'pangu-ui') return;
    uiPort = port;
    port.onDisconnect.addListener(() => {
        if (uiPort === port) uiPort = null;
    });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.__pangu_ui) return false;
    if (
        (message?.type === 'PANGU_CONNECT' ||
            message?.type === 'PANGU_CONNECT_SIGN' ||
            message?.type === 'PANGU_SEND_TRANSACTION') &&
        !uiPort
    ) {
        void openPopupWindow();
    }
    handleMessage(message, sender)
        .then(sendResponse)
        .catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
    return true; // keep the async message channel open
});

async function handleMessage(
    message: PanguMessage,
    _sender: chrome.runtime.MessageSender
): Promise<PanguResponse> {
    await hydrateSession();
    const requestId = message.requestId || Date.now().toString();

    switch (message.type) {
        case 'PANGU_CONNECT':
            return handleConnect(requestId, message, _sender);

        case 'PANGU_CONNECT_SIGN':
            return handleConnectSign(requestId, message, _sender);

        case 'PANGU_DISCONNECT':
            return handleDisconnect(requestId, message, _sender);

        case 'PANGU_GET_ACCOUNT':
            return handleGetAccount(requestId, message, _sender);

        case 'PANGU_SEND_TRANSACTION':
            return handleSendTransaction(requestId, message, _sender);

        case 'PANGU_DAPP_GET_PENDING':
            return handleGetPending(requestId);

        case 'PANGU_DAPP_APPROVE':
            return handleApprove(requestId, message.payload);

        case 'PANGU_DAPP_REJECT':
            return handleReject(requestId, message.payload);

        case 'PANGU_DAPP_SIGN_GET_PENDING':
            return handleSignGetPending(requestId);

        case 'PANGU_DAPP_SIGN_APPROVE':
            return handleSignApprove(requestId, message.payload);

        case 'PANGU_DAPP_SIGN_REJECT':
            return handleSignReject(requestId, message.payload);

        case 'PANGU_DAPP_TX_GET_PENDING':
            return handleTxGetPending(requestId);

        case 'PANGU_DAPP_TX_APPROVE':
            return handleTxApprove(requestId, message.payload);

        case 'PANGU_DAPP_TX_REJECT':
            return handleTxReject(requestId, message.payload);

        case 'PANGU_DAPP_NOTIFY':
            return handleNotify(requestId, message.payload);

        default:
            return {
                type: 'PANGU_RESPONSE',
                requestId,
                success: false,
                error: '未知的消息类型',
            };
    }
}

async function handleConnect(
    requestId: string,
    message: PanguMessage,
    sender: chrome.runtime.MessageSender
): Promise<PanguResponse> {
    const account = await getActiveAccount();

    if (!account) {
        // Open popup and let the user log in.
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '请先登录钱包',
        };
    }

    const step = await getOnboardingStep(account.accountId);
    if (step !== 'complete') {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '请先完成钱包初始化',
        };
    }

    const site = resolveSiteInfo(message, sender);
    if (!site.origin) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '无法识别来源站点',
        };
    }

    const existing = await getDappConnection(account.accountId, site.origin);
    if (existing?.address) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: true,
            data: {
                address: existing.address,
                accountId: account.accountId,
                origin: site.origin,
            },
        };
    }

    await saveDappPendingConnection({
        requestId,
        accountId: account.accountId,
        origin: site.origin,
        createdAt: Date.now(),
        title: site.title,
        icon: site.icon,
    });

    try {
        if (uiPort) {
            uiPort.postMessage({ type: 'PANGU_UI_PENDING', accountId: account.accountId });
        } else {
            void chrome.runtime
                .sendMessage({
                    __pangu_ui: true,
                    type: 'PANGU_UI_PENDING',
                    accountId: account.accountId,
                })
                .catch(() => {});
        }
    } catch {
        // ignore
    }

    return new Promise((resolve) => {
        const timeoutId = setTimeout(async () => {
            pendingConnects.delete(requestId);
            await clearDappPendingConnection(account.accountId, requestId);
            resolve({
                type: 'PANGU_RESPONSE',
                requestId,
                success: false,
                error: '用户未响应连接请求',
            });
        }, CONNECT_TIMEOUT_MS);

        pendingConnects.set(requestId, {
            accountId: account.accountId,
            origin: site.origin,
            timeoutId: timeoutId as unknown as number,
            resolve,
        });
    });
}

function buildDefaultSignMessage(origin: string, nonce: string): string {
    const issuedAt = new Date().toISOString();
    return [
        'PanguPay Sign-In',
        `Origin: ${origin}`,
        `Nonce: ${nonce}`,
        `Issued At: ${issuedAt}`,
    ].join('\n');
}

async function handleConnectSign(
    requestId: string,
    message: PanguMessage,
    sender: chrome.runtime.MessageSender
): Promise<PanguResponse> {
    const account = await getActiveAccount();
    if (!account) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '请先登录钱包',
        };
    }

    const step = await getOnboardingStep(account.accountId);
    if (step !== 'complete') {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '请先完成钱包初始化',
        };
    }

    const site = resolveSiteInfo(message, sender);
    if (!site.origin) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '无法识别来源站点',
        };
    }

    const payload = message.payload as { message?: string; nonce?: string } | null;
    const nonce = payload?.nonce || Math.random().toString(36).slice(2);
    const signMessage = payload?.message || buildDefaultSignMessage(site.origin, nonce);

    await saveDappSignPendingConnection({
        requestId,
        accountId: account.accountId,
        origin: site.origin,
        createdAt: Date.now(),
        title: site.title,
        icon: site.icon,
        message: signMessage,
    });

    try {
        if (uiPort) {
            uiPort.postMessage({ type: 'PANGU_UI_SIGN_PENDING', accountId: account.accountId });
        } else {
            void chrome.runtime
                .sendMessage({
                    __pangu_ui: true,
                    type: 'PANGU_UI_SIGN_PENDING',
                    accountId: account.accountId,
                })
                .catch(() => {});
        }
    } catch {
        // ignore
    }

    return new Promise((resolve) => {
        const timeoutId = setTimeout(async () => {
            pendingSignConnects.delete(requestId);
            await clearDappSignPendingConnection(account.accountId, requestId);
            resolve({
                type: 'PANGU_RESPONSE',
                requestId,
                success: false,
                error: '用户未响应签名请求',
            });
        }, CONNECT_TIMEOUT_MS);

        pendingSignConnects.set(requestId, {
            accountId: account.accountId,
            origin: site.origin,
            timeoutId: timeoutId as unknown as number,
            resolve,
        });
    });
}

async function handleDisconnect(
    requestId: string,
    message: PanguMessage,
    sender: chrome.runtime.MessageSender
): Promise<PanguResponse> {
    const account = await getActiveAccount();
    const site = resolveSiteInfo(message, sender);

    if (account && site.origin) {
        await removeDappConnection(account.accountId, site.origin);
        await broadcastDappEvent(site.origin, {
            event: 'disconnect',
            origin: site.origin,
        });
    }
    return {
        type: 'PANGU_RESPONSE',
        requestId,
        success: true,
    };
}

async function handleGetAccount(
    requestId: string,
    message: PanguMessage,
    sender: chrome.runtime.MessageSender
): Promise<PanguResponse> {
    const account = await getActiveAccount();

    if (!account || !(await hasActiveSession(account.accountId))) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '未登录或未解锁',
        };
    }

    const site = resolveSiteInfo(message, sender);
    if (!site.origin) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '无法识别来源站点',
        };
    }

    const connection = await getDappConnection(account.accountId, site.origin);
    if (!connection?.address) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '站点未授权，请先连接钱包',
        };
    }

    const org = await getOrganization(account.accountId);

    return {
        type: 'PANGU_RESPONSE',
        requestId,
        success: true,
        data: {
            address: connection.address,
            accountId: account.accountId,
            balance: account.totalBalance,
            organization: org?.groupName || null,
            origin: site.origin,
        },
    };
}

async function handleGetPending(requestId: string): Promise<PanguResponse> {
    const account = await getActiveAccount();
    if (!account) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '未登录钱包',
        };
    }
    const pending = await getDappPendingConnection(account.accountId);
    return {
        type: 'PANGU_RESPONSE',
        requestId,
        success: true,
        data: pending,
    };
}

async function handleSignGetPending(requestId: string): Promise<PanguResponse> {
    const account = await getActiveAccount();
    if (!account) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '未登录钱包',
        };
    }
    const pending = await getDappSignPendingConnection(account.accountId);
    return {
        type: 'PANGU_RESPONSE',
        requestId,
        success: true,
        data: pending,
    };
}

async function handleApprove(requestId: string, payload: unknown): Promise<PanguResponse> {
    const account = await getActiveAccount();
    if (!account) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '未登录钱包',
        };
    }

    const data = payload as { requestId?: string; address?: string; origin?: string } | null;
    if (!data?.requestId) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '连接请求已失效',
        };
    }
    const pending = await getDappPendingConnectionById(account.accountId, data.requestId);
    if (!pending) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '连接请求已失效',
        };
    }

    const normalizedAddress = String(data.address || '').trim().toLowerCase();
    const addressInfo =
        account.addresses?.[normalizedAddress] ||
        (account.mainAddress && account.mainAddress.toLowerCase() === normalizedAddress
            ? account.addresses?.[account.mainAddress] || null
            : null);

    if (!normalizedAddress || !addressInfo) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '请选择有效的钱包地址',
        };
    }

    await setDappConnection(account.accountId, pending.origin, {
        address: normalizedAddress,
        title: pending.title,
        icon: pending.icon,
    });
    await clearDappPendingConnection(account.accountId, pending.requestId);

    const pendingResolver = pendingConnects.get(pending.requestId);
    if (pendingResolver) {
        clearTimeout(pendingResolver.timeoutId);
        pendingConnects.delete(pending.requestId);
        pendingResolver.resolve({
            type: 'PANGU_RESPONSE',
            requestId: pending.requestId,
            success: true,
            data: {
                address: normalizedAddress,
                accountId: account.accountId,
                origin: pending.origin,
            },
        });
    }

    return {
        type: 'PANGU_RESPONSE',
        requestId,
        success: true,
        data: {
            address: normalizedAddress,
            origin: pending.origin,
        },
    };
}

async function handleReject(requestId: string, payload: unknown): Promise<PanguResponse> {
    const account = await getActiveAccount();
    if (!account) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '未登录钱包',
        };
    }

    const data = payload as { requestId?: string } | null;
    if (!data?.requestId) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '连接请求已失效',
        };
    }
    const pending = await getDappPendingConnectionById(account.accountId, data.requestId);
    if (!pending) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '连接请求已失效',
        };
    }

    await clearDappPendingConnection(account.accountId, pending.requestId);

    const pendingResolver = pendingConnects.get(pending.requestId);
    if (pendingResolver) {
        clearTimeout(pendingResolver.timeoutId);
        pendingConnects.delete(pending.requestId);
        pendingResolver.resolve({
            type: 'PANGU_RESPONSE',
            requestId: pending.requestId,
            success: false,
            error: '用户拒绝连接',
        });
    }

    return {
        type: 'PANGU_RESPONSE',
        requestId,
        success: true,
    };
}

async function handleSignApprove(requestId: string, payload: unknown): Promise<PanguResponse> {
    const account = await getActiveAccount();
    if (!account) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '未登录钱包',
        };
    }

    const data = payload as {
        requestId?: string;
        address?: string;
        signature?: { R: string; S: string };
        publicKey?: { x: string; y: string };
    } | null;
    if (!data?.requestId) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '签名请求已失效',
        };
    }
    const pending = await getDappSignPendingConnectionById(account.accountId, data.requestId);
    if (!pending) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '签名请求已失效',
        };
    }

    const normalizedAddress = String(data.address || '').trim().toLowerCase();
    if (!normalizedAddress) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '请选择有效的钱包地址',
        };
    }

    await setDappConnection(account.accountId, pending.origin, {
        address: normalizedAddress,
        title: pending.title,
        icon: pending.icon,
    });
    await clearDappSignPendingConnection(account.accountId, pending.requestId);

    const pendingResolver = pendingSignConnects.get(pending.requestId);
    if (pendingResolver) {
        clearTimeout(pendingResolver.timeoutId);
        pendingSignConnects.delete(pending.requestId);
        pendingResolver.resolve({
            type: 'PANGU_RESPONSE',
            requestId: pending.requestId,
            success: true,
            data: {
                address: normalizedAddress,
                accountId: account.accountId,
                origin: pending.origin,
                message: pending.message,
                signature: data.signature,
                publicKey: data.publicKey,
            },
        });
    }

    return {
        type: 'PANGU_RESPONSE',
        requestId,
        success: true,
        data: {
            address: normalizedAddress,
            origin: pending.origin,
        },
    };
}

async function handleSignReject(requestId: string, payload: unknown): Promise<PanguResponse> {
    const account = await getActiveAccount();
    if (!account) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '未登录钱包',
        };
    }

    const data = payload as { requestId?: string } | null;
    if (!data?.requestId) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '签名请求已失效',
        };
    }
    const pending = await getDappSignPendingConnectionById(account.accountId, data.requestId);
    if (!pending) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '签名请求已失效',
        };
    }

    await clearDappSignPendingConnection(account.accountId, pending.requestId);

    const pendingResolver = pendingSignConnects.get(pending.requestId);
    if (pendingResolver) {
        clearTimeout(pendingResolver.timeoutId);
        pendingSignConnects.delete(pending.requestId);
        pendingResolver.resolve({
            type: 'PANGU_RESPONSE',
            requestId: pending.requestId,
            success: false,
            error: '用户拒绝签名',
        });
    }

    return {
        type: 'PANGU_RESPONSE',
        requestId,
        success: true,
    };
}

async function handleTxGetPending(requestId: string): Promise<PanguResponse> {
    const account = await getActiveAccount();
    if (!account) {
        return { type: 'PANGU_RESPONSE', requestId, success: false, error: 'Wallet is not logged in' };
    }
    const pending = await getDappPendingTransaction(account.accountId);
    return { type: 'PANGU_RESPONSE', requestId, success: true, data: pending };
}

async function enrichDappRecipients(request: DappTransactionRequest): Promise<TransferRecipient[]> {
    const recipients = request.recipients || [];
    const useRequestWideMeta = recipients.length === 1;
    const out: TransferRecipient[] = [];
    for (const recipient of recipients) {
        const query = await queryAddressGroupInfo(recipient.to);
        const meta = query.success ? query.data : undefined;
        const publicKey =
            recipient.publicKey ||
            (useRequestWideMeta ? request.publicKey : '') ||
            (meta?.publicKey ? `${meta.publicKey.x},${meta.publicKey.y}` : '');
        out.push({
            address: recipient.to,
            amount: Number(recipient.amount || 0),
            coinType: Number(recipient.coinType ?? request.coinType ?? meta?.type ?? 0),
            publicKey,
            orgId: recipient.orgId || (useRequestWideMeta ? request.orgId : '') || meta?.groupId || '',
            transferGas: recipient.transferGas ?? (useRequestWideMeta ? request.transferGas : undefined),
            seedAnchor: recipient.seedAnchor ?? (useRequestWideMeta ? request.seedAnchor : undefined) ?? meta?.seedAnchor,
            seedChainStep:
                recipient.seedChainStep ?? (useRequestWideMeta ? request.seedChainStep : undefined) ?? meta?.seedChainStep,
            defaultSpendAlgorithm:
                recipient.defaultSpendAlgorithm ??
                (useRequestWideMeta ? request.defaultSpendAlgorithm : undefined) ??
                meta?.defaultSpendAlgorithm,
        });
    }
    return out;
}

async function failPendingDappTransaction(
    accountId: string,
    pending: DappPendingTransaction,
    error: string
): Promise<void> {
    await clearDappPendingTransaction(accountId, pending.requestId);
    const pendingResolver = pendingTransactions.get(pending.requestId);
    if (pendingResolver) {
        clearTimeout(pendingResolver.timeoutId);
        pendingTransactions.delete(pending.requestId);
        pendingResolver.resolve({
            type: 'PANGU_RESPONSE',
            requestId: pending.requestId,
            success: false,
            error,
        });
    }
    await broadcastDappEvent(pending.origin, {
        event: 'txStatus',
        origin: pending.origin,
        status: 'failed',
        mode: pending.request.mode || 'normal',
        error,
    });
}

async function handleTxApprove(requestId: string, payload: unknown): Promise<PanguResponse> {
    const account = await getActiveAccount();
    if (!account) {
        return { type: 'PANGU_RESPONSE', requestId, success: false, error: 'Wallet is not logged in' };
    }

    const data = payload as { requestId?: string } | null;
    if (!data?.requestId) {
        return { type: 'PANGU_RESPONSE', requestId, success: false, error: 'Transaction request expired' };
    }

    const pending = await getDappPendingTransactionById(account.accountId, data.requestId);
    if (!pending) {
        return { type: 'PANGU_RESPONSE', requestId, success: false, error: 'Transaction request expired' };
    }

    const connection = await getDappConnection(account.accountId, pending.origin);
    if (!connection?.address) {
        const error = 'Site is not connected';
        await failPendingDappTransaction(account.accountId, pending, error);
        return { type: 'PANGU_RESPONSE', requestId, success: false, error };
    }

    const mode = (pending.request.mode || 'normal') as TransferMode;
    let recipients: TransferRecipient[] = [];
    try {
        recipients = await enrichDappRecipients(pending.request);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Transaction recipient lookup failed';
        await failPendingDappTransaction(account.accountId, pending, message);
        return { type: 'PANGU_RESPONSE', requestId, success: false, error: message };
    }
    const coinTypes = new Set(recipients.map((item) => Number(item.coinType || 0)));
    const changeAddresses: Record<number, string> = {};
    for (const coinType of coinTypes) {
        changeAddresses[coinType] = connection.address;
    }

    let submitResult: Awaited<ReturnType<typeof buildAndSubmitTransfer>>;
    try {
        submitResult = await buildAndSubmitTransfer({
            account,
            fromAddresses: [connection.address],
            toAddress: recipients[0]?.address || '',
            amount: recipients[0]?.amount || 0,
            coinType: recipients[0]?.coinType || 0,
            transferMode: mode,
            recipients,
            gas: Number(pending.request.gas || 0),
            extraGas: Number(pending.request.extraGas || 0),
            changeAddresses,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Transaction submit failed';
        await failPendingDappTransaction(account.accountId, pending, message);
        return { type: 'PANGU_RESPONSE', requestId, success: false, error: message };
    }

    if (!submitResult.success) {
        const error = submitResult.error || 'Transaction submit failed';
        await failPendingDappTransaction(account.accountId, pending, error);
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error,
        };
    }

    await clearDappPendingTransaction(account.accountId, pending.requestId);
    const responseData = { txId: submitResult.txId, mode, status: 'submitted' };
    const org = await getOrganization(account.accountId);
    if (submitResult.txId) {
        await saveDappTxWatch({
            accountId: account.accountId,
            txId: submitResult.txId,
            origin: pending.origin,
            mode,
            createdAt: Date.now(),
            requestId: pending.requestId,
        });
        if (org?.groupId) {
            scheduleBackgroundDappTxStatusWatch(account.accountId, submitResult.txId);
        }
    }

    const pendingResolver = pendingTransactions.get(pending.requestId);
    if (pendingResolver) {
        clearTimeout(pendingResolver.timeoutId);
        pendingTransactions.delete(pending.requestId);
        pendingResolver.resolve({
            type: 'PANGU_RESPONSE',
            requestId: pending.requestId,
            success: true,
            data: responseData,
        });
    }

    await broadcastDappEvent(pending.origin, {
        event: 'txStatus',
        origin: pending.origin,
        txId: submitResult.txId,
        status: 'submitted',
        mode,
    });

    return { type: 'PANGU_RESPONSE', requestId, success: true, data: responseData };
}

async function handleTxReject(requestId: string, payload: unknown): Promise<PanguResponse> {
    const account = await getActiveAccount();
    if (!account) {
        return { type: 'PANGU_RESPONSE', requestId, success: false, error: 'Wallet is not logged in' };
    }

    const data = payload as { requestId?: string } | null;
    if (!data?.requestId) {
        return { type: 'PANGU_RESPONSE', requestId, success: false, error: 'Transaction request expired' };
    }
    const pending = await getDappPendingTransactionById(account.accountId, data.requestId);
    if (!pending) {
        return { type: 'PANGU_RESPONSE', requestId, success: false, error: 'Transaction request expired' };
    }

    await clearDappPendingTransaction(account.accountId, pending.requestId);
    const pendingResolver = pendingTransactions.get(pending.requestId);
    if (pendingResolver) {
        clearTimeout(pendingResolver.timeoutId);
        pendingTransactions.delete(pending.requestId);
        pendingResolver.resolve({
            type: 'PANGU_RESPONSE',
            requestId: pending.requestId,
            success: false,
            error: 'User rejected transaction',
        });
    }

    return { type: 'PANGU_RESPONSE', requestId, success: true };
}

async function handleNotify(requestId: string, payload: unknown): Promise<PanguResponse> {
    const data = payload as {
        origin?: string;
        event?: string;
        address?: string;
        txId?: string;
        status?: string;
        mode?: string;
        error?: string;
    } | null;
    const origin = normalizeOrigin(data?.origin || '');
    if (!origin || !data?.event) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '缂哄皯绔欑偣淇℃伅',
        };
    }
    await broadcastDappEvent(origin, {
        event: data.event,
        origin,
        address: data.address || '',
        txId: data.txId || '',
        status: data.status || '',
        mode: data.mode || '',
        error: data.error || '',
    });
    return {
        type: 'PANGU_RESPONSE',
        requestId,
        success: true,
    };
}

async function broadcastDappEvent(
    origin: string,
    payload: { event: string; origin: string; address?: string; txId?: string; status?: string; mode?: string; error?: string }
): Promise<void> {
    if (!origin) return;
    const normalized = normalizeOrigin(origin);
    try {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            if (!tab.id) continue;
            try {
                await chrome.tabs.sendMessage(tab.id, {
                    type: 'PANGU_EVENT',
                    ...payload,
                    origin: normalized,
                });
            } catch {
                // ignore
            }
        }
    } catch {
        // ignore
    }
}

function buildDappTxWatchKey(accountId: string, txId: string): string {
    return `${accountId}:${String(txId || '').trim().toLowerCase()}`;
}

async function notifyDappTxWatchesInBackground(
    accountId: string,
    txId: string,
    status: 'success' | 'failed',
    options: { error?: string } = {}
): Promise<void> {
    const watches = await consumeDappTxWatches(accountId, txId);
    for (const watch of watches) {
        await broadcastDappEvent(watch.origin, {
            event: 'txStatus',
            origin: watch.origin,
            txId,
            status,
            mode: watch.mode || 'normal',
            error: options.error || '',
        });
    }
}

async function unlockFailedTransactionInputs(txId: string): Promise<void> {
    try {
        await unlockUTXOsByTxId(txId);
    } catch (error) {
        console.warn('[PanguPay] Failed to unlock UTXOs after DApp tx failure:', error);
    }
    try {
        const lockedTxCers = getLockedTXCerIdsByTxId(txId);
        if (lockedTxCers.length > 0) {
            unlockTXCers(lockedTxCers, false);
        }
    } catch (error) {
        console.warn('[PanguPay] Failed to unlock TXCers after DApp tx failure:', error);
    }
}

async function handleBackgroundDappTxStatus(
    accountId: string,
    txId: string,
    response: TXStatusResponse
): Promise<boolean> {
    if (response.status !== 'success' && response.status !== 'failed') return false;

    const finalStatus = response.status;
    const error = finalStatus === 'failed' ? response.error_reason || '' : '';
    await updateTransactionStatus(accountId, txId, finalStatus, {
        blockNumber: response.block_height || 0,
        failureReason: error || undefined,
    });
    await notifyDappTxWatchesInBackground(accountId, txId, finalStatus, { error });
    if (finalStatus === 'failed') {
        await unlockFailedTransactionInputs(txId);
    }
    return true;
}

function scheduleBackgroundDappTxStatusWatch(accountId: string, txId: string): void {
    if (!accountId || !txId) return;
    const watchKey = buildDappTxWatchKey(accountId, txId);
    if (backgroundDappTxWatchers.has(watchKey)) return;
    backgroundDappTxWatchers.add(watchKey);

    const startedAt = Date.now();
    const poll = async () => {
        try {
            const org = await getOrganization(accountId);
            if (!org?.groupId) {
                backgroundDappTxWatchers.delete(watchKey);
                return;
            }
            const endpoint = org.assignAPIEndpoint || org.assignNodeUrl || '';
            const assignUrl = endpoint ? buildAssignNodeUrl(endpoint) : undefined;
            const status = await queryTXStatus(txId, org.groupId, assignUrl);
            if (await handleBackgroundDappTxStatus(accountId, txId, status)) {
                backgroundDappTxWatchers.delete(watchKey);
                return;
            }
        } catch (error) {
            console.warn('[PanguPay] DApp tx status poll failed:', error);
        }

        if (Date.now() - startedAt >= DAPP_TX_STATUS_MAX_WAIT_MS) {
            backgroundDappTxWatchers.delete(watchKey);
            return;
        }
        setTimeout(poll, DAPP_TX_STATUS_POLL_INTERVAL_MS);
    };

    void poll();
}

async function pollSavedDappTxWatches(): Promise<void> {
    const watchesByAccount = await getDappTxWatches();
    for (const [accountId, watches] of Object.entries(watchesByAccount)) {
        const org = await getOrganization(accountId);
        if (!org?.groupId) continue;
        const endpoint = org.assignAPIEndpoint || org.assignNodeUrl || '';
        const assignUrl = endpoint ? buildAssignNodeUrl(endpoint) : undefined;

        for (const watch of watches) {
            const watchKey = buildDappTxWatchKey(accountId, watch.txId);
            if (backgroundDappTxWatchers.has(watchKey)) continue;
            try {
                const status = await queryTXStatus(watch.txId, org.groupId, assignUrl);
                await handleBackgroundDappTxStatus(accountId, watch.txId, status);
            } catch (error) {
                console.warn('[PanguPay] Saved DApp tx status poll failed:', error);
            }
        }
    }
}

async function handleSendTransaction(
    requestId: string,
    message: PanguMessage,
    sender: chrome.runtime.MessageSender
): Promise<PanguResponse> {
    const account = await getActiveAccount();
    if (!account || !(await hasActiveSession(account.accountId))) {
        return { type: 'PANGU_RESPONSE', requestId, success: false, error: 'Wallet is locked' };
    }

    const site = resolveSiteInfo(message, sender);
    if (!site.origin) {
        return { type: 'PANGU_RESPONSE', requestId, success: false, error: 'Cannot resolve site origin' };
    }

    const connection = await getDappConnection(account.accountId, site.origin);
    if (!connection?.address) {
        return { type: 'PANGU_RESPONSE', requestId, success: false, error: 'Site is not connected' };
    }

    const request = normalizeDappTxRequest(message.payload);
    if (!request.recipients || request.recipients.length === 0) {
        return { type: 'PANGU_RESPONSE', requestId, success: false, error: 'Transaction recipient is missing' };
    }

    await saveDappPendingTransaction({
        requestId,
        accountId: account.accountId,
        origin: site.origin,
        createdAt: Date.now(),
        title: site.title,
        icon: site.icon,
        request,
    });

    try {
        if (uiPort) {
            uiPort.postMessage({ type: 'PANGU_UI_TX_PENDING', accountId: account.accountId });
        } else {
            void chrome.runtime
                .sendMessage({ __pangu_ui: true, type: 'PANGU_UI_TX_PENDING', accountId: account.accountId })
                .catch(() => {});
        }
    } catch {
        // ignore
    }

    return new Promise((resolve) => {
        const timeoutId = setTimeout(async () => {
            pendingTransactions.delete(requestId);
            await clearDappPendingTransaction(account.accountId, requestId);
            resolve({ type: 'PANGU_RESPONSE', requestId, success: false, error: 'User did not confirm transaction' });
        }, CONNECT_TIMEOUT_MS);

        pendingTransactions.set(requestId, {
            accountId: account.accountId,
            origin: site.origin,
            timeoutId: timeoutId as unknown as number,
            resolve,
        });
    });
}
// ========================================
// 鑷姩閿佸畾
// ========================================

chrome.alarms.create('autoLock', { periodInMinutes: 1 });
chrome.alarms.create(DAPP_TX_STATUS_ALARM, { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'autoLock') {
        // 妫€鏌ユ槸鍚﹂渶瑕佽嚜鍔ㄩ攣瀹?
        // 鍙互鏍规嵁璁剧疆鐨勮嚜鍔ㄩ攣瀹氭椂闂存潵鍐冲畾
    }
    if (alarm.name === DAPP_TX_STATUS_ALARM) {
        void pollSavedDappTxWatches();
    }
});

// ========================================
// Install/update events
// ========================================

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('[PanguPay] 扩展已安装');
    } else if (details.reason === 'update') {
        console.log('[PanguPay] 扩展已更新到版本', chrome.runtime.getManifest().version);
    }
});

// 瀵煎嚭绌哄璞′娇鍏舵垚涓烘ā鍧?
export { };

