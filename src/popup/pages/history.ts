/**
 * Transaction history page.
 */

import { getActiveAccount, getTransactionHistory, type TransactionRecord } from '../../core/storage';
import { COIN_NAMES } from '../../core/types';
import { getActiveLanguage } from '../utils/appSettings';
import { bindInlineHandlers } from '../utils/inlineHandlers';
import {
    bindNavigation,
    escapeAttr,
    escapeHtml,
    icon,
    renderBottomNav,
    renderEmptyState,
    renderHeaderBar,
    renderStatusBadge,
    shortAddress,
} from '../utils/ui';

const TEXT = {
    'zh-CN': {
        title: '交易历史',
        emptyTitle: '暂无交易记录',
        emptyDesc: '你的交易记录会显示在这里',
        sendNow: '发起转账',
        send: '发送',
        receive: '接收',
        to: '至',
        from: '来自',
        gas: 'Gas',
        status: {
            pending: '处理中',
            success: '成功',
            failed: '失败',
        },
        mode: {
            quick: '快速',
            cross: '跨组',
            normal: '普通',
            incoming: '入账',
            unknown: '未知',
        },
    },
    en: {
        title: 'Transaction History',
        emptyTitle: 'No transactions',
        emptyDesc: 'Your transactions will appear here',
        sendNow: 'Send',
        send: 'Send',
        receive: 'Receive',
        to: 'to',
        from: 'from',
        gas: 'Gas',
        status: {
            pending: 'Pending',
            success: 'Success',
            failed: 'Failed',
        },
        mode: {
            quick: 'Quick',
            cross: 'Cross',
            normal: 'Normal',
            incoming: 'Incoming',
            unknown: 'Unknown',
        },
    },
};

type HistoryText = (typeof TEXT)['zh-CN'];

function getText(): HistoryText {
    return getActiveLanguage() === 'en' ? TEXT.en : TEXT['zh-CN'];
}

export async function renderHistory(): Promise<void> {
    const app = document.getElementById('app');
    if (!app) return;

    const language = getActiveLanguage();
    const t = getText();
    const account = await getActiveAccount();
    if (!account) {
        (window as any).navigateTo('home');
        return;
    }

    const history = await getTransactionHistory(account.accountId);

    app.innerHTML = `
      <div class="page history-page">
        ${renderHeaderBar({ title: t.title, backPage: 'home' })}
        <div class="page-content">
          ${
              history.length === 0
                  ? renderEmptyState({
                        title: t.emptyTitle,
                        description: t.emptyDesc,
                        iconName: 'history',
                        actionsHtml: `<button class="btn btn-primary btn-block" type="button" onclick="navigateTo('send')">${escapeHtml(t.sendNow)}</button>`,
                    })
                  : `<div class="history-list">${history.map((tx) => renderTransactionItem(tx, t, language)).join('')}</div>`
          }
        </div>
        ${renderBottomNav('history', language)}
      </div>
    `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
        copyTxHash,
    });
    bindNavigation(app);

    const listenerKey = '__pangu_history_listener';
    const refreshKey = '__pangu_history_refreshing';
    const existing = (window as any)[listenerKey] as EventListener | undefined;
    if (existing) {
        window.removeEventListener('pangu_tx_history_updated', existing);
    }

    const handler = () => {
        if ((window as any).__currentPage !== 'history') return;
        if ((window as any)[refreshKey]) return;
        (window as any)[refreshKey] = true;
        setTimeout(() => {
            (window as any)[refreshKey] = false;
            renderHistory().catch((error) => {
                console.error('[History] refresh failed:', error);
            });
        }, 60);
    };

    window.addEventListener('pangu_tx_history_updated', handler);
    (window as any)[listenerKey] = handler;
}

function renderTransactionItem(tx: TransactionRecord, t: HistoryText, language: 'zh-CN' | 'en'): string {
    const isSend = tx.type === 'send';
    const statusTone = tx.status === 'success' ? 'success' : tx.status === 'failed' ? 'danger' : 'warning';
    const statusText = t.status[tx.status];
    const coinName = tx.currency || COIN_NAMES[tx.coinType as keyof typeof COIN_NAMES] || 'PGC';
    const modeKey = tx.transferMode || 'unknown';
    const modeLabel = t.mode[modeKey as keyof typeof t.mode] || t.mode.unknown;
    const time = new Date(tx.timestamp).toLocaleString(language === 'en' ? 'en-US' : 'zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
    const peer = isSend ? tx.to : tx.from;
    const txHash = tx.txHash || tx.id || '';

    return `
      <article class="history-item">
        <div class="history-icon history-icon--${isSend ? 'send' : 'receive'}">
          ${icon(isSend ? 'send' : 'receive', 18)}
        </div>
        <div class="history-main">
          <div class="history-title-row">
            <span class="history-title">${escapeHtml(isSend ? t.send : t.receive)}</span>
            ${renderStatusBadge(statusText, statusTone)}
          </div>
          <div class="history-subtitle">${escapeHtml(isSend ? t.to : t.from)} ${escapeHtml(shortAddress(peer, 8, 5))}</div>
          <div class="history-meta">
            <span>${escapeHtml(modeLabel)}</span>
            <span>${escapeHtml(time)}</span>
            ${txHash ? `<button class="history-copy" type="button" onclick="copyTxHash('${escapeAttr(txHash)}')">${escapeHtml(shortAddress(txHash, 8, 5))}</button>` : ''}
          </div>
          ${tx.status === 'failed' && tx.failureReason ? `<details class="history-failure"><summary>${escapeHtml(t.status.failed)}</summary><div>${escapeHtml(tx.failureReason)}</div></details>` : ''}
        </div>
        <div class="history-value">
          <div class="history-amount ${isSend ? 'negative' : 'positive'}">${isSend ? '-' : '+'}${escapeHtml(formatHistoryAmount(tx.amount, tx.coinType))}</div>
          <div class="history-coin">${escapeHtml(coinName)}</div>
          ${tx.gas ? `<div class="history-gas">${escapeHtml(t.gas)} ${escapeHtml(String(tx.gas))}</div>` : ''}
        </div>
      </article>
    `;
}

function formatHistoryAmount(amount: number, coinType: number): string {
    const decimals = coinType === 0 ? 2 : 6;
    return Number(amount || 0).toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function copyTxHash(txHash: string): void {
    if (!txHash) return;
    navigator.clipboard.writeText(txHash).then(() => {
        (window as any).showToast('TXID copied', 'success');
    });
}
