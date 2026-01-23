/**
 * 首页 - 钱包总览与地址管理
 */

import {
    clearSession,
    getActiveAccount,
    getDefaultWalletAddress,
    getOrganization,
    getSessionAddressKey,
    getWalletAddresses,
    removeSessionAddressKey,
    saveAccount,
    type AddressInfo,
} from '../../core/storage';
import { COIN_NAMES } from '../../core/types';
import { requestCapsuleAddress } from '../../core/capsule';
import { bindInlineHandlers } from '../utils/inlineHandlers';

const COIN_META: Record<number, { short: string; label: string; className: string; decimals: number }> = {
    0: { short: 'P', label: '盘古币', className: 'pgc', decimals: 2 },
    1: { short: 'B', label: '比特币', className: 'btc', decimals: 8 },
    2: { short: 'E', label: '以太坊', className: 'eth', decimals: 6 },
};

export async function renderHome(): Promise<void> {
    const app = document.getElementById('app');
    if (!app) return;

    const account = await getActiveAccount();
    if (!account) {
        (window as any).navigateTo('welcome');
        return;
    }

    const org = await getOrganization(account.accountId);
    const walletAddresses = getWalletAddresses(account);
    const defaultAddress = getDefaultWalletAddress(account);
    const logoUrl = chrome.runtime.getURL('logo.png');

    const pgcBalance = account.totalBalance[0] || 0;
    const btcBalance = account.totalBalance[1] || 0;
    const ethBalance = account.totalBalance[2] || 0;
    const totalEstimate = 0;

    const addressList = walletAddresses.length
        ? walletAddresses
              .map((item) => renderAddressCard(item, defaultAddress?.address === item.address))
              .join('')
        : `
        <div class="empty-state address-empty">
          <div class="empty-title">暂无地址</div>
          <div class="empty-desc">请先创建或导入子钱包地址</div>
          <div class="address-empty-actions">
            <button class="btn btn-primary btn-sm" onclick="navigateTo('walletCreate')">新建钱包</button>
            <button class="btn btn-secondary btn-sm" onclick="navigateTo('walletImport')">导入钱包</button>
          </div>
        </div>
        `;

    app.innerHTML = `
    <div class="page">
      <header class="header">
        <div class="header-logo">
          <img src="${logoUrl}" alt="PanguPay" />
          <span>PanguPay</span>
        </div>
        <div class="header-actions">
          <button class="header-btn" onclick="navigateTo('settings')" title="设置">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
          <button class="header-btn" onclick="handleLock()" title="锁定">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </button>
        </div>
      </header>

      <div class="page-content">
        <section class="wallet-hero">
          <div class="wallet-hero-top">
            <div class="wallet-hero-title">
              <div class="wallet-hero-icon">
                <img src="${logoUrl}" alt="logo" />
              </div>
              <div>
                <div class="wallet-hero-name">我的钱包</div>
                <div class="wallet-hero-subtitle">安全管理数字资产</div>
              </div>
            </div>
            <div class="hero-actions">
              <button class="icon-btn icon-btn--light" onclick="refreshHome()" title="刷新">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="23 4 23 10 17 10"></polyline>
                  <polyline points="1 20 1 14 7 14"></polyline>
                  <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"></path>
                  <path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14"></path>
                </svg>
              </button>
              <button class="icon-btn icon-btn--light" onclick="navigateTo('history')" title="历史">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
              </button>
            </div>
          </div>

          <div class="hero-balance-label">总资产估值</div>
          <div class="hero-balance-amount">${totalEstimate.toFixed(0)} <span>USDT</span></div>

          <div class="hero-tags">
            <span class="hero-tag">子钱包 ${walletAddresses.length} 个</span>
            <span class="hero-tag">${org?.groupName ? `已加入 ${org.groupName}` : '未加入组织'}</span>
          </div>

          <div class="hero-chart">
            ${renderHeroChart()}
            <div class="hero-chart-labels">
              <span>16:44</span>
              <span>16:52</span>
              <span>16:58</span>
            </div>
          </div>
        </section>

        <section class="asset-summary">
          ${renderAssetCard(0, pgcBalance)}
          ${renderAssetCard(1, btcBalance)}
          ${renderAssetCard(2, ethBalance)}
        </section>

        <section class="quick-actions">
          <div class="quick-action" onclick="navigateTo('send')">
            <div class="quick-action-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="19" x2="12" y2="5"></line>
                <polyline points="5 12 12 5 19 12"></polyline>
              </svg>
            </div>
            <span class="quick-action-label">发送</span>
          </div>
          <div class="quick-action" onclick="navigateTo('receive')">
            <div class="quick-action-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <polyline points="19 12 12 19 5 12"></polyline>
              </svg>
            </div>
            <span class="quick-action-label">接收</span>
          </div>
          <div class="quick-action" onclick="navigateTo('history')">
            <div class="quick-action-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
            </div>
            <span class="quick-action-label">历史</span>
          </div>
          <div class="quick-action" onclick="navigateTo('organization')">
            <div class="quick-action-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
            </div>
            <span class="quick-action-label">组织</span>
          </div>
        </section>

        <section class="address-section">
          <div class="address-section-header">
            <div>
              <div class="section-title">地址管理</div>
              <div class="section-subtitle">${walletAddresses.length} 个地址</div>
            </div>
            <div class="address-section-actions">
              <button class="icon-btn icon-btn--outline" onclick="navigateTo('walletCreate')" title="新建钱包">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="16"></line>
                  <line x1="8" y1="12" x2="16" y2="12"></line>
                </svg>
              </button>
              <button class="icon-btn icon-btn--outline" onclick="navigateTo('walletImport')" title="导入钱包">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
              </button>
            </div>
          </div>

          <div class="address-list">
            ${addressList}
          </div>
        </section>
      </div>

      <nav class="bottom-nav">
        <button class="nav-item active" onclick="navigateTo('home')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
            <polyline points="9 22 9 12 15 12 15 22"></polyline>
          </svg>
          <span>首页</span>
        </button>
        <button class="nav-item" onclick="navigateTo('history')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <span>历史</span>
        </button>
        <button class="nav-item" onclick="navigateTo('organization')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="9" cy="7" r="4"></circle>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path>
          </svg>
          <span>组织</span>
        </button>
        <button class="nav-item" onclick="navigateTo('settings')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>
          </svg>
          <span>设置</span>
        </button>
      </nav>
    </div>
  `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
        copyAddress,
        toggleAddressDetails,
        handleLock,
        refreshHome,
        showCapsuleReceive,
        showExportKey,
        deleteWalletAddress,
    });
}

