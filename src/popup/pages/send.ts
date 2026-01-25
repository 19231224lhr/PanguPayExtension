/**
 * 发送页面 - 转账交易
 */

import {
    getActiveAccount,
    getDefaultWalletAddress,
    getOrganization,
    getWalletAddresses,
    type AddressInfo,
} from '../../core/storage';
import { COIN_NAMES } from '../../core/types';
import { GROUP_ID_NOT_EXIST, queryAddressGroupInfo } from '../../core/address';
import { buildAndSubmitTransfer, type TransferMode } from '../../core/transfer';
import { watchSubmittedTransaction } from '../../core/txStatus';
import { bindInlineHandlers } from '../utils/inlineHandlers';
import { enhanceCustomSelects } from '../utils/customSelect';

let selectedCoinType = 0; // 默认 PGC
let selectedTransferMode: 'quick' | 'cross' | 'pledge' = 'quick';
let selectedSourceAddresses = new Set<string>();
let selectionTouched = false;
let lastCoinType = selectedCoinType;
let currentCoinAddresses: Array<{ address: string; balance: number; type: number }> = [];
let recipientAdvancedOpen = false;
let optionsOpen = false;
const MAX_AMOUNT_DECIMALS = 8;
const recipientTypeCache = new Map<string, { exists: boolean; type: number }>();

