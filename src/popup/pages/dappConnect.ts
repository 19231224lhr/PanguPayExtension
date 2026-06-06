/**
 * DApp 连接页面
 */

import {
    getActiveAccount,
    getDappPendingConnections,
    getWalletAddresses,
    getSettings,
    type AddressInfo,
} from '../../core/storage';
import { COIN_NAMES } from '../../core/types';
import { bindInlineHandlers } from '../utils/inlineHandlers';
import {
    bindNavigation,
    escapeHtml,
    renderDappSiteCard,
    renderEmptyState,
    renderHeaderBar,
    renderNotice,
    shortAddress,
} from '../utils/ui';

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
    const pendingList = account ? await getDappPendingConnections(account.accountId) : [];
    const pending = pendingList[0] || null;
    const pendingCount = pendingList.length;

    if (!account || !pending) {
        app.innerHTML = `
      <div class="page dapp-connect">
        ${renderHeaderBar({ title: t.title, backPage: 'home' })}
        <div class="page-content">
          ${renderEmptyState({
              title: t.empty,
              description: t.subtitle,
              iconName: 'globe',
              actionsHtml: `<button class="btn btn-primary btn-block" type="button" data-nav="home">${escapeHtml(t.backHome)}</button>`,
          })}
        </div>
      </div>
    `;

        bindInlineHandlers(app, {
            navigateTo: (page: string) => (window as any).navigateTo(page),
        });
        bindNavigation(app);
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
      ${renderHeaderBar({ title: t.title, backPage: 'home' })}

      <div class="page-content">
        ${renderDappSiteCard({
            title: siteName,
            origin: pending.origin,
            iconUrl: siteIcon,
            hint: t.subtitle,
            badge: t.siteLabel,
        })}
        ${renderNotice('info', t.siteLabel, settings.language === 'en'
            ? 'This permission only exposes the selected wallet address.'
            : '本次授权仅向站点暴露所选钱包地址，不签名、不发起交易。')}
        ${
            pendingCount > 1
                ? `<div class="queue-hint">${escapeHtml(settings.language === 'en'
                    ? `${pendingCount - 1} more pending connection request(s)`
                    : `还有 ${pendingCount - 1} 个待处理连接请求`)}</div>`
                : ''
        }

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
                    <span class="address-coin-label">${coinLabel}</span>
                  </div>
                  <div class="list-item-content">
                    <div class="list-item-title">
                      ${escapeHtml(formatAddress(addr.address))}
                      <span class="tag tag--neutral">${escapeHtml(sourceLabel)}</span>
                    </div>
                    <div class="list-item-subtitle">${escapeHtml(t.addressType)}：${escapeHtml(coinLabel)} · ${escapeHtml(shortAddress(addr.address))}</div>
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
    bindNavigation(app);

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
            const remaining = await getDappPendingConnections(account.accountId);
            if (remaining.length > 0) {
                await renderDappConnect();
            } else {
                (window as any).navigateTo('home');
            }
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
                const remaining = await getDappPendingConnections(account.accountId);
                if (remaining.length > 0) {
                    await renderDappConnect();
                } else {
                    (window as any).navigateTo('home');
                }
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
