/**
 * DApp transaction confirmation page.
 */

import {
    getActiveAccount,
    getDappConnection,
    getDappPendingTransactions,
    getSettings,
    type DappPendingTransaction,
} from '../../core/storage';
import {
    bindNavigation,
    coinLabel,
    escapeHtml,
    icon,
    renderDappSiteCard,
    renderEmptyState,
    renderHeaderBar,
    renderNotice,
    renderStatusBadge,
    shortAddress,
} from '../utils/ui';

type TxText = {
    title: string;
    emptyTitle: string;
    emptyDesc: string;
    backHome: string;
    mode: string;
    source: string;
    recipients: string;
    totals: string;
    gas: string;
    reject: string;
    approve: string;
    submitting: string;
    rejected: string;
    submitted: string;
    failed: string;
    riskTitle: string;
    riskDesc: string;
    pendingMore: (count: number) => string;
};

const TEXT: Record<'zh-CN' | 'en', TxText> = {
    'zh-CN': {
        title: '确认交易',
        emptyTitle: '没有待确认交易',
        emptyDesc: '当前没有来自 DApp 的交易请求',
        backHome: '返回首页',
        mode: '交易模式',
        source: '来源地址',
        recipients: '收款方',
        totals: '币种合计',
        gas: 'Gas',
        reject: '拒绝',
        approve: '确认并提交交易',
        submitting: '提交中...',
        rejected: '已拒绝交易',
        submitted: '交易已提交',
        failed: '交易失败',
        riskTitle: '请确认站点可信',
        riskDesc: 'DApp 将请求插件构造并提交链上交易，请逐项核对收款地址、币种、金额和 Gas。',
        pendingMore: (count) => `还有 ${count} 个待处理交易请求`,
    },
    en: {
        title: 'Confirm Transaction',
        emptyTitle: 'No pending transaction',
        emptyDesc: 'There is no transaction request from a DApp.',
        backHome: 'Back Home',
        mode: 'Mode',
        source: 'Source Address',
        recipients: 'Recipients',
        totals: 'Totals By Coin',
        gas: 'Gas',
        reject: 'Reject',
        approve: 'Confirm & Submit',
        submitting: 'Submitting...',
        rejected: 'Transaction rejected',
        submitted: 'Transaction submitted',
        failed: 'Transaction failed',
        riskTitle: 'Verify this site first',
        riskDesc: 'The DApp is asking the wallet to build and submit an on-chain transaction. Check every recipient, coin, amount and gas value.',
        pendingMore: (count) => `${count} more pending transaction request(s)`,
    },
};

interface RecipientView {
    to: string;
    amount: number;
    coinType: number;
}

function getRecipients(pending: DappPendingTransaction): RecipientView[] {
    const request = pending.request || {};
    if (request.recipients?.length) {
        return request.recipients.map((recipient) => ({
            to: recipient.to,
            amount: Number(recipient.amount || 0),
            coinType: Number(recipient.coinType ?? request.coinType ?? 0),
        }));
    }
    return [{
        to: request.to || '',
        amount: Number(request.amount || 0),
        coinType: Number(request.coinType ?? 0),
    }];
}

function formatMode(mode: string, language: 'zh-CN' | 'en'): string {
    const normalized = mode || 'normal';
    if (language === 'en') {
        return normalized === 'quick' ? 'Quick' : normalized === 'cross' ? 'Cross-org' : 'Normal';
    }
    return normalized === 'quick' ? '快速转账' : normalized === 'cross' ? '跨组转账' : '普通转账';
}

