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
    getDefaultWalletAddress,
    isUnlocked,
    clearSession,
    getOrganization,
    saveTransaction,
    hydrateSession,
} from '../core/storage';
import type { PanguMessage, PanguResponse } from '../core/types';

// ========================================
// 消息处理
// ========================================

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
            return handleConnect(requestId);

        case 'PANGU_DISCONNECT':
            return handleDisconnect(requestId);

        case 'PANGU_GET_ACCOUNT':
            return handleGetAccount(requestId);

        case 'PANGU_SEND_TRANSACTION':
            return handleSendTransaction(requestId, message.payload);

        default:
            return {
                type: 'PANGU_RESPONSE',
                requestId,
                success: false,
                error: '未知的消息类型',
            };
    }
}

async function handleConnect(requestId: string): Promise<PanguResponse> {
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

    if (!isUnlocked()) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '请先解锁钱包',
        };
    }

    const walletAddress = getDefaultWalletAddress(account);
    if (!walletAddress) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '请先在钱包管理中添加地址',
        };
    }

    return {
        type: 'PANGU_RESPONSE',
        requestId,
        success: true,
        data: {
            address: walletAddress.address,
            accountId: account.accountId,
        },
    };
}

async function handleDisconnect(requestId: string): Promise<PanguResponse> {
    clearSession();
    return {
        type: 'PANGU_RESPONSE',
        requestId,
        success: true,
    };
}

async function handleGetAccount(requestId: string): Promise<PanguResponse> {
    const account = await getActiveAccount();

    if (!account || !isUnlocked()) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '未登录或未解锁',
        };
    }

    const walletAddress = getDefaultWalletAddress(account);
    if (!walletAddress) {
        return {
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: '请先在钱包管理中添加地址',
        };
    }

    const org = await getOrganization(account.accountId);

    return {
        type: 'PANGU_RESPONSE',
        requestId,
        success: true,
        data: {
            address: walletAddress.address,
            accountId: account.accountId,
            balance: account.totalBalance,
            organization: org?.groupName || null,
        },
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