function renderHeroChart(): string {
    return `
      <svg viewBox="0 0 320 60" preserveAspectRatio="none">
        <polyline class="hero-chart-line" points="0,42 35,35 70,38 105,28 140,30 175,24 210,26 245,18 280,22 320,16"></polyline>
        <circle class="hero-chart-point" cx="0" cy="42" r="2"></circle>
        <circle class="hero-chart-point" cx="105" cy="28" r="2"></circle>
        <circle class="hero-chart-point" cx="210" cy="26" r="2"></circle>
        <circle class="hero-chart-point" cx="320" cy="16" r="2"></circle>
      </svg>
    `;
}

function renderAssetCard(coinType: number, balance: number): string {
    const meta = getCoinMeta(coinType);
    return `
      <div class="asset-card">
        <div class="asset-icon asset-icon--${meta.className}">${meta.short}</div>
        <div class="asset-name">${COIN_NAMES[coinType as keyof typeof COIN_NAMES]}</div>
        <div class="asset-amount">${balance.toFixed(meta.decimals)}</div>
      </div>
    `;
}

function renderAddressCard(address: AddressInfo, isDefault: boolean): string {
    const meta = getCoinMeta(address.type);
    const coinName = COIN_NAMES[address.type as keyof typeof COIN_NAMES] || 'PGC';
    const shortAddress = address.address.slice(0, 8) + '...' + address.address.slice(-6);
    const detailsId = `address-details-${address.address}`;
    const balance = (address.balance || 0).toFixed(meta.decimals);

    return `
      <div class="address-card">
        <div class="address-card-header" data-address-header="${address.address}" onclick="toggleAddressDetails('${address.address}')" aria-expanded="false" role="button">
          <div class="address-card-left">
            <div class="coin-badge coin-badge--${meta.className}">${meta.short}</div>
            <div class="address-card-main">
              <div class="address-title">${shortAddress}</div>
              <div class="address-subtitle">
                ${coinName}
                ${isDefault ? '<span class="address-badge">默认</span>' : ''}
              </div>
            </div>
          </div>
          <div class="address-card-right">
            <div class="address-balance">${balance} ${coinName}</div>
            <svg class="address-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
        </div>
        <div id="${detailsId}" class="address-details">
          <div class="address-detail-row">
            <div>
              <div class="address-detail-label">完整地址</div>
              <div class="address-detail-value">${address.address}</div>
            </div>
            <button class="icon-btn icon-btn--outline copy-icon-btn" onclick="copyAddress('${address.address}')" title="复制地址">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>
          <div class="address-balance-panel">
            <div class="balance-panel-row">
              <span>总余额</span>
              <span>${balance} ${coinName}</span>
            </div>
            <div class="balance-panel-row">
              <span>可用余额</span>
              <span>${balance} ${coinName}</span>
            </div>
          </div>
          <div class="address-gas-row">
            <span>GAS</span>
            <span>0.0</span>
          </div>
          <div class="address-actions">
            <button class="address-action-btn address-action-btn--primary" onclick="showCapsuleReceive('${address.address}')">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none">
                <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4"></path>
                <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 1 0 7.07 7.07L13 20"></path>
              </svg>
              收款
            </button>
            <button class="address-action-btn address-action-btn--secondary" onclick="showExportKey('${address.address}')">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              导出
            </button>
            <button class="address-action-btn address-action-btn--danger" onclick="deleteWalletAddress('${address.address}')">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                <line x1="10" y1="11" x2="10" y2="17"></line>
                <line x1="14" y1="11" x2="14" y2="17"></line>
              </svg>
              删除
            </button>
          </div>
        </div>
      </div>
    `;
}

