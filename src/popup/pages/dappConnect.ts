/**
 * DApp 连接页面
 */

import {
    getActiveAccount,
    getDappPendingConnection,
    getWalletAddresses,
    getSettings,
    type AddressInfo,
} from '../../core/storage';
import { COIN_NAMES } from '../../core/types';
import { bindInlineHandlers } from '../utils/inlineHandlers';

const TEXT = {
    'zh-CN': {
        title: '连接站点',
        subtitle: '选择一个钱包地址授权给当前网站',
        siteLabel: '网站',
        addressLabel: '选择地址',
        approve: '确认连接',
        reject: '拒绝',
        empty: '暂无待连接的站点',
        backHome: '返回首页',
        addAddress: '去添加地址',
        noAddress: '当前没有可用钱包地址',
        sourceCreated: '新建',
        sourceImported: '导入',
        addressType: '币种',
    },
    en: {
        title: 'Connect Site',
        subtitle: 'Select a wallet address for this site',
        siteLabel: 'Site',
        addressLabel: 'Select Address',
        approve: 'Approve',
        reject: 'Reject',
        empty: 'No pending requests',
        backHome: 'Back to Home',
        addAddress: 'Add Address',
        noAddress: 'No wallet address available',
        sourceCreated: 'Created',
        sourceImported: 'Imported',
        addressType: 'Coin',
    },
};

function getText(language: 'zh-CN' | 'en') {
    return language === 'en' ? TEXT.en : TEXT['zh-CN'];
}

function formatAddress(address: string): string {
    if (!address) return '--';
    return `${address.slice(0, 10)}...${address.slice(-6)}`;
}

function resolveAddressSource(info: AddressInfo, language: 'zh-CN' | 'en'): string {
    const t = getText(language);
    if (info.source === 'imported') return t.sourceImported;
    if (info.source === 'created') return t.sourceCreated;
    return t.sourceCreated;
}

export async function renderDappConnect(): Promise<void> {
    const app = document.getElementById('app');
    if (!app) return;

    const settings = await getSettings();
    const t = getText(settings.language);
    const account = await getActiveAccount();
    const pending = account ? await getDappPendingConnection(account.accountId) : null;

    if (!account || !pending) {
        app.innerHTML = `
      <div class="page dapp-connect">
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
          <div class="card" style="text-align: center; padding: 24px;">
            <div style="font-weight: 600; margin-bottom: 8px;">${t.empty}</div>
            <button class="btn btn-primary" onclick="navigateTo('home')">${t.backHome}</button>
          </div>
        </div>
      </div>
    `;

        bindInlineHandlers(app, {
            navigateTo: (page: string) => (window as any).navigateTo(page),
        });
        return;
    }

    const addressList = getWalletAddresses(account);
    const addresses: AddressInfo[] =
        addressList.length > 0
            ? addressList
            : account.addresses[account.mainAddress]
              ? [account.addresses[account.mainAddress]]
              : [];

    const siteName = pending.title || pending.origin;
    const siteIcon = pending.icon || '';

    app.innerHTML = `
    <div class="page dapp-connect">
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
        <div class="card dapp-site-card">
          <div class="dapp-site-info">
            <div class="dapp-site-icon">
              ${siteIcon ? `<img src="${siteIcon}" alt="${siteName}" />` : '<span>🌐</span>'}
            </div>
            <div class="dapp-site-text">
              <div class="dapp-site-title">${siteName}</div>
              <div class="dapp-site-origin">${pending.origin}</div>
            </div>
          </div>
          <div class="dapp-site-hint">${t.subtitle}</div>
        </div>

        <div class="list-section">
          <div class="list-title">${t.addressLabel}</div>
          <div class="dapp-address-list">
            ${
                addresses.length === 0
                    ? `<div class="empty-block">${t.noAddress}</div>`
                    : addresses
                          .map((addr) => {
                              const coinLabel = COIN_NAMES[addr.type as keyof typeof COIN_NAMES] || 'PGC';
                              const sourceLabel = resolveAddressSource(addr, settings.language);
                              return `
                <button class="list-item dapp-address-item" data-address="${addr.address}">
                  <div class="list-item-icon">
                    <span style="font-weight: 600;">${coinLabel}</span>
                  </div>
                  <div class="list-item-content">
                    <div class="list-item-title">
                      ${formatAddress(addr.address)}
                      <span class="tag tag--neutral">${sourceLabel}</span>
                    </div>
                    <div class="list-item-subtitle">${t.addressType}：${coinLabel}</div>
                  </div>
                  <div class="dapp-address-radio"></div>
                </button>
              `;
                          })
                          .join('')
            }
          </div>
        </div>

        <div class="dapp-connect-footer">
          <button class="btn btn-secondary btn-block" id="dappRejectBtn">${t.reject}</button>
          <button class="btn btn-primary btn-block" id="dappApproveBtn" disabled>${t.approve}</button>
          ${
              addresses.length === 0
                  ? `<button class="btn btn-ghost btn-block" id="dappAddAddressBtn">${t.addAddress}</button>`
                  : ''
          }
        </div>
      </div>
    </div>
  `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
    });

    const approveBtn = document.getElementById('dappApproveBtn') as HTMLButtonElement | null;
    const rejectBtn = document.getElementById('dappRejectBtn') as HTMLButtonElement | null;
    const addAddressBtn = document.getElementById('dappAddAddressBtn') as HTMLButtonElement | null;

    let selectedAddress = '';
    const addressItems = Array.from(app.querySelectorAll<HTMLButtonElement>('.dapp-address-item'));
    const updateSelection = (address: string) => {
        selectedAddress = address;
        addressItems.forEach((item) => {
            const isActive = item.dataset.address === address;
            item.classList.toggle('selected', isActive);
        });
        if (approveBtn) approveBtn.disabled = !selectedAddress;
    };

    addressItems.forEach((item) => {
        item.addEventListener('click', () => {
            const address = item.dataset.address || '';
            updateSelection(address);
        });
    });

    if (rejectBtn) {
        rejectBtn.addEventListener('click', async () => {
            await chrome.runtime.sendMessage({
                type: 'PANGU_DAPP_REJECT',
                payload: { requestId: pending.requestId },
            });
            (window as any).showToast('已拒绝连接', 'info');
            (window as any).navigateTo('home');
        });
    }

    if (approveBtn) {
        approveBtn.addEventListener('click', async () => {
            if (!selectedAddress) return;
            approveBtn.disabled = true;
            const response = await chrome.runtime.sendMessage({
                type: 'PANGU_DAPP_APPROVE',
                payload: { requestId: pending.requestId, address: selectedAddress, origin: pending.origin },
            });
            if (response?.success) {
                (window as any).showToast('连接成功', 'success');
                (window as any).navigateTo('home');
            } else {
                approveBtn.disabled = false;
                (window as any).showToast(response?.error || '连接失败', 'error');
            }
        });
    }

    if (addAddressBtn) {
        addAddressBtn.addEventListener('click', () => {
            (window as any).navigateTo('walletManager');
        });
    }
}
