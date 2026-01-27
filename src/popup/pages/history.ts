/**
 * 历史记录页面
 */

import { getActiveAccount, getTransactionHistory, type TransactionRecord } from '../../core/storage';
import { COIN_NAMES } from '../../core/types';
import { getActiveLanguage } from '../utils/appSettings';
import { bindInlineHandlers } from '../utils/inlineHandlers';

const TEXT = {
    'zh-CN': {
        title: '交易历史',
        emptyTitle: '暂无交易记录',
        emptyDesc: '您的交易记录将显示在这里',
        navHome: '首页',
        navHistory: '历史',
        navOrg: '组织',
        navSettings: '设置',
        send: '发送',
        receive: '接收',
        to: '至',
        from: '来自',
        status: {
            pending: '处理中',
            success: '成功',
            failed: '失败',
        },
    },
    en: {
        title: 'Transaction History',
        emptyTitle: 'No transactions',
        emptyDesc: 'Your transactions will appear here',
        navHome: 'Home',
        navHistory: 'History',
        navOrg: 'Org',
        navSettings: 'Settings',
        send: 'Send',
        receive: 'Receive',
        to: 'to',
        from: 'from',
        status: {
            pending: 'Pending',
            success: 'Success',
            failed: 'Failed',
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

    const t = getText();

    const account = await getActiveAccount();
    if (!account) {
        (window as any).navigateTo('home');
        return;
    }

    const history = await getTransactionHistory(account.accountId);

    app.innerHTML = `
    <div class="page">
      <header class="header">
        <button class="header-btn" onclick="navigateTo('home')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <span style="font-weight: 600;">${t.title}</span>
        <div style="width: 32px;"></div>
      </header>
      
      <div class="page-content">
        ${history.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </div>
          <div class="empty-title">${t.emptyTitle}</div>
          <div class="empty-desc">${t.emptyDesc}</div>
        </div>
        ` : `
        <div class="list-section">
          ${history.map(tx => renderTransactionItem(tx, t)).join('')}
        </div>
        `}
      </div>

      <!-- 底部导航 -->
      <nav class="bottom-nav">
        <button class="nav-item" onclick="navigateTo('home')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
            <polyline points="9 22 9 12 15 12 15 22"></polyline>
          </svg>
          <span>${t.navHome}</span>
        </button>
        <button class="nav-item active" onclick="navigateTo('history')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <span>${t.navHistory}</span>
        </button>
        <button class="nav-item" onclick="navigateTo('organization')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="9" cy="7" r="4"></circle>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path>
          </svg>
          <span>${t.navOrg}</span>
        </button>
        <button class="nav-item" onclick="navigateTo('settings')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
          <span>${t.navSettings}</span>
        </button>
      </nav>
    </div>
  `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
    });

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
                console.error('[History] 刷新失败:', error);
            });
        }, 60);
    };

    window.addEventListener('pangu_tx_history_updated', handler);
    (window as any)[listenerKey] = handler;
}

function renderTransactionItem(tx: TransactionRecord, t: HistoryText): string {
    const isSend = tx.type === 'send';
    const statusText = t.status[tx.status];
    const statusColor = {
        pending: 'var(--warning)',
        success: 'var(--success)',
        failed: 'var(--error)',
    }[tx.status];

    const coinName = tx.currency || COIN_NAMES[tx.coinType as keyof typeof COIN_NAMES] || 'PGC';
    const time = new Date(tx.timestamp).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });

    const shortAddress = isSend
        ? tx.to.slice(0, 8) + '...' + tx.to.slice(-4)
        : tx.from.slice(0, 8) + '...' + tx.from.slice(-4);
    const modeLabel = (() => {
        switch (tx.transferMode) {
            case 'quick':
                return t.navHistory === 'History' ? 'Quick' : '快速';
            case 'cross':
                return t.navHistory === 'History' ? 'Cross' : '跨链';
            case 'normal':
                return t.navHistory === 'History' ? 'Normal' : '普通';
            case 'incoming':
                return t.navHistory === 'History' ? 'Incoming' : '入账';
            default:
                return t.navHistory === 'History' ? 'Unknown' : '未知';
        }
    })();
    const gasLabel = tx.gas ? `Gas ${tx.gas}` : '';
    const failureNote = tx.status === 'failed' && tx.failureReason ? tx.failureReason : '';

    return `
    <div class="list-item">
      <div class="list-item-icon" style="background: ${isSend ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)'}; color: ${isSend ? 'var(--error)' : 'var(--success)'};">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          ${isSend
            ? '<line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline>'
            : '<line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline>'
        }
        </svg>
      </div>
      <div class="list-item-content">
        <div class="list-item-title">${isSend ? t.send : t.receive}</div>
        <div class="list-item-subtitle">
          ${isSend ? t.to : t.from} ${shortAddress}
          <span class="tag tag--neutral">${modeLabel}</span>
        </div>
        ${failureNote ? `<div class="list-item-note">${failureNote}</div>` : ''}
      </div>
      <div class="list-item-value">
        <div class="list-item-amount ${isSend ? 'negative' : 'positive'}">
          ${isSend ? '-' : '+'}${tx.amount.toFixed(tx.coinType === 0 ? 2 : 6)} ${coinName}
        </div>
        <div class="list-item-time" style="color: ${statusColor};">${statusText} · ${time}</div>
        ${gasLabel ? `<div class="list-item-time">${gasLabel}</div>` : ''}
      </div>
    </div>
  `;
}
