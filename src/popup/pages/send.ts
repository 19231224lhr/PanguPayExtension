/**
 * 发送页面 - 转账交易
 */

import {
    getActiveAccount,
    getOrganization,
    getWalletAddresses,
    type AddressInfo,
} from '../../core/storage';
import { COIN_NAMES } from '../../core/types';
import { GROUP_ID_NOT_EXIST, GROUP_ID_RETAIL, queryAddressGroupInfo } from '../../core/address';
import { queryAddressBalances } from '../../core/accountQuery';
import { isCapsuleAddress, verifyCapsuleAddress } from '../../core/capsule';
import { buildAndSubmitTransfer, type TransferMode, type TransferRecipient } from '../../core/transfer';
import { watchSubmittedTransaction } from '../../core/txStatus';
import { isTXCerLocked } from '../../core/txCerLockManager';
import { getLockedUTXOs } from '../../core/utxoLock';
import { bigIntToHex } from '../../core/signature';
import { bindInlineHandlers } from '../utils/inlineHandlers';
import { enhanceCustomSelects } from '../utils/customSelect';

type TransferModeView = 'quick' | 'cross' | 'pledge';

interface RecipientDraft {
    id: string;
    toAddress: string;
    amount: string;
    coinType: number;
    publicKey: string;
    orgId: string;
    transferGas: string;
    resolvedAddress?: string;
    capsuleOrgId?: string;
    verifiedType?: number;
}

let selectedTransferMode: TransferModeView = 'quick';
let selectedSourceAddresses = new Set<string>();
let selectionTouched = false;
let currentAddresses: AddressInfo[] = [];
let optionsOpen = false;

const recipients: RecipientDraft[] = [];
const recipientAdvancedOpen = new Set<string>();
const recipientTypeCache = new Map<string, { exists: boolean; type: number }>();
const MAX_AMOUNT_DECIMALS = 8;

