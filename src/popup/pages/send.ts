/**
 * 发送页面 - 转账交易
 */

import { getActiveAccount, getDefaultWalletAddress, getOrganization, getWalletAddresses, saveTransaction, type TransactionRecord } from '../../core/storage';
import { COIN_NAMES } from '../../core/types';
import { bindInlineHandlers } from '../utils/inlineHandlers';

let selectedCoinType = 0; // 默认 PGC
let selectedTransferMode: 'quick' | 'normal' | 'cross' = 'quick';
let selectedSourceAddresses = new Set<string>();
let selectionTouched = false;
let lastCoinType = selectedCoinType;
let currentCoinAddresses: Array<{ address: string; balance: number; type: number }> = [];

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
    const walletAddress = getDefaultWalletAddress(account);

    if (!walletAddress) {
        (window as any).showToast('请先添加钱包地址', 'info');
        (window as any).navigateTo('walletManager');
        return;
    }

    const walletAddresses = getWalletAddresses(account);
    const coinAddresses = walletAddresses.filter((addr) => addr.type === selectedCoinType);
    syncSelectionForCoin(coinAddresses);
    currentCoinAddresses = coinAddresses.map((item) => ({
        address: item.address,
        balance: item.balance,
        type: item.type,
    }));
    const selectedBalance = getSelectedBalance();
    const displayDecimals = selectedCoinType === 0 ? 2 : selectedCoinType === 1 ? 8 : 6;

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
          <!-- 来源地址 -->
          <div class="source-selector">
            <div class="source-selector-header">
              <div>
                <div class="input-label" style="margin-bottom: 4px;">来源地址</div>
                <div class="source-selector-meta">
                  已选 <span id="sourceSelectedCount">0</span> / ${coinAddresses.length}
                </div>
              </div>
              <div class="source-selector-actions">
                <button type="button" class="btn btn-ghost btn-sm" onclick="selectAllSources()">全选</button>
                <button type="button" class="btn btn-ghost btn-sm" onclick="clearSourceSelection()">清空</button>
              </div>
            </div>

            <div class="source-address-list">
              ${coinAddresses.length === 0 ? `
                <div class="empty-state" style="padding: 16px;">
                  <div class="empty-desc">当前币种暂无可用地址</div>
                </div>
              ` : coinAddresses.map((addr) => renderSourceAddressRow(addr.address, addr.balance, addr.type)).join('')}
            </div>

            <div class="source-balance">
              <span id="sourceBalanceLabel">${selectedSourceAddresses.size ? '可用余额' : '请选择来源地址'}</span>
              <span id="sourceAvailableBalance">${selectedSourceAddresses.size ? `${selectedBalance.toFixed(displayDecimals)} ${COIN_NAMES[selectedCoinType as keyof typeof COIN_NAMES]}` : '--'}</span>
            </div>
          </div>

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
              当前币种总余额: ${(account.totalBalance[selectedCoinType] || 0).toFixed(selectedCoinType === 0 ? 2 : 8)} ${COIN_NAMES[selectedCoinType as keyof typeof COIN_NAMES]}
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
        toggleSourceAddress,
        selectAllSources,
        clearSourceSelection,
    });

    // 绑定事件
    const form = document.getElementById('sendForm') as HTMLFormElement;
    form.addEventListener('submit', handleSend);

    const coinSelect = document.getElementById('coinType') as HTMLSelectElement;
    coinSelect.addEventListener('change', (e) => {
        selectedCoinType = parseInt((e.target as HTMLSelectElement).value);
        renderSend();
    });

    updateSourceSummary();
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

    const selectedAddresses = getSelectedAddresses();
    if (selectedAddresses.length === 0) {
        (window as any).showToast('请选择来源地址', 'error');
        return;
    }

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
    const balance = getSelectedBalance();
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
            from: selectedAddresses[0]?.address || account.mainAddress,
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

