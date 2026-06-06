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
    getOnboardingStep,
    type DappPendingTransaction,
    type DappTransactionRequest,
} from '../core/storage';
import type { PanguMessage, PanguResponse } from '../core/types';
import { buildAndSubmitTransfer, type TransferMode, type TransferRecipient } from '../core/transfer';
import { queryAddressGroupInfo } from '../core/address';

// ========================================
// 娑堟伅澶勭悊
// ========================================

const CONNECT_TIMEOUT_MS = 120000;
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
    const out: TransferRecipient[] = [];
    for (const recipient of recipients) {
        const query = await queryAddressGroupInfo(recipient.to);
        const meta = query.success ? query.data : undefined;
        const publicKey = recipient.publicKey || (meta?.publicKey ? `${meta.publicKey.x},${meta.publicKey.y}` : '');
        out.push({
            address: recipient.to,
            amount: Number(recipient.amount || 0),
            coinType: Number(recipient.coinType ?? request.coinType ?? meta?.type ?? 0),
            publicKey,
            orgId: recipient.orgId || meta?.groupId || '',
            seedAnchor: meta?.seedAnchor,
            seedChainStep: meta?.seedChainStep,
            defaultSpendAlgorithm: meta?.defaultSpendAlgorithm,
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
    if (org?.groupId && submitResult.txId) {
        await saveDappTxWatch({
            accountId: account.accountId,
            txId: submitResult.txId,
            origin: pending.origin,
            mode,
            createdAt: Date.now(),
            requestId: pending.requestId,
        });
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

function normalizeDappTxRequest(payload: unknown): DappTransactionRequest {
    const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
    const recipients = Array.isArray(raw.recipients)
        ? raw.recipients
              .map((item) => {
                  const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
                  return {
                      to: String(entry.to || entry.address || '').trim(),
                      amount: Number(entry.amount || 0),
                      coinType: Number(entry.coinType ?? raw.coinType ?? 0),
                      publicKey: entry.publicKey ? String(entry.publicKey) : undefined,
                      orgId: entry.orgId ? String(entry.orgId) : undefined,
                  };
              })
              .filter((item) => item.to && item.amount > 0)
        : [];

    if (recipients.length === 0 && raw.to && Number(raw.amount || 0) > 0) {
        recipients.push({
            to: String(raw.to).trim(),
            amount: Number(raw.amount || 0),
            coinType: Number(raw.coinType ?? 0),
            publicKey: raw.publicKey ? String(raw.publicKey) : undefined,
            orgId: raw.orgId ? String(raw.orgId) : undefined,
        });
    }

    const mode = raw.mode === 'cross' || raw.mode === 'quick' || raw.mode === 'normal' ? raw.mode : 'normal';

    return {
        to: raw.to ? String(raw.to) : undefined,
        amount: raw.amount != null ? Number(raw.amount) : undefined,
        coinType: Number(raw.coinType ?? 0),
        mode,
        gas: Number(raw.gas ?? 0),
        extraGas: Number(raw.extraGas ?? 0),
        publicKey: raw.publicKey ? String(raw.publicKey) : undefined,
        orgId: raw.orgId ? String(raw.orgId) : undefined,
        recipients,
    };
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

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'autoLock') {
        // 妫€鏌ユ槸鍚﹂渶瑕佽嚜鍔ㄩ攣瀹?
        // 鍙互鏍规嵁璁剧疆鐨勮嚜鍔ㄩ攣瀹氭椂闂存潵鍐冲畾
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