function createRecipient(defaultCoinType = 0): RecipientDraft {
    return {
        id: `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        toAddress: '',
        amount: '',
        coinType: defaultCoinType,
        publicKey: '',
        orgId: '',
        transferGas: '',
    };
}

function ensureRecipients(): void {
    if (recipients.length === 0) {
        recipients.push(createRecipient(0));
    }
}

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
    const walletAddresses = getWalletAddresses(account);

    if (!walletAddresses.length) {
        (window as any).showToast('请先添加钱包地址', 'info');
        (window as any).navigateTo('walletManager');
        return;
    }

    ensureRecipients();
    currentAddresses = walletAddresses;

    if (!hasOrg && selectedTransferMode !== 'quick') {
        selectedTransferMode = 'quick';
    }

    syncSelection(currentAddresses);

    const summary = getSelectionSummary();
    const isCrossMode = selectedTransferMode === 'cross';
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
                ${currentAddresses.length === 0 ? `
                  <div class="empty-state" style="padding: 16px;">
                    <div class="empty-desc">暂无可用地址</div>
                  </div>
                ` : currentAddresses.map((addr) => renderSourceAddressRow(addr)).join('')}
              </div>
              <div class="source-summary">
                <span>已选 <span id="sourceSelectedCount">${summary.count}</span> / ${currentAddresses.length}</span>
                <span id="sourceAvailableBalance">${summary.label}</span>
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
                ${recipients.map((recipient, index) => renderRecipientCard(recipient, index, isCrossMode)).join('')}
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
                    <select id="chAddrPGC" class="input option-select" ${hasChangeAddress(currentAddresses, 0) ? '' : 'disabled'}>
                      ${renderChangeAddressOptions(currentAddresses, 0)}
                    </select>
                  </div>
                  <div class="option-field">
                    <label class="option-field-label">BTC 找零</label>
                    <select id="chAddrBTC" class="input option-select" ${hasChangeAddress(currentAddresses, 1) ? '' : 'disabled'}>
                      ${renderChangeAddressOptions(currentAddresses, 1)}
                    </select>
                  </div>
                  <div class="option-field">
                    <label class="option-field-label">ETH 找零</label>
                    <select id="chAddrETH" class="input option-select" ${hasChangeAddress(currentAddresses, 2) ? '' : 'disabled'}>
                      ${renderChangeAddressOptions(currentAddresses, 2)}
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
        removeRecipient,
        toggleAdvancedOptions,
        verifyRecipientAddress,
    });

    applyRecipientValues(app);
    enhanceCustomSelects(app);
    bindRecipientInputHandlers(app);

    const form = document.getElementById('sendForm') as HTMLFormElement | null;
    if (form) {
        form.addEventListener('submit', handleSend);
    }

    updateSourceSummary();
}

function renderSourceAddressRow(addr: AddressInfo): string {
    const isSelected = selectedSourceAddresses.has(addr.address);
    const available = getAvailableBalanceForAddress(addr);
    const shortAddress = addr.address.slice(0, 10) + '...' + addr.address.slice(-6);
    const coinLabel = COIN_NAMES[addr.type as keyof typeof COIN_NAMES];
    const displayDecimals = getDisplayDecimals(addr.type);

    return `
      <button type="button" class="tx-addr-item ${isSelected ? 'selected' : ''}" data-source-address="${addr.address}" onclick="toggleSourceAddress('${addr.address}')" aria-pressed="${isSelected}">
        <div class="tx-addr-left">
          <div class="coin-badge coin-badge--${coinLabel.toLowerCase()}">${coinLabel.charAt(0)}</div>
          <div class="tx-addr-info">
            <div class="tx-addr-text">${shortAddress}</div>
            <div class="tx-addr-sub">${coinLabel}</div>
          </div>
        </div>
        <div class="tx-addr-right">
          <div class="tx-addr-balance">${available.toFixed(displayDecimals)}</div>
          <div class="tx-addr-check ${isSelected ? 'checked' : ''}"></div>
        </div>
      </button>
    `;
}

function renderRecipientCard(recipient: RecipientDraft, index: number, isCrossMode: boolean): string {
    const isExpanded = recipientAdvancedOpen.has(recipient.id);
    const isLast = index === recipients.length - 1;
    const canRemove = recipients.length > 1;
    const resolvedHint = recipient.resolvedAddress
        ? `<div class="input-hint">胶囊地址已解析：${recipient.resolvedAddress.slice(0, 10)}...${recipient.resolvedAddress.slice(-6)}</div>`
        : '';

    return `
      <div class="recipient-card ${isExpanded ? 'expanded' : ''}" data-recipient-id="${recipient.id}">
        <div class="recipient-content">
          <div class="recipient-main">
            <div class="recipient-addr-field">
              <span class="recipient-field-label">收款地址</span>
              <div class="recipient-addr-input-wrap">
                <input class="input" type="text" placeholder="输入收款方地址" data-recipient-id="${recipient.id}" data-recipient-field="toAddress">
                <button type="button" class="recipient-lookup-btn" onclick="verifyRecipientAddress('${recipient.id}')" title="验证收款地址">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 3l7 4v5c0 5-3.5 9-7 9s-7-4-7-9V7l7-4z"></path>
                    <path d="M9 12l2 2 4-4"></path>
                  </svg>
                </button>
              </div>
              ${resolvedHint}
            </div>
          </div>
          <div class="recipient-amount-row">
            <div class="recipient-field">
              <span class="recipient-field-label">转账金额</span>
              <input class="input" type="number" min="0" step="any" placeholder="0.00" data-recipient-id="${recipient.id}" data-recipient-field="amount">
            </div>
            <div class="recipient-field">
              <span class="recipient-field-label">币种</span>
              <select class="input recipient-coin-select" data-recipient-id="${recipient.id}" data-recipient-field="coinType">
                <option value="0">PGC</option>
                <option value="1">BTC</option>
                <option value="2">ETH</option>
              </select>
            </div>
          </div>

          <div class="recipient-details" ${isCrossMode ? 'style="display:none"' : ''}>
            <div class="recipient-details-inner">
              <div class="recipient-field">
                <span class="recipient-field-label">公钥</span>
                <input class="input" type="text" placeholder="04 + X + Y 或 X,Y" data-recipient-id="${recipient.id}" data-recipient-field="publicKey" ${isCrossMode ? 'disabled' : ''}>
              </div>
              <div class="recipient-details-row">
                <div class="recipient-field">
                  <span class="recipient-field-label">担保组织ID</span>
                  <input class="input" type="text" placeholder="可选" data-recipient-id="${recipient.id}" data-recipient-field="orgId" ${isCrossMode ? 'disabled' : ''}>
                </div>
                <div class="recipient-field">
                  <span class="recipient-field-label">转移Gas</span>
                  <input class="input" type="number" min="0" step="any" placeholder="0" data-recipient-id="${recipient.id}" data-recipient-field="transferGas" ${isCrossMode ? 'disabled' : ''}>
                </div>
              </div>
            </div>
          </div>

          <div class="recipient-actions">
            <button type="button" class="recipient-action-btn recipient-action-btn--ghost" onclick="toggleRecipientAdvanced('${recipient.id}')" ${isCrossMode ? 'disabled' : ''}>
              <span>高级选项</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
            <button type="button" class="recipient-action-btn recipient-action-btn--danger" onclick="${canRemove ? `removeRecipient('${recipient.id}')` : `clearRecipientFields('${recipient.id}')`}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18"></path>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
              <span>${canRemove ? '删除' : '清空'}</span>
            </button>
            ${isLast ? `
            <button type="button" class="recipient-action-btn recipient-action-btn--primary" onclick="addRecipient()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>添加</span>
            </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
}
function bindRecipientInputHandlers(root: HTMLElement): void {
    const fields = root.querySelectorAll<HTMLElement>('[data-recipient-field]');
    fields.forEach((fieldEl) => {
        const recipientId = fieldEl.dataset.recipientId || '';
        const field = fieldEl.dataset.recipientField || '';
        if (!recipientId || !field) return;

        const handler = () => {
            const recipient = recipients.find((item) => item.id === recipientId);
            if (!recipient) return;

            const value = (fieldEl as HTMLInputElement).value;
            if (field === 'coinType') {
                recipient.coinType = Number(value || 0);
                return;
            }

            if (field === 'toAddress') {
                const trimmed = value.trim();
                if (trimmed !== recipient.toAddress) {
                    recipient.toAddress = trimmed;
                    recipient.resolvedAddress = undefined;
                    recipient.capsuleOrgId = undefined;
                    recipient.verifiedType = undefined;
                }
                return;
            }

            if (field === 'amount') {
                recipient.amount = value;
                return;
            }

            if (field === 'publicKey') {
                recipient.publicKey = value.trim();
                return;
            }

            if (field === 'orgId') {
                recipient.orgId = value.trim();
                return;
            }

            if (field === 'transferGas') {
                recipient.transferGas = value;
            }
        };

        const eventType = fieldEl.tagName === 'SELECT' ? 'change' : 'input';
        fieldEl.addEventListener(eventType, handler);
    });
}

function applyRecipientValues(root: HTMLElement): void {
    recipients.forEach((recipient) => {
        const card = root.querySelector<HTMLElement>(`[data-recipient-id="${recipient.id}"]`);
        if (!card) return;

        const toEl = card.querySelector<HTMLInputElement>('[data-recipient-field="toAddress"]');
        if (toEl) {
            toEl.value = recipient.toAddress || '';
            if (recipient.resolvedAddress) {
                toEl.dataset.resolved = recipient.resolvedAddress;
            } else {
                delete toEl.dataset.resolved;
            }
            if (recipient.verifiedType !== undefined) {
                toEl.dataset.verifiedType = String(recipient.verifiedType);
            } else {
                delete toEl.dataset.verifiedType;
            }
        }

        const amountEl = card.querySelector<HTMLInputElement>('[data-recipient-field="amount"]');
        if (amountEl) amountEl.value = recipient.amount || '';

        const coinEl = card.querySelector<HTMLSelectElement>('[data-recipient-field="coinType"]');
        if (coinEl) coinEl.value = String(recipient.coinType ?? 0);

        const pubEl = card.querySelector<HTMLInputElement>('[data-recipient-field="publicKey"]');
        if (pubEl) pubEl.value = recipient.publicKey || '';

        const orgEl = card.querySelector<HTMLInputElement>('[data-recipient-field="orgId"]');
        if (orgEl) orgEl.value = recipient.orgId || '';

        const gasEl = card.querySelector<HTMLInputElement>('[data-recipient-field="transferGas"]');
        if (gasEl) gasEl.value = recipient.transferGas || '';
    });
}

function setTransferMode(mode: TransferModeView): void {
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

function syncSelection(addresses: AddressInfo[]): void {
    const validSet = new Set(addresses.map((addr) => addr.address));
    for (const addr of Array.from(selectedSourceAddresses)) {
        if (!validSet.has(addr)) {
            selectedSourceAddresses.delete(addr);
        }
    }

    if (!selectionTouched && selectedSourceAddresses.size === 0 && addresses.length > 0) {
        const requiredTypes = new Set(recipients.map((recipient) => recipient.coinType));
        let autoPick = addresses;
        if (requiredTypes.size > 0) {
            autoPick = addresses.filter((addr) => requiredTypes.has(addr.type));
        }
        if (selectedTransferMode === 'cross') {
            autoPick = autoPick.filter((addr) => addr.type === 0);
            if (autoPick.length > 1) {
                autoPick = [autoPick[0]];
            }
        }
        if (autoPick.length === 0) {
            autoPick = addresses;
        }
        autoPick.forEach((addr) => selectedSourceAddresses.add(addr.address));
    }

    if (selectedTransferMode === 'cross' && selectedSourceAddresses.size > 1) {
        const first = Array.from(selectedSourceAddresses)[0];
        selectedSourceAddresses = new Set([first]);
    }
}

function toggleSourceAddress(address: string): void {
    selectionTouched = true;
    if (selectedTransferMode === 'cross') {
        if (!selectedSourceAddresses.has(address)) {
            selectedSourceAddresses = new Set([address]);
        } else {
            selectedSourceAddresses.delete(address);
        }
    } else if (selectedSourceAddresses.has(address)) {
        selectedSourceAddresses.delete(address);
    } else {
        selectedSourceAddresses.add(address);
    }
    updateSourceListSelection();
    updateSourceSummary();
}

function updateSourceListSelection(): void {
    currentAddresses.forEach((addr) => {
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

function getSelectedAddresses(): AddressInfo[] {
    return currentAddresses.filter((addr) => selectedSourceAddresses.has(addr.address));
}

function getSelectionSummary(): { count: number; label: string } {
    const selected = getSelectedAddresses();
    if (!selected.length) {
        return { count: 0, label: '--' };
    }

    const totals: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
    selected.forEach((addr) => {
        totals[addr.type] += getAvailableBalanceForAddress(addr);
    });

    const label = [0, 1, 2]
        .filter((type) => totals[type] > 0)
        .map((type) => `${totals[type].toFixed(getDisplayDecimals(type))} ${COIN_NAMES[type as keyof typeof COIN_NAMES]}`)
        .join(' / ');

    return { count: selected.length, label: label || '--' };
}

function updateSourceSummary(): void {
    const summary = getSelectionSummary();
    const selectedCountEl = document.getElementById('sourceSelectedCount');
    const balanceValueEl = document.getElementById('sourceAvailableBalance');

    if (selectedCountEl) {
        selectedCountEl.textContent = String(summary.count);
    }
    if (balanceValueEl) {
        balanceValueEl.textContent = summary.label;
    }
}

function toggleRecipientAdvanced(recipientId: string): void {
    if (!recipientId) return;
    if (recipientAdvancedOpen.has(recipientId)) {
        recipientAdvancedOpen.delete(recipientId);
    } else {
        recipientAdvancedOpen.add(recipientId);
    }
    const card = document.querySelector<HTMLElement>(`[data-recipient-id="${recipientId}"]`);
    if (card) {
        card.classList.toggle('expanded', recipientAdvancedOpen.has(recipientId));
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

function clearRecipientFields(recipientId: string): void {
    const recipient = recipients.find((item) => item.id === recipientId);
    if (!recipient) return;
    recipient.toAddress = '';
    recipient.amount = '';
    recipient.publicKey = '';
    recipient.orgId = '';
    recipient.transferGas = '';
    recipient.resolvedAddress = undefined;
    recipient.capsuleOrgId = undefined;
    recipient.verifiedType = undefined;
    renderSend();
    (window as any).showToast('已清空收款信息', 'info');
}

function addRecipient(): void {
    const last = recipients[recipients.length - 1];
    recipients.push(createRecipient(last ? last.coinType : 0));
    renderSend();
}

function removeRecipient(recipientId: string): void {
    if (recipients.length <= 1) {
        clearRecipientFields(recipientId);
        return;
    }
    const index = recipients.findIndex((item) => item.id === recipientId);
    if (index >= 0) {
        recipients.splice(index, 1);
        recipientAdvancedOpen.delete(recipientId);
        renderSend();
    }
}
async function verifyRecipientAddress(recipientId: string): Promise<void> {
    const recipient = recipients.find((item) => item.id === recipientId);
    if (!recipient) return;

    const raw = recipient.toAddress.trim();
    if (!raw) {
        (window as any).showToast('请输入收款地址', 'info');
        return;
    }

    const isCross = selectedTransferMode === 'cross';
    if (isCross) {
        if (!/^0x[a-fA-F0-9]{40}$/.test(raw)) {
            (window as any).showToast('跨链地址需为 0x 开头的 40 位地址', 'error');
            return;
        }
        (window as any).showToast('跨链地址格式已验证', 'success');
        return;
    }

    const isCapsule = isCapsuleAddress(raw);
    if (isCapsule) {
        try {
            const verified = await verifyCapsuleAddress(raw);
            const info = await fetchRecipientInfo(verified.address);
            if (!info || !info.exists) {
                (window as any).showToast('地址不存在', 'error');
                return;
            }

            const isRetailCapsule = verified.orgId === '00000000';
            const orgMatched = isRetailCapsule ? !info.isInGroup : info.groupId === verified.orgId;
            if (!orgMatched) {
                (window as any).showToast('胶囊地址校验失败', 'error');
                return;
            }

            recipient.resolvedAddress = verified.address;
            recipient.capsuleOrgId = verified.orgId;
            recipient.orgId = info.isInGroup ? info.groupId : '';
            recipient.verifiedType = info.type;
            recipient.coinType = info.type;
            if (info.publicKey) {
                recipient.publicKey = info.publicKey;
            }

            renderSend();
            (window as any).showToast('胶囊地址已验证', 'success');
            return;
        } catch (error) {
            (window as any).showToast((error as Error).message || '胶囊地址校验失败', 'error');
            return;
        }
    }

    const normalized = normalizeAddressInput(raw);
    if (!/^[0-9a-fA-F]{40}$/.test(normalized)) {
        (window as any).showToast('地址格式不正确', 'error');
        return;
    }

    const info = await fetchRecipientInfo(normalized);
    if (!info || !info.exists) {
        (window as any).showToast('地址不存在', 'error');
        return;
    }

    recipient.orgId = info.isInGroup ? info.groupId : '';
    recipient.verifiedType = info.type;
    recipient.coinType = info.type;
    if (info.publicKey) {
        recipient.publicKey = info.publicKey;
    }

    renderSend();
    (window as any).showToast('地址信息已更新', 'success');
}

async function handleSend(e: Event): Promise<void> {
    e.preventDefault();

    try {
        const extraGasEl = document.getElementById('extraGasPGC') as HTMLInputElement | null;
        const txGasEl = document.getElementById('txGasInput') as HTMLInputElement | null;
        const changePGC = document.getElementById('chAddrPGC') as HTMLSelectElement | null;
        const changeBTC = document.getElementById('chAddrBTC') as HTMLSelectElement | null;
        const changeETH = document.getElementById('chAddrETH') as HTMLSelectElement | null;

        const selectedAddresses = getSelectedAddresses();
        if (selectedAddresses.length === 0) {
            (window as any).showToast('请选择来源地址', 'error');
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

        const preparedRecipients: TransferRecipient[] = [];
        const recipientIndexMap = new Map<string, number>();
        const addressMetaMap = new Map<string, { coinType: number; publicKey: string; orgId: string }>();
        const requiredByType: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
        let totalTransferGas = 0;

        for (const recipient of recipients) {
            const rawAddress = recipient.toAddress.trim();
            if (!rawAddress) {
                (window as any).showToast('请输入收款地址', 'error');
                return;
            }

        const capsule = isCapsuleAddress(rawAddress);
        if (capsule && isCross) {
            (window as any).showToast('跨链转账不支持胶囊地址', 'error');
            return;
        }

        const resolved = capsule ? recipient.resolvedAddress : rawAddress;
        if (capsule && !resolved) {
            (window as any).showToast('请先验证胶囊地址', 'error');
            return;
        }

        const addressCheck = validateRecipientAddressFormat(resolved || '', isCross, rawAddress);
        if (!addressCheck.ok) {
            (window as any).showToast(addressCheck.error || '地址格式不正确', 'error');
            return;
        }

        const coinType = Number(recipient.coinType ?? 0);
        if (![0, 1, 2].includes(coinType)) {
            (window as any).showToast('币种类型不正确', 'error');
            return;
        }

        if (isCross && coinType !== 0) {
            (window as any).showToast('跨链转账仅支持 PGC', 'error');
            return;
        }

        if (!isCross) {
            const typeOk = await ensureRecipientTypeMatches(addressCheck.normalized, coinType, recipient.verifiedType);
            if (!typeOk) return;
        }

        const amountCheck = validateAmountInput(recipient.amount);
        if (!amountCheck.ok) {
            (window as any).showToast(amountCheck.error || '请输入有效金额', 'error');
            return;
        }

        if (isCross && !Number.isInteger(amountCheck.value)) {
            (window as any).showToast('跨链转账金额必须为整数', 'error');
            return;
        }

        const recipientOrgId = recipient.orgId.trim();
        if (recipientOrgId && !isValidOrgId(recipientOrgId)) {
            (window as any).showToast('担保组织ID格式错误', 'error');
            return;
        }

        const recipientPubKey = recipient.publicKey.trim();
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

        const recipientGas = Number(recipient.transferGas || 0);
        if (!Number.isFinite(recipientGas) || recipientGas < 0) {
            (window as any).showToast('转移Gas必须为非负数', 'error');
            return;
        }

        const normalizedAddress = addressCheck.normalized;
        const existingMeta = addressMetaMap.get(normalizedAddress);
        if (existingMeta) {
            if (
                existingMeta.coinType !== coinType ||
                existingMeta.publicKey !== recipientPubKey ||
                existingMeta.orgId !== recipientOrgId
            ) {
                (window as any).showToast('收款地址重复且信息不一致', 'error');
                return;
            }
        } else {
            addressMetaMap.set(normalizedAddress, {
                coinType,
                publicKey: recipientPubKey,
                orgId: recipientOrgId,
            });
        }

        requiredByType[coinType] += amountCheck.value;
        if (!isCross) {
            totalTransferGas += Math.max(0, recipientGas);
        }

        const mergeKey = `${normalizedAddress}_${coinType}_${recipientPubKey}_${recipientOrgId}`;
        const existingIndex = recipientIndexMap.get(mergeKey);
        if (existingIndex !== undefined) {
            const existing = preparedRecipients[existingIndex];
            existing.amount += amountCheck.value;
            existing.transferGas = (existing.transferGas || 0) + recipientGas;
        } else {
            preparedRecipients.push({
                address: normalizedAddress,
                amount: amountCheck.value,
                coinType,
                publicKey: recipientPubKey,
                orgId: recipientOrgId,
                transferGas: recipientGas,
            });
            recipientIndexMap.set(mergeKey, preparedRecipients.length - 1);
        }
    }

    if (isCross && preparedRecipients.length !== 1) {
        (window as any).showToast('跨链转账仅支持单个收款地址', 'error');
        return;
    }

    const extraGas = Number(extraGasEl?.value || 0);
    if (!Number.isFinite(extraGas) || extraGas < 0) {
        (window as any).showToast('额外Gas必须为非负数', 'error');
        return;
    }

    requiredByType[0] += extraGas;

    const txGas = Number(txGasEl?.value || 1);
    if (!Number.isFinite(txGas) || txGas < 0) {
        (window as any).showToast('交易Gas必须为非负数', 'error');
        return;
    }

    const changeAddresses: Record<number, string> = {
        0: changePGC?.value || '',
        1: changeBTC?.value || '',
        2: changeETH?.value || '',
    };

    const addressMap = new Map(currentAddresses.map((addr) => [addr.address, addr]));
    for (const type of [0, 1, 2]) {
        if (requiredByType[type] <= 0) continue;
        const changeAddress = changeAddresses[type];
        if (!changeAddress) {
            (window as any).showToast('请选择找零地址', 'error');
            return;
        }
        const info = addressMap.get(changeAddress);
        if (!info || info.type !== type) {
            (window as any).showToast('找零地址类型不匹配', 'error');
            return;
        }
    }

    const typeBalances: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
    let availableGas = 0;
    for (const addr of selectedAddresses) {
        typeBalances[addr.type] += getAvailableBalanceForAddress(addr);
        availableGas += Number(addr.estInterest || 0);
    }

    for (const type of [0, 1, 2]) {
        if (requiredByType[type] > (typeBalances[type] || 0) + 1e-8) {
            const coinLabel = COIN_NAMES[type as keyof typeof COIN_NAMES];
            (window as any).showToast(`${coinLabel} 余额不足`, 'error');
            return;
        }
    }

    if (isCross) {
        if (selectedAddresses.length !== 1) {
            (window as any).showToast('跨链转账仅支持单一来源地址', 'error');
            return;
        }
        if (selectedAddresses[0].type !== 0) {
            (window as any).showToast('跨链转账仅支持 PGC 地址', 'error');
            return;
        }
        if (!changeAddresses[0]) {
            (window as any).showToast('跨链转账需设置 PGC 找零地址', 'error');
            return;
        }
    }

    const totalGasNeed = txGas + (isCross ? 0 : totalTransferGas);
    const totalGasBudget = availableGas + extraGas;
    if (totalGasNeed > totalGasBudget + 1e-8) {
        (window as any).showToast('Gas 不足，请调整转移Gas或额外Gas', 'error');
        return;
    }

    if (extraGas > 0) {
        const confirmed = await showConfirmModal(
            '确认Gas兑换',
            `将使用 ${extraGas} PGC 兑换本次交易 Gas，是否继续？`,
            '确认',
            '取消'
        );
        if (!confirmed) return;
    }

        const result = await buildAndSubmitTransfer({
            account,
            fromAddresses: selectedAddresses.map((addr) => addr.address),
            toAddress: preparedRecipients[0]?.address || '',
            amount: preparedRecipients[0]?.amount || 0,
            coinType: preparedRecipients[0]?.coinType || 0,
            transferMode,
            transferGas: preparedRecipients[0]?.transferGas || 0,
            recipientPublicKey: preparedRecipients[0]?.publicKey || '',
            recipientOrgId: preparedRecipients[0]?.orgId || '',
            recipients: preparedRecipients,
            gas: txGas,
            extraGas,
            changeAddresses,
        });

        if (!result.success) {
            throw new Error(result.error || '交易发送失败');
        }

        const successMsg = !hasOrg
            ? '普通转账已提交'
            : transferMode === 'cross'
            ? '跨链转账已提交'
            : '快速转账已提交';

        (window as any).showToast(successMsg, 'success');
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
    isCross: boolean,
    original?: string
): { ok: boolean; normalized: string; error?: string } {
    if (!raw) {
        return { ok: false, normalized: '', error: '请输入收款地址' };
    }

    if (isCross) {
        const input = original || raw;
        if (!/^0x[a-fA-F0-9]{40}$/.test(input)) {
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

function getDisplayDecimals(type: number): number {
    if (type === 0) return 2;
    if (type === 1) return 8;
    return 6;
}

function getAvailableBalanceForAddress(addr: AddressInfo): number {
    const utxoValue = Number(addr.value?.utxoValue ?? addr.balance ?? 0) || 0;
    const lockedUtxoBalance = getLockedUTXOs()
        .filter((lock) => lock.address === addr.address)
        .reduce((sum, lock) => sum + (lock.value || 0), 0);
    const availableUtxo = Math.max(0, utxoValue - lockedUtxoBalance);

    const txCers = addr.txCers || {};
    const txCerBalance = Object.values(txCers).reduce((sum, val) => sum + Number(val || 0), 0);
    const lockedTxCerBalance = Object.keys(txCers).reduce((sum, id) => {
        if (!isTXCerLocked(id)) return sum;
        return sum + (Number((txCers as Record<string, number>)[id]) || 0);
    }, 0);
    const availableTxCer = Math.max(0, txCerBalance - lockedTxCerBalance);

    return availableUtxo + availableTxCer;
}
async function ensureRecipientTypeMatches(address: string, coinType: number, verifiedType?: number): Promise<boolean> {
    const normalized = normalizeAddressInput(address);

    if (verifiedType !== undefined && verifiedType !== coinType) {
        const expected = COIN_NAMES[verifiedType as keyof typeof COIN_NAMES];
        const selected = COIN_NAMES[coinType as keyof typeof COIN_NAMES];
        (window as any).showToast(`收款地址币种为 ${expected}，当前选择 ${selected}`, 'error');
        return false;
    }

    const cached = recipientTypeCache.get(normalized);
    if (cached) {
        if (cached.exists && cached.type !== coinType) {
            const expected = COIN_NAMES[cached.type as keyof typeof COIN_NAMES];
            const selected = COIN_NAMES[coinType as keyof typeof COIN_NAMES];
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
        const expected = COIN_NAMES[type as keyof typeof COIN_NAMES];
        const selected = COIN_NAMES[coinType as keyof typeof COIN_NAMES];
        (window as any).showToast(`收款地址币种为 ${expected}，当前选择 ${selected}`, 'error');
        return false;
    }

    return true;
}

async function fetchRecipientInfo(address: string): Promise<{
    exists: boolean;
    type: number;
    groupId: string;
    isInGroup: boolean;
    publicKey?: string;
} | null> {
    const normalized = normalizeAddressInput(address);
    const result = await queryAddressBalances([normalized]);
    if (!result.success || !result.data || !result.data.length) {
        return null;
    }

    const info = result.data.find((item) => item.address === normalized) || result.data[0];
    if (!info) return null;

    const exists = !!info.exists;
    const groupId = String(info.groupID || '');
    const isInGroup = !!info.isInGroup && groupId !== GROUP_ID_RETAIL && groupId !== GROUP_ID_NOT_EXIST;

    let publicKey = '';
    if (info.publicKey?.x && info.publicKey?.y) {
        try {
            const xHex = bigIntToHex(info.publicKey.x);
            const yHex = bigIntToHex(info.publicKey.y);
            if (xHex && yHex && !/^0+$/.test(xHex) && !/^0+$/.test(yHex)) {
                publicKey = `${xHex},${yHex}`;
            }
        } catch {
            publicKey = '';
        }
    }

    return {
        exists,
        type: Number(info.type ?? 0),
        groupId,
        isInGroup,
        publicKey: publicKey || undefined,
    };
}

function openModal(title: string): { overlay: HTMLDivElement; body: HTMLElement; footer: HTMLElement; close: () => void } {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">${title}</div>
          <button class="modal-close" type="button" aria-label="关闭">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="modal-body"></div>
        <div class="modal-footer"></div>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    const closeBtn = overlay.querySelector('.modal-close') as HTMLButtonElement | null;
    if (closeBtn) {
        closeBtn.addEventListener('click', close);
    }

    return {
        overlay,
        body: overlay.querySelector('.modal-body') as HTMLElement,
        footer: overlay.querySelector('.modal-footer') as HTMLElement,
        close,
    };
}

function showConfirmModal(
    title: string,
    message: string,
    confirmLabel: string,
    cancelLabel: string
): Promise<boolean> {
    return new Promise((resolve) => {
        const modal = openModal(title);
        modal.body.innerHTML = `
          <div class="delete-confirm" style="background: var(--bg-secondary);">
            <div class="delete-confirm-icon">!</div>
            <div class="delete-confirm-title">${message}</div>
          </div>
        `;
        modal.footer.innerHTML = `
          <button class="btn btn-secondary" id="confirmCancelBtn" type="button" style="flex: 1;">${cancelLabel}</button>
          <button class="btn btn-primary" id="confirmOkBtn" type="button" style="flex: 1;">${confirmLabel}</button>
        `;
        modal.footer.style.display = 'flex';

        const cancelBtn = modal.overlay.querySelector('#confirmCancelBtn') as HTMLButtonElement | null;
        const confirmBtn = modal.overlay.querySelector('#confirmOkBtn') as HTMLButtonElement | null;

        const handleClose = (confirmed: boolean) => {
            modal.close();
            resolve(confirmed);
        };

        if (cancelBtn) cancelBtn.addEventListener('click', () => handleClose(false));
        if (confirmBtn) confirmBtn.addEventListener('click', () => handleClose(true));
    });
}