function formatAmount(value: number): string {
    if (!Number.isFinite(value)) return '0';
    return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function getTotals(recipients: RecipientView[]): Array<{ coinType: number; amount: number }> {
    const totals = new Map<number, number>();
    recipients.forEach((recipient) => {
        totals.set(recipient.coinType, (totals.get(recipient.coinType) || 0) + Number(recipient.amount || 0));
    });
    return Array.from(totals.entries()).map(([coinType, amount]) => ({ coinType, amount }));
}

function renderRecipientList(recipients: RecipientView[]): string {
    return `
      <div class="summary-list">
        ${recipients
            .map((recipient, index) => `
          <div class="summary-item">
            <div class="summary-item-title">${index + 1}. ${formatAmount(recipient.amount)} ${escapeHtml(coinLabel(recipient.coinType))}</div>
            <div class="summary-item-sub">${escapeHtml(recipient.to || '--')}</div>
          </div>
        `)
            .join('')}
      </div>
    `;
}

function renderTotals(recipients: RecipientView[]): string {
    const totals = getTotals(recipients);
    return `
      <div class="summary-list">
        ${totals
            .map((total) => `
          <div class="summary-item summary-item--total">
            <div class="summary-row">
              <span>${escapeHtml(coinLabel(total.coinType))}</span>
              <strong>${formatAmount(total.amount)} ${escapeHtml(coinLabel(total.coinType))}</strong>
            </div>
          </div>
        `)
            .join('')}
      </div>
    `;
}

export async function renderDappTransaction(): Promise<void> {
    const app = document.getElementById('app');
    if (!app) return;

    const settings = await getSettings();
    const language = settings.language;
    const t = TEXT[language] || TEXT['zh-CN'];
    const account = await getActiveAccount();
    const pendingList = account ? await getDappPendingTransactions(account.accountId) : [];
    const pending = pendingList[0] || null;

    if (!account || !pending) {
        app.innerHTML = `
          <div class="page dapp-transaction">
            ${renderHeaderBar({ title: t.title, backPage: 'home' })}
            <div class="page-content">
              ${renderEmptyState({
                  title: t.emptyTitle,
                  description: t.emptyDesc,
                  iconName: 'send',
                  actionsHtml: `<button class="btn btn-primary btn-block" type="button" data-nav="home">${escapeHtml(t.backHome)}</button>`,
              })}
            </div>
          </div>
        `;
        bindNavigation(app);
        return;
    }

    const recipients = getRecipients(pending);
    const siteName = pending.title || pending.origin;
    const mode = pending.request.mode || 'normal';
    const connection = await getDappConnection(account.accountId, pending.origin);
    const sourceAddress = connection?.address || '';
    const gas = Number(pending.request.gas || 0) + Number(pending.request.extraGas || 0);

    app.innerHTML = `
      <div class="page dapp-transaction">
        ${renderHeaderBar({ title: t.title, backPage: 'home' })}
        <div class="page-content">
          ${renderDappSiteCard({
              title: siteName,
              origin: pending.origin,
              iconUrl: pending.icon,
              hint: t.riskDesc,
              badge: formatMode(mode, language),
          })}

          ${pendingList.length > 1 ? `<div class="queue-hint">${escapeHtml(t.pendingMore(pendingList.length - 1))}</div>` : ''}

          <section class="card review-panel">
            <div class="section-heading">${escapeHtml(t.mode)} ${renderStatusBadge(formatMode(mode, language), 'primary')}</div>
            <div class="summary-row">
              <span>${escapeHtml(t.source)}</span>
              <strong title="${escapeHtml(sourceAddress)}">${escapeHtml(sourceAddress ? shortAddress(sourceAddress) : '--')}</strong>
            </div>
          </section>

          <section class="card review-panel">
            <div class="section-heading">${icon('receive', 16)}<span>${escapeHtml(t.recipients)}</span></div>
            ${renderRecipientList(recipients)}
          </section>

          <section class="card review-panel">
            <div class="section-heading">${escapeHtml(t.totals)}</div>
            ${renderTotals(recipients)}
            <div class="summary-row">
              <span>${escapeHtml(t.gas)}</span>
              <strong>${formatAmount(gas)}</strong>
            </div>
          </section>

          ${renderNotice('warning', t.riskTitle, t.riskDesc)}

          <div class="dapp-connect-footer">
            <button class="btn btn-secondary btn-block" id="dappTxRejectBtn" type="button">${escapeHtml(t.reject)}</button>
            <button class="btn btn-primary btn-block" id="dappTxApproveBtn" type="button">${escapeHtml(t.approve)}</button>
          </div>
        </div>
      </div>
    `;

    bindNavigation(app);

    const approveBtn = document.getElementById('dappTxApproveBtn') as HTMLButtonElement | null;
    const rejectBtn = document.getElementById('dappTxRejectBtn') as HTMLButtonElement | null;

    rejectBtn?.addEventListener('click', async () => {
        rejectBtn.disabled = true;
        await chrome.runtime.sendMessage({
            type: 'PANGU_DAPP_TX_REJECT',
            payload: { requestId: pending.requestId },
        });
        (window as any).showToast(t.rejected, 'info');
        const remaining = await getDappPendingTransactions(account.accountId);
        if (remaining.length > 0) {
            await renderDappTransaction();
        } else {
            (window as any).navigateTo('home');
        }
    });

    approveBtn?.addEventListener('click', async () => {
        approveBtn.disabled = true;
        approveBtn.innerHTML = `${icon('send', 16)}<span>${escapeHtml(t.submitting)}</span>`;
        const response = await chrome.runtime.sendMessage({
            type: 'PANGU_DAPP_TX_APPROVE',
            payload: { requestId: pending.requestId },
        });
        if (response?.success) {
            (window as any).showToast(t.submitted, 'success');
            (window as any).navigateTo('home');
        } else {
            approveBtn.disabled = false;
            approveBtn.textContent = t.approve;
            (window as any).showToast(response?.error || t.failed, 'error', t.failed);
            await renderDappTransaction();
        }
    });
}