export async function renderSend(): Promise<void> {
    const app = document.getElementById('app');
    if (!app) return;

    const account = await getActiveAccount();
    if (!account) {
        (window as any).navigateTo('home');
        return;
    }

    const org = await getOrganization(account.accountId);
    const hasOrg = !!(org && org.groupId);
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

    if (!hasOrg && selectedTransferMode !== 'quick') {
        selectedTransferMode = 'quick';
    }

    const selectedBalance = getSelectedBalance();
    const displayDecimals = selectedCoinType === 0 ? 2 : selectedCoinType === 1 ? 8 : 6;
    const modeIndex = selectedTransferMode === 'quick' ? 0 : selectedTransferMode === 'cross' ? 1 : 2;
    const quickLabel = hasOrg ? '快速转账' : '普通转账';

    app.innerHTML = `
    <div class="page send-page">
      <header class="header">
        <button class="header-btn" onclick="navigateTo('home')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <span style="font-weight: 600;">转账交易</span>
        <div style="width: 32px;"></div>
      </header>

      <div class="page-content">
        <div class="transfer-panel">
          <div class="transfer-header">
            <div class="transfer-header-top">
              <div class="transfer-header-left">
                <div class="transfer-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 2L11 13"></path>
                    <path d="M22 2L15 22L11 13L2 9L22 2Z"></path>
                  </svg>
                </div>
                <div class="transfer-title">
                  <h2>转账交易</h2>
                  <span>快速安全的转账体验</span>
                </div>
              </div>
            </div>

            <div class="transfer-mode-tabs" data-active="${modeIndex}">
              <button class="transfer-mode-tab ${selectedTransferMode === 'quick' ? 'active' : ''}" onclick="setTransferMode('quick')">
                ${quickLabel}
              </button>
              <button class="transfer-mode-tab ${selectedTransferMode === 'cross' ? 'active' : ''}" onclick="setTransferMode('cross')" ${hasOrg ? '' : 'disabled'}>
                跨链转账
              </button>
              <button class="transfer-mode-tab ${selectedTransferMode === 'pledge' ? 'active' : ''}" onclick="setTransferMode('pledge')" ${hasOrg ? '' : 'disabled'}>
                质押交易
              </button>
            </div>

            ${!hasOrg ? `
            <div class="transfer-warning">
              未加入担保组织，仅支持普通转账
            </div>
            ` : ''}
          </div>

          <form class="transfer-flow" id="sendForm" autocomplete="off">
            <div class="transfer-from">
              <div class="transfer-section-label">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"></path>
                  <path d="M3 5v14a2 2 0 0 0 2 2h16v-5"></path>
                  <path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z"></path>
                </svg>
                <span>从 · FROM</span>
              </div>
              <div class="tx-addr-list">
                ${coinAddresses.length === 0 ? `
                  <div class="empty-state" style="padding: 16px;">
                    <div class="empty-desc">当前币种暂无可用地址</div>
                  </div>
                ` : coinAddresses.map((addr) => renderSourceAddressRow(addr.address, addr.balance, addr.type)).join('')}
              </div>
              <div class="source-summary">
                <span>已选 <span id="sourceSelectedCount">0</span> / ${coinAddresses.length}</span>
                <span id="sourceAvailableBalance">${selectedSourceAddresses.size ? `${selectedBalance.toFixed(displayDecimals)} ${COIN_NAMES[selectedCoinType as keyof typeof COIN_NAMES]}` : '--'}</span>
              </div>
            </div>

            <div class="recipients-section">
              <div class="recipients-header">
                <div class="recipients-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 2L11 13"></path>
                    <path d="M22 2L15 22L11 13L2 9L22 2Z"></path>
                  </svg>
                  <span>转至 · TO</span>
                </div>
              </div>
              <div class="recipients-list">
                <div class="recipient-card ${recipientAdvancedOpen ? 'expanded' : ''}">
                  <div class="recipient-content">
                    <div class="recipient-main">
                      <div class="recipient-addr-field">
                        <span class="recipient-field-label">收款地址</span>
                        <div class="recipient-addr-input-wrap">
                          <input id="toAddress" class="input" type="text" placeholder="输入收款方地址" required data-name="to">
                          <button type="button" class="recipient-lookup-btn" onclick="verifyRecipientAddress()" title="验证收款地址">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <path d="M12 3l7 4v5c0 5-3.5 9-7 9s-7-4-7-9V7l7-4z"></path>
                              <path d="M9 12l2 2 4-4"></path>
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                    <div class="recipient-amount-row">
                      <div class="recipient-field">
                        <span class="recipient-field-label">转账金额</span>
                        <input id="amount" class="input" type="number" min="0" step="any" placeholder="0.00" required data-name="val">
                      </div>
                      <div class="recipient-field">
                        <span class="recipient-field-label">币种</span>
                        <select id="coinType" class="input recipient-coin-select" data-name="mt">
                          <option value="0" ${selectedCoinType === 0 ? 'selected' : ''}>PGC</option>
                          <option value="1" ${selectedCoinType === 1 ? 'selected' : ''}>BTC</option>
                          <option value="2" ${selectedCoinType === 2 ? 'selected' : ''}>ETH</option>
                        </select>
                      </div>
                    </div>

                    <div class="recipient-details">
                      <div class="recipient-details-inner">
                        <div class="recipient-field">
                          <span class="recipient-field-label">公钥</span>
                          <input id="recipientPubKey" class="input" type="text" placeholder="04 + X + Y 或 X,Y" data-name="pub">
                        </div>
                        <div class="recipient-details-row">
                          <div class="recipient-field">
                            <span class="recipient-field-label">担保组织ID</span>
                            <input id="recipientOrgId" class="input" type="text" placeholder="可选" data-name="gid">
                          </div>
                          <div class="recipient-field">
                            <span class="recipient-field-label">转移Gas</span>
                            <input id="recipientGas" class="input" type="number" min="0" step="any" placeholder="0" data-name="gas">
                          </div>
                        </div>
                      </div>
                    </div>

                    <div class="recipient-actions">
                      <button type="button" class="recipient-action-btn recipient-action-btn--ghost" onclick="toggleRecipientAdvanced()">
                        <span>高级选项</span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                      </button>
                      <button type="button" class="recipient-action-btn recipient-action-btn--danger" onclick="clearRecipientFields()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M3 6h18"></path>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                        <span>清空</span>
                      </button>
                      <button type="button" class="recipient-action-btn recipient-action-btn--primary" onclick="addRecipient()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <line x1="12" y1="5" x2="12" y2="19"></line>
                          <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        <span>添加</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="transfer-options">
              <div class="options-toggle ${optionsOpen ? 'active' : ''}" onclick="toggleAdvancedOptions()" id="optionsToggle">
                <span class="options-toggle-left">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                  </svg>
                  <span>高级选项</span>
                </span>
                <span class="options-toggle-arrow">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </span>
              </div>

              <div class="options-content ${optionsOpen ? 'open' : ''}" id="optionsContent">
                <div class="options-card">
                  <div class="options-split-row">
                    <div class="options-split-group">
                      <label class="option-field-label">额外Gas</label>
                      <div class="option-input-wrapper">
                        <input id="extraGasPGC" name="extraGasPGC" class="option-input" type="number" min="0" step="any" placeholder="0" value="0" />
                        <span class="option-suffix option-suffix--pgc">PGC</span>
                      </div>
                    </div>
                    <div class="options-split-group">
                      <label class="option-field-label">交易Gas</label>
                      <div class="option-input-wrapper">
                        <input id="txGasInput" name="txGasInput" class="option-input" type="number" min="0" step="any" placeholder="1" value="1" />
                        <span class="option-suffix option-suffix--gas">GAS</span>
                      </div>
                    </div>
                  </div>
                  <div class="option-field">
                    <label class="option-field-label">PGC 找零</label>
                    <select id="chAddrPGC" class="input option-select" ${hasChangeAddress(walletAddresses, 0) ? '' : 'disabled'}>
                      ${renderChangeAddressOptions(walletAddresses, 0)}
                    </select>
                  </div>
                  <div class="option-field">
                    <label class="option-field-label">BTC 找零</label>
                    <select id="chAddrBTC" class="input option-select" ${hasChangeAddress(walletAddresses, 1) ? '' : 'disabled'}>
                      ${renderChangeAddressOptions(walletAddresses, 1)}
                    </select>
                  </div>
                  <div class="option-field">
                    <label class="option-field-label">ETH 找零</label>
                    <select id="chAddrETH" class="input option-select" ${hasChangeAddress(walletAddresses, 2) ? '' : 'disabled'}>
                      ${renderChangeAddressOptions(walletAddresses, 2)}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div class="transfer-submit">
              <button type="submit" class="submit-btn submit-btn--primary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
                <span>构造交易</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
        setTransferMode,
        toggleSourceAddress,
        toggleRecipientAdvanced,
        clearRecipientFields,
        addRecipient,
        toggleAdvancedOptions,
        verifyRecipientAddress,
    });

    enhanceCustomSelects(app);

    const form = document.getElementById('sendForm') as HTMLFormElement;
    form.addEventListener('submit', handleSend);

    const coinSelect = document.getElementById('coinType') as HTMLSelectElement;
    coinSelect.addEventListener('change', (e) => {
        selectedCoinType = parseInt((e.target as HTMLSelectElement).value);
        renderSend();
    });

    updateSourceSummary();
}

function renderSourceAddressRow(address: string, balance: number, coinType: number): string {
    const isSelected = selectedSourceAddresses.has(address);
    const displayDecimals = coinType === 0 ? 2 : coinType === 1 ? 8 : 6;
    const shortAddress = address.slice(0, 10) + '...' + address.slice(-6);
    const coinLabel = COIN_NAMES[coinType as keyof typeof COIN_NAMES];

    return `
      <button type="button" class="tx-addr-item ${isSelected ? 'selected' : ''}" data-source-address="${address}" onclick="toggleSourceAddress('${address}')" aria-pressed="${isSelected}">
        <div class="tx-addr-left">
          <div class="coin-badge coin-badge--${coinLabel.toLowerCase()}">${coinLabel.charAt(0)}</div>
          <div class="tx-addr-info">
            <div class="tx-addr-text">${shortAddress}</div>
            <div class="tx-addr-sub">${coinLabel}</div>
          </div>
        </div>
        <div class="tx-addr-right">
          <div class="tx-addr-balance">${(balance || 0).toFixed(displayDecimals)}</div>
          <div class="tx-addr-check ${isSelected ? 'checked' : ''}"></div>
        </div>
      </button>
    `;
}

function setTransferMode(mode: 'quick' | 'cross' | 'pledge'): void {
    if (mode === 'pledge') {
        (window as any).showToast('质押交易功能暂未开放', 'info');
        return;
    }

    if (mode === 'cross') {
        getActiveAccount().then(async (account) => {
            if (!account) return;
            const org = await getOrganization(account.accountId);
            if (!org || !org.groupId) {
                (window as any).showToast('请先加入担保组织', 'info');
                return;
            }
            selectedTransferMode = mode;
            renderSend();
        });
        return;
    }

    selectedTransferMode = mode;
    renderSend();
}

async function handleSend(e: Event): Promise<void> {
    e.preventDefault();

    const amountEl = document.getElementById('amount') as HTMLInputElement | null;
    const toEl = document.getElementById('toAddress') as HTMLInputElement | null;
    const amountRaw = amountEl ? amountEl.value.trim() : '';
    const toAddress = toEl ? toEl.value.trim() : '';
    const extraGasEl = document.getElementById('extraGasPGC') as HTMLInputElement | null;
    const txGasEl = document.getElementById('txGasInput') as HTMLInputElement | null;
    const pubEl = document.getElementById('recipientPubKey') as HTMLInputElement | null;
    const orgEl = document.getElementById('recipientOrgId') as HTMLInputElement | null;
    const recipientGasEl = document.getElementById('recipientGas') as HTMLInputElement | null;
    const changePGC = document.getElementById('chAddrPGC') as HTMLSelectElement | null;
    const changeBTC = document.getElementById('chAddrBTC') as HTMLSelectElement | null;
    const changeETH = document.getElementById('chAddrETH') as HTMLSelectElement | null;

    const selectedAddresses = getSelectedAddresses();
    if (selectedAddresses.length === 0) {
        (window as any).showToast('请选择来源地址', 'error');
        return;
    }

    try {
        const amountCheck = validateAmountInput(amountRaw);
        if (!amountCheck.ok) {
            (window as any).showToast(amountCheck.error || '请输入有效金额', 'error');
            return;
        }

        const account = await getActiveAccount();
        if (!account) {
            (window as any).showToast('账户未找到', 'error');
            return;
        }

        const org = await getOrganization(account.accountId);
        const hasOrg = !!(org && org.groupId);
        if (selectedTransferMode === 'pledge') {
            (window as any).showToast('质押交易功能暂未开放', 'info');
            return;
        }
        if (!hasOrg && selectedTransferMode !== 'quick') {
            (window as any).showToast('散户模式仅支持普通转账', 'error');
            return;
        }

        const transferMode: TransferMode = hasOrg && selectedTransferMode === 'cross' ? 'cross' : 'quick';
        const isCross = transferMode === 'cross';

        const addressCheck = validateRecipientAddressFormat(toAddress, isCross);
        if (!addressCheck.ok) {
            (window as any).showToast(addressCheck.error || '请输入有效的收款地址', 'error');
            return;
        }

        const recipientPubKey = pubEl?.value?.trim() || '';
        if (!isCross) {
            if (!recipientPubKey) {
                (window as any).showToast('请输入收款方公钥', 'error');
                return;
            }
            const pubCheck = parseRecipientPublicKey(recipientPubKey);
            if (!pubCheck.ok) {
                (window as any).showToast('收款方公钥格式不正确', 'error');
                return;
            }
        }

        const recipientOrgId = orgEl?.value?.trim() || '';
        if (recipientOrgId && !isValidOrgId(recipientOrgId)) {
            (window as any).showToast('担保组织ID格式错误', 'error');
            return;
        }

        if (!isCross) {
            const typeOk = await ensureRecipientTypeMatches(addressCheck.normalized, selectedCoinType);
            if (!typeOk) {
                return;
            }
        }

        const recipientGas = Number(recipientGasEl?.value || 0);
        if (!Number.isFinite(recipientGas) || recipientGas < 0) {
            (window as any).showToast('转移Gas必须为非负数', 'error');
            return;
        }

        const txGas = Number(txGasEl?.value || 1);
        if (!Number.isFinite(txGas) || txGas < 0) {
            (window as any).showToast('交易Gas必须为非负数', 'error');
            return;
        }

        const extraGas = Number(extraGasEl?.value || 0);
        if (!Number.isFinite(extraGas) || extraGas < 0) {
            (window as any).showToast('额外Gas必须为非负数', 'error');
            return;
        }

        if (extraGas > 0 && selectedCoinType !== 0) {
            (window as any).showToast('额外Gas仅支持 PGC 地址', 'error');
            return;
        }

        const amount = amountCheck.value;
        const balance = getSelectedBalance();
        const requiredAmount = selectedCoinType === 0 ? amount + extraGas : amount;
        if (requiredAmount > balance) {
            (window as any).showToast('余额不足', 'error');
            return;
        }

        if (isCross && selectedCoinType !== 0) {
            (window as any).showToast('跨链转账仅支持 PGC', 'error');
            return;
        }

        if (isCross && selectedAddresses.length !== 1) {
            (window as any).showToast('跨链转账仅支持单一来源地址', 'error');
            return;
        }

        if (isCross && !Number.isInteger(amount)) {
            (window as any).showToast('跨链转账金额必须为整数', 'error');
            return;
        }

        const availableGas = selectedAddresses.reduce((sum, addr) => {
            const info = account.addresses?.[addr.address];
            return sum + (info?.estInterest || 0);
        }, 0);
        const totalGasNeed = txGas + (isCross ? 0 : recipientGas);
        const totalGasBudget = availableGas + extraGas;
        if (totalGasNeed > totalGasBudget + 1e-8) {
            (window as any).showToast('Gas 不足，请调整转移Gas或额外Gas', 'error');
            return;
        }

        const changeAddresses: Record<number, string> = {
            0: changePGC?.value || '',
            1: changeBTC?.value || '',
            2: changeETH?.value || '',
        };

        if (!changeAddresses[selectedCoinType]) {
            (window as any).showToast('请选择找零地址', 'error');
            return;
        }

        const result = await buildAndSubmitTransfer({
            account,
            fromAddresses: selectedAddresses.map((addr) => addr.address),
            toAddress,
            amount,
            coinType: selectedCoinType,
            transferMode,
            transferGas: isCross ? 0 : recipientGas,
            recipientPublicKey,
            recipientOrgId,
            gas: txGas,
            extraGas,
            changeAddresses,
        });

        if (!result.success) {
            throw new Error(result.error || '交易发送失败');
        }

        (window as any).showToast('交易已提交', 'success');
        if (result.txId) {
            void watchSubmittedTransaction(account.accountId, result.txId);
        }
        setTimeout(() => {
            (window as any).navigateTo('history');
        }, 800);
    } catch (error) {
        console.error('[发送] 失败:', error);
        (window as any).showToast('发送失败: ' + (error as Error).message, 'error');
    }
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

function updateSourceListSelection(): void {
    currentCoinAddresses.forEach((addr) => {
        const row = document.querySelector<HTMLElement>(`[data-source-address="${addr.address}"]`);
        if (!row) return;
        const selected = selectedSourceAddresses.has(addr.address);
        row.classList.toggle('selected', selected);
        row.setAttribute('aria-pressed', selected ? 'true' : 'false');
        const check = row.querySelector('.tx-addr-check');
        if (check) {
            check.classList.toggle('checked', selected);
        }
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
    const balanceValueEl = document.getElementById('sourceAvailableBalance');

    const selectedAddresses = getSelectedAddresses();
    const displayDecimals = selectedCoinType === 0 ? 2 : selectedCoinType === 1 ? 8 : 6;
    const balance = selectedAddresses.reduce((sum, addr) => sum + (addr.balance || 0), 0);

    if (selectedCountEl) {
        selectedCountEl.textContent = String(selectedAddresses.length);
    }
    if (balanceValueEl) {
        balanceValueEl.textContent = selectedAddresses.length
            ? `${balance.toFixed(displayDecimals)} ${COIN_NAMES[selectedCoinType as keyof typeof COIN_NAMES]}`
            : '--';
    }
}

function toggleRecipientAdvanced(): void {
    recipientAdvancedOpen = !recipientAdvancedOpen;
    const card = document.querySelector('.recipient-card');
    if (card) {
        card.classList.toggle('expanded', recipientAdvancedOpen);
    }
}

function toggleAdvancedOptions(): void {
    optionsOpen = !optionsOpen;
    const toggle = document.getElementById('optionsToggle');
    const content = document.getElementById('optionsContent');
    if (toggle) {
        toggle.classList.toggle('active', optionsOpen);
    }
    if (content) {
        content.classList.toggle('open', optionsOpen);
    }
}

function clearRecipientFields(): void {
    const toEl = document.getElementById('toAddress') as HTMLInputElement | null;
    const amountEl = document.getElementById('amount') as HTMLInputElement | null;
    const pubEl = document.getElementById('recipientPubKey') as HTMLInputElement | null;
    const orgEl = document.getElementById('recipientOrgId') as HTMLInputElement | null;
    const gasEl = document.getElementById('recipientGas') as HTMLInputElement | null;

    if (toEl) toEl.value = '';
    if (amountEl) amountEl.value = '';
    if (pubEl) pubEl.value = '';
    if (orgEl) orgEl.value = '';
    if (gasEl) gasEl.value = '';

    (window as any).showToast('已清空收款信息', 'info');
}

function addRecipient(): void {
    (window as any).showToast('当前仅支持单个收款人', 'info');
}

async function verifyRecipientAddress(): Promise<void> {
    const input = document.getElementById('toAddress') as HTMLInputElement | null;
    if (!input) return;
    const raw = input.value.trim();
    if (!raw) {
        (window as any).showToast('请输入收款地址', 'info');
        return;
    }

    const addressCheck = validateRecipientAddressFormat(raw, selectedTransferMode === 'cross');
    if (!addressCheck.ok) {
        (window as any).showToast(addressCheck.error || '地址格式不正确', 'error');
        return;
    }

    if (selectedTransferMode !== 'cross') {
        const typeOk = await ensureRecipientTypeMatches(addressCheck.normalized, selectedCoinType);
        if (!typeOk) return;
    }

    (window as any).showToast('地址格式已验证', 'success');
}

function hasChangeAddress(addresses: AddressInfo[], coinType: number): boolean {
    return addresses.some((item) => item.type === coinType);
}

function renderChangeAddressOptions(addresses: AddressInfo[], coinType: number): string {
    const filtered = addresses.filter((item) => item.type === coinType);
    if (!filtered.length) {
        return `<option value="">无可用地址</option>`;
    }
    return filtered
        .map((item) => `<option value="${item.address}">${item.address.slice(0, 10)}...${item.address.slice(-6)}</option>`)
        .join('');
}

function normalizeAddressInput(address: string): string {
    return address.trim().replace(/^0x/i, '').toLowerCase();
}

function validateRecipientAddressFormat(
    raw: string,
    isCross: boolean
): { ok: boolean; normalized: string; error?: string } {
    if (!raw) {
        return { ok: false, normalized: '', error: '请输入收款地址' };
    }

    if (isCross) {
        if (!/^0x[a-fA-F0-9]{40}$/.test(raw)) {
            return { ok: false, normalized: '', error: '跨链地址需为 0x 开头的 40 位地址' };
        }
        return { ok: true, normalized: normalizeAddressInput(raw) };
    }

    const normalized = normalizeAddressInput(raw);
    if (!/^[0-9a-fA-F]{40}$/.test(normalized)) {
        return { ok: false, normalized, error: '地址格式不正确' };
    }

    return { ok: true, normalized };
}

function parseRecipientPublicKey(input: string): { ok: boolean; xHex: string; yHex: string } {
    const trimmed = input.trim().replace(/^0x/i, '');
    if (!trimmed) {
        return { ok: false, xHex: '', yHex: '' };
    }

    if (trimmed.startsWith('04') && trimmed.length >= 130) {
        const body = trimmed.slice(2);
        const xHex = body.slice(0, 64);
        const yHex = body.slice(64, 128);
        if (/^[0-9a-fA-F]{64}$/.test(xHex) && /^[0-9a-fA-F]{64}$/.test(yHex)) {
            return { ok: true, xHex, yHex };
        }
    }

    const parts = trimmed.split(/[\s,]+/).filter(Boolean);
    if (parts.length >= 2 && /^[0-9a-fA-F]{64}$/.test(parts[0]) && /^[0-9a-fA-F]{64}$/.test(parts[1])) {
        return { ok: true, xHex: parts[0], yHex: parts[1] };
    }

    return { ok: false, xHex: '', yHex: '' };
}

function validateAmountInput(raw: string): { ok: boolean; value: number; error?: string } {
    if (!raw) {
        return { ok: false, value: 0, error: '请输入有效金额' };
    }

    const value = Number(raw);
    if (!Number.isFinite(value)) {
        return { ok: false, value: 0, error: '金额格式不正确' };
    }
    if (value <= 0) {
        return { ok: false, value: 0, error: '金额必须大于0' };
    }

    const decimalPart = raw.split('.')[1];
    if (decimalPart && decimalPart.length > MAX_AMOUNT_DECIMALS) {
        return { ok: false, value: 0, error: `金额最多支持 ${MAX_AMOUNT_DECIMALS} 位小数` };
    }

    return { ok: true, value };
}

function isValidOrgId(orgId: string): boolean {
    return /^\d{8}$/.test(orgId.trim());
}

function getCoinLabel(type: number): string {
    return COIN_NAMES[type as keyof typeof COIN_NAMES] || 'PGC';
}

async function ensureRecipientTypeMatches(address: string, coinType: number): Promise<boolean> {
    const normalized = normalizeAddressInput(address);
    const cached = recipientTypeCache.get(normalized);
    if (cached) {
        if (cached.exists && cached.type !== coinType) {
            const expected = getCoinLabel(cached.type);
            const selected = getCoinLabel(coinType);
            (window as any).showToast(`收款地址币种为 ${expected}，当前选择 ${selected}`, 'error');
            return false;
        }
        return true;
    }

    const result = await queryAddressGroupInfo(normalized);
    if (!result.success || !result.data) {
        const errMsg = result.error ? `地址币种校验失败: ${result.error}` : '地址币种校验失败';
        (window as any).showToast(errMsg, 'error');
        return false;
    }

    const exists = result.data.groupId !== GROUP_ID_NOT_EXIST;
    const type = Number(result.data.type ?? coinType);
    recipientTypeCache.set(normalized, { exists, type });

    if (exists && type !== coinType) {
        const expected = getCoinLabel(type);
        const selected = getCoinLabel(coinType);
        (window as any).showToast(`收款地址币种为 ${expected}，当前选择 ${selected}`, 'error');
        return false;
    }

    return true;
}
