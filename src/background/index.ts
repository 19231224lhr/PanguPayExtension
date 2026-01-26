/**
 * Background Service Worker
 * 
 * 扩展后台脚本，处理：
 * - 消息通信
 * - 状态管理
 * - 定时任务
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
    clearDappPendingConnection,
    getOnboardingStep,
} from '../core/storage';
import type { PanguMessage, PanguResponse } from '../core/types';

// ========================================
// 消息处理
// ========================================

const CONNECT_TIMEOUT_MS = 120000;

type PendingConnect = {
    accountId: string;
    origin: string;
    timeoutId: number;
    resolve: (response: PanguResponse) => void;
};

const pendingConnects = new Map<string, PendingConnect>();

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

    const url = chrome.runtime.getURL('src/popup/index.html');
    try {
        await chrome.windows.create({
            url,
            type: 'popup',
            width: 380,
            height: 640,
        });
    } catch (error) {
        console.warn('[PanguPay] 无法打开弹窗:', error);
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
        .then(sendResponse)
        .catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
    return true; // 保持消息通道打开
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

        case 'PANGU_DISCONNECT':
            return handleDisconnect(requestId, message, _sender);

        case 'PANGU_GET_ACCOUNT':
            return handleGetAccount(requestId, message, _sender);

        case 'PANGU_SEND_TRANSACTION':
            return handleSendTransaction(requestId, message.payload);

        case 'PANGU_DAPP_GET_PENDING':
            return handleGetPending(requestId);

        case 'PANGU_DAPP_APPROVE':
            return handleApprove(requestId, message.payload);

        case 'PANGU_DAPP_REJECT':
            return handleReject(requestId, message.payload);

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
        // 打开 popup 让用户登录
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

    void openPopupWindow();

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

async function handleDisconnect(
    requestId: string,
    message: PanguMessage,
    sender: chrome.runtime.MessageSender
): Promise<PanguResponse> {
    const account = await getActiveAccount();
    const site = resolveSiteInfo(message, sender);

    if (account && site.origin) {
        await removeDappConnection(account.accountId, site.origin);
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
    const pending = await getDappPendingConnection(account.accountId);
    if (!pending || !data?.requestId || pending.requestId !== data.requestId) {
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
    const pending = await getDappPendingConnection(account.accountId);
    if (!pending || !data?.requestId || pending.requestId !== data.requestId) {
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

async function handleSendTransaction(
    requestId: string,
    _payload: unknown
): Promise<PanguResponse> {
    // 交易需要用户确认，打开 popup
    // 这里返回需要确认的提示
    return {
        type: 'PANGU_RESPONSE',
        requestId,
        success: false,
        error: '请在钱包弹窗中确认交易',
    };
}

// ========================================
// 自动锁定
// ========================================

chrome.alarms.create('autoLock', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'autoLock') {
        // 检查是否需要自动锁定
        // 可以根据设置的自动锁定时间来决定
    }
});

// ========================================
// 安装/更新事件
// ========================================

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('[PanguPay] 扩展已安装');
    } else if (details.reason === 'update') {
        console.log('[PanguPay] 扩展已更新到版本', chrome.runtime.getManifest().version);
    }
});

// 导出空对象使其成为模块
export { };
