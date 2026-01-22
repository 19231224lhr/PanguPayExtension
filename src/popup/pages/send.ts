/**
 * 发送页面 - 转账交易
 */

import { getActiveAccount, getOrganization, saveTransaction, type TransactionRecord } from '../../core/storage';
import { COIN_NAMES, COIN_TYPES } from '../../core/types';
import { bindInlineHandlers } from '../utils/inlineHandlers';

let selectedCoinType = 0; // 默认 PGC
let selectedTransferMode: 'quick' | 'normal' | 'cross' = 'quick';

export async function renderSend(): Promise<void> {
    const app = document.getElementById('app');
    if (!app) return;

    const account = await getActiveAccount();
    if (!account) {
        (window as any).navigateTo('home');
        return;
    }

    const org = await getOrganization(account.accountId);
    const hasOrg = !!org;

    app.innerHTML = `
    <div class="page send-page">
      <header class="header">
        <button class="header-btn" onclick="navigateTo('home')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <span style="font-weight: 600;">发送</span>
        <div style="width: 32px;"></div>
      </header>
      
      <div class="page-content">
        <!-- 转账模式选择 -->
        <div class="tabs">
          <button class="tab ${selectedTransferMode === 'quick' ? 'active' : ''}" onclick="setTransferMode('quick')" ${!hasOrg ? 'disabled' : ''}>
            快速转账
          </button>
          <button class="tab ${selectedTransferMode === 'normal' ? 'active' : ''}" onclick="setTransferMode('normal')">
            普通转账
          </button>
          <button class="tab ${selectedTransferMode === 'cross' ? 'active' : ''}" onclick="setTransferMode('cross')">
            跨链
          </button>
        </div>

        ${!hasOrg && selectedTransferMode === 'quick' ? `
        <div class="card" style="border-color: var(--warning); margin-bottom: 16px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span>⚠️</span>
            <span style="font-size: 13px; color: var(--warning);">请先加入担保组织以使用快速转账</span>
          </div>
        </div>
        ` : ''}

        <form id="sendForm">
          <!-- 金额输入 -->
          <div class="amount-input-container">
            <input 
              type="number" 
              class="amount-input" 
              id="amount" 
              placeholder="0.00"
              step="0.01"
              min="0"
              required
            >
            <div class="amount-currency">
              <select id="coinType" class="btn btn-ghost btn-sm" style="border: 1px solid var(--border-color);">
                <option value="0" ${selectedCoinType === 0 ? 'selected' : ''}>PGC</option>
                <option value="1" ${selectedCoinType === 1 ? 'selected' : ''}>BTC</option>
                <option value="2" ${selectedCoinType === 2 ? 'selected' : ''}>ETH</option>
              </select>
            </div>
          </div>

          <!-- 可用余额 -->
          <div style="text-align: center; margin-bottom: 24px;">
            <span style="font-size: 12px; color: var(--text-muted);">
              可用余额: ${(account.totalBalance[selectedCoinType] || 0).toFixed(selectedCoinType === 0 ? 2 : 8)} ${COIN_NAMES[selectedCoinType as keyof typeof COIN_NAMES]}
            </span>
          </div>

          <!-- 收款地址 -->
          <div class="input-group">
            <label class="input-label">收款地址</label>
            <input 
              type="text" 
              class="input" 
              id="toAddress" 
              placeholder="输入收款方地址"
              required
              style="font-family: monospace; font-size: 12px;"
            >
          </div>

          <!-- 备注（可选）-->
          <div class="input-group">
            <label class="input-label">备注（可选）</label>
            <input 
              type="text" 
              class="input" 
              id="memo" 
              placeholder="添加备注信息"
            >
          </div>

          <!-- 手续费预估 -->
          <div class="card" style="margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; font-size: 13px;">
              <span style="color: var(--text-secondary);">预估手续费</span>
              <span>0.01 PGC</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 13px; margin-top: 8px;">
              <span style="color: var(--text-secondary);">到账时间</span>
              <span style="color: var(--success);">
                ${selectedTransferMode === 'quick' ? '即时到账' : selectedTransferMode === 'cross' ? '约 5-10 分钟' : '约 1-3 分钟'}
              </span>
            </div>
          </div>

          <button type="submit" class="btn btn-primary btn-block btn-lg">
            确认发送
          </button>
        </form>
      </div>
    </div>
  `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
        setTransferMode,
    });

    // 绑定事件
    const form = document.getElementById('sendForm') as HTMLFormElement;
    form.addEventListener('submit', handleSend);

    const coinSelect = document.getElementById('coinType') as HTMLSelectElement;
    coinSelect.addEventListener('change', (e) => {
        selectedCoinType = parseInt((e.target as HTMLSelectElement).value);
    });
}

function setTransferMode(mode: 'quick' | 'normal' | 'cross'): void {
    selectedTransferMode = mode;
    renderSend();
}

async function handleSend(e: Event): Promise<void> {
    e.preventDefault();

    const amount = parseFloat((document.getElementById('amount') as HTMLInputElement).value);
    const toAddress = (document.getElementById('toAddress') as HTMLInputElement).value.trim();
    const memo = (document.getElementById('memo') as HTMLInputElement).value.trim();

    if (!amount || amount <= 0) {
        (window as any).showToast('请输入有效金额', 'error');
        return;
    }

    if (!toAddress || toAddress.length !== 40) {
        (window as any).showToast('请输入有效的收款地址', 'error');
        return;
    }

    const account = await getActiveAccount();
    if (!account) {
        (window as any).showToast('账户未找到', 'error');
        return;
    }

    // 检查余额
    const balance = account.totalBalance[selectedCoinType] || 0;
    if (amount > balance) {
        (window as any).showToast('余额不足', 'error');
        return;
    }

    try {
        // 这里应该构造并提交交易
        // 目前先模拟成功
        const txRecord: TransactionRecord = {
            id: Date.now().toString(),
            type: 'send',
            status: 'pending',
            amount,
            coinType: selectedCoinType,
            from: account.mainAddress,
            to: toAddress,
            timestamp: Date.now(),
            txHash: 'tx_' + Date.now().toString(16),
        };

        await saveTransaction(account.accountId, txRecord);

        (window as any).showToast('交易已提交', 'success');

        setTimeout(() => {
            (window as any).navigateTo('history');
        }, 1000);
    } catch (error) {
        console.error('[发送] 失败:', error);
        (window as any).showToast('发送失败: ' + (error as Error).message, 'error');
    }
}