function renderSourceAddressRow(address: string, balance: number, coinType: number): string {
    const isSelected = selectedSourceAddresses.has(address);
    const displayDecimals = coinType === 0 ? 2 : coinType === 1 ? 8 : 6;
    const shortAddress = address.slice(0, 8) + '...' + address.slice(-6);

    return `
      <button type="button" class="source-address-item ${isSelected ? 'selected' : ''}" data-source-address="${address}" onclick="toggleSourceAddress('${address}')" aria-pressed="${isSelected}">
        <div class="source-address-check">
          <span class="checkmark"></span>
        </div>
        <div class="source-address-info">
          <div class="source-address-text">${shortAddress}</div>
          <div class="source-address-sub">${address}</div>
        </div>
        <div class="source-address-meta">
          <div class="source-address-balance">${(balance || 0).toFixed(displayDecimals)}</div>
          <div class="source-address-coin">${COIN_NAMES[coinType as keyof typeof COIN_NAMES]}</div>
        </div>
      </button>
    `;
}

function syncSelectionForCoin(coinAddresses: Array<{ address: string; balance: number; type: number }>): void {
    if (lastCoinType !== selectedCoinType) {
        selectedSourceAddresses = new Set<string>();
        selectionTouched = false;
        lastCoinType = selectedCoinType;
    }

    const prefill = (window as any).__sendSourceAddresses as string[] | undefined;
    if (prefill && prefill.length) {
        selectedSourceAddresses = new Set(prefill);
        selectionTouched = true;
        (window as any).__sendSourceAddresses = null;
    }

    const validSet = new Set(coinAddresses.map((addr) => addr.address));
    for (const addr of Array.from(selectedSourceAddresses)) {
        if (!validSet.has(addr)) {
            selectedSourceAddresses.delete(addr);
        }
    }

    if (!selectionTouched && selectedSourceAddresses.size === 0 && coinAddresses.length > 0) {
        coinAddresses.forEach((addr) => selectedSourceAddresses.add(addr.address));
    }
}

function toggleSourceAddress(address: string): void {
    selectionTouched = true;
    if (selectedSourceAddresses.has(address)) {
        selectedSourceAddresses.delete(address);
    } else {
        selectedSourceAddresses.add(address);
    }
    updateSourceListSelection();
    updateSourceSummary();
}

function selectAllSources(): void {
    selectionTouched = true;
    selectedSourceAddresses = new Set(currentCoinAddresses.map((addr) => addr.address));
    updateSourceListSelection();
    updateSourceSummary();
}

function clearSourceSelection(): void {
    selectionTouched = true;
    selectedSourceAddresses.clear();
    updateSourceListSelection();
    updateSourceSummary();
}

function updateSourceListSelection(): void {
    currentCoinAddresses.forEach((addr) => {
        const row = document.querySelector<HTMLElement>(`[data-source-address="${addr.address}"]`);
        if (!row) return;
        const selected = selectedSourceAddresses.has(addr.address);
        row.classList.toggle('selected', selected);
        row.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
}

function getSelectedAddresses(): Array<{ address: string; balance: number; type: number }> {
    return currentCoinAddresses.filter((addr) => selectedSourceAddresses.has(addr.address));
}

function getSelectedBalance(): number {
    return getSelectedAddresses().reduce((sum, addr) => sum + (addr.balance || 0), 0);
}

function updateSourceSummary(): void {
    const selectedCountEl = document.getElementById('sourceSelectedCount');
    const balanceLabelEl = document.getElementById('sourceBalanceLabel');
    const balanceValueEl = document.getElementById('sourceAvailableBalance');

    const selectedAddresses = getSelectedAddresses();
    const displayDecimals = selectedCoinType === 0 ? 2 : selectedCoinType === 1 ? 8 : 6;
    const balance = selectedAddresses.reduce((sum, addr) => sum + (addr.balance || 0), 0);

    if (selectedCountEl) {
        selectedCountEl.textContent = String(selectedAddresses.length);
    }
    if (balanceLabelEl) {
        balanceLabelEl.textContent = selectedAddresses.length ? '可用余额' : '请选择来源地址';
    }
    if (balanceValueEl) {
        balanceValueEl.textContent = selectedAddresses.length
            ? `${balance.toFixed(displayDecimals)} ${COIN_NAMES[selectedCoinType as keyof typeof COIN_NAMES]}`
            : '--';
    }
}