function getCoinMeta(type: number): { short: string; label: string; className: string; decimals: number } {
    return COIN_META[type] || COIN_META[0];
}

function copyAddress(address: string): void {
    navigator.clipboard.writeText(address).then(() => {
        (window as any).showToast('地址已复制', 'success');
    });
}

function handleLock(): void {
    clearSession();
    (window as any).showToast('钱包已锁定', 'info');
    (window as any).navigateTo('unlock');
}

function refreshHome(): void {
    (window as any).showToast('数据已刷新', 'success');
    renderHome();
}

function toggleAddressDetails(address: string): void {
    const details = document.getElementById(`address-details-${address}`);
    const header = document.querySelector<HTMLElement>(`[data-address-header="${address}"]`);
    if (!details || !header) return;

    const isOpen = details.classList.toggle('open');
    header.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    header.classList.toggle('expanded', isOpen);
}

async function showCapsuleReceive(address: string): Promise<void> {
    const account = await getActiveAccount();
    if (!account) return;

    const modal = openModal('收款胶囊地址');
    modal.body.innerHTML = `
      <div class="modal-loading">
        <div class="loading-spinner"></div>
        <div>正在生成胶囊地址...</div>
      </div>
    `;
    modal.footer.style.display = 'none';

    try {
        const capsule = await requestCapsuleAddress(account.accountId, address);
        modal.body.innerHTML = `
          <div class="capsule-block">
            <div class="capsule-label">收款码</div>
            <div class="capsule-code">${capsule}</div>
            <div class="capsule-hint">将此收款码发送给付款方</div>
          </div>
        `;
        modal.footer.innerHTML = `
          <button class="btn btn-primary btn-block" id="capsuleCopyBtn">复制胶囊地址</button>
        `;
        modal.footer.style.display = 'flex';
        const copyBtn = modal.overlay.querySelector('#capsuleCopyBtn') as HTMLButtonElement | null;
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(capsule).then(() => {
                    (window as any).showToast('胶囊地址已复制', 'success');
                });
            });
        }
    } catch (error) {
        modal.body.innerHTML = `
          <div class="empty-state" style="padding: 24px 8px;">
            <div class="empty-title">生成失败</div>
            <div class="empty-desc">${(error as Error).message}</div>
          </div>
        `;
        modal.footer.innerHTML = `
          <button class="btn btn-secondary btn-block" id="capsuleCloseBtn">关闭</button>
        `;
        modal.footer.style.display = 'flex';
        const closeBtn = modal.overlay.querySelector('#capsuleCloseBtn') as HTMLButtonElement | null;
        if (closeBtn) {
            closeBtn.addEventListener('click', modal.close);
        }
    }
}

function showExportKey(address: string): void {
    const privKey = getSessionAddressKey(address);
    if (!privKey) {
        (window as any).showToast('请先导入或解锁该地址私钥', 'info');
        return;
    }

    const modal = openModal('导出私钥');
    modal.body.innerHTML = `
      <div class="capsule-block">
        <div class="capsule-label">私钥（Hex）</div>
        <div class="capsule-code">${privKey}</div>
        <div class="capsule-hint" style="color: var(--warning);">请妥善保管，避免泄露</div>
      </div>
    `;
    modal.footer.innerHTML = `
      <button class="btn btn-secondary btn-block" id="exportCopyBtn">复制私钥</button>
    `;
    modal.footer.style.display = 'flex';
    const copyBtn = modal.overlay.querySelector('#exportCopyBtn') as HTMLButtonElement | null;
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(privKey).then(() => {
                (window as any).showToast('私钥已复制', 'success');
            });
        });
    }
}

async function deleteWalletAddress(address: string): Promise<void> {
    const confirmed = window.confirm('确认删除该地址？此操作无法撤销。');
    if (!confirmed) return;

    const account = await getActiveAccount();
    if (!account) return;
    if (!account.addresses[address]) return;

    delete account.addresses[address];
    removeSessionAddressKey(address);

    if (account.defaultAddress === address) {
        const remaining = getWalletAddresses(account);
        account.defaultAddress = remaining[0]?.address;
    }

    await saveAccount(account);
    (window as any).showToast('地址已删除', 'success');
    renderHome();
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

    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            close();
        }
    });

    const body = overlay.querySelector('.modal-body') as HTMLElement;
    const footer = overlay.querySelector('.modal-footer') as HTMLElement;

    return { overlay, body, footer, close };
}
