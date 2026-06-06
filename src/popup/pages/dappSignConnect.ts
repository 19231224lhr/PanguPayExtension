/**
 * DApp 签名连接页面
 */

import {
    getActiveAccount,
    getDappSignPendingConnections,
    getWalletAddresses,
    getSessionAddressKey,
    getSessionKey,
    getSettings,
    type AddressInfo,
} from '../../core/storage';
import { COIN_NAMES } from '../../core/types';
import { bindInlineHandlers } from '../utils/inlineHandlers';
import { getPublicKeyHexFromPrivate, signMessage } from '../../core/signature';
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
        title: '签名连接',
        subtitle: '签名用于证明你控制该地址',
        addressLabel: '选择地址',
        approve: '签名并连接',
        reject: '拒绝',
        empty: '暂无待签名请求',
        backHome: '返回首页',
        noAddress: '当前没有可用钱包地址',
        needUnlock: '请先解锁该地址私钥',
        signMessage: '签名内容',
    },
    en: {
        title: 'Sign & Connect',
        subtitle: 'Signing proves you control this address',
        addressLabel: 'Select Address',
        approve: 'Sign & Connect',
        reject: 'Reject',
        empty: 'No pending request',
        backHome: 'Back to Home',
        noAddress: 'No wallet address available',
        needUnlock: 'Unlock this address first',
        signMessage: 'Message',
    },
};

function getText(language: 'zh-CN' | 'en') {
    return language === 'en' ? TEXT.en : TEXT['zh-CN'];
}

function formatAddress(address: string): string {
    if (!address) return '--';
    return `${address.slice(0, 10)}...${address.slice(-6)}`;
}

function canSignAddress(address: string, accountMain: string): boolean {
    if (!address) return false;
    if (address.toLowerCase() === accountMain.toLowerCase()) {
        const session = getSessionKey();
        return !!session?.privKey;
    }
    return !!getSessionAddressKey(address);
}

function resolvePrivKey(address: string, accountMain: string): string {
    if (address.toLowerCase() === accountMain.toLowerCase()) {
        return getSessionKey()?.privKey || '';
    }
    return getSessionAddressKey(address) || '';
}

export async function renderDappSignConnect(): Promise<void> {
    const app = document.getElementById('app');
    if (!app) return;

    const settings = await getSettings();
    const t = getText(settings.language);
    const account = await getActiveAccount();
    const pendingList = account ? await getDappSignPendingConnections(account.accountId) : [];
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
              iconName: 'key',
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
    <div class="page dapp-connect dapp-sign">
      ${renderHeaderBar({ title: t.title, backPage: 'home' })}

      <div class="page-content">
        ${renderDappSiteCard({
            title: siteName,
            origin: pending.origin,
            iconUrl: siteIcon,
            hint: t.subtitle,
            badge: settings.language === 'en' ? 'Signature' : '签名',
        })}
        ${renderNotice('warning', settings.language === 'en' ? 'Signature request' : '签名请求',
            settings.language === 'en'
                ? 'Only sign if you trust this site and recognize the message below.'
                : '请确认站点可信，并核对下方签名内容后再继续。')}
        ${
            pendingCount > 1
                ? `<div class="queue-hint">${escapeHtml(settings.language === 'en'
                    ? `${pendingCount - 1} more pending signature request(s)`
                    : `还有 ${pendingCount - 1} 个待处理签名请求`)}</div>`
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
                              const unlocked = canSignAddress(addr.address, account.mainAddress);
                              return `
                <button class="list-item dapp-address-item${unlocked ? '' : ' disabled'}" data-address="${
                                  addr.address
                              }" ${unlocked ? '' : 'disabled'}>
                  <div class="list-item-icon">
                    <span class="address-coin-label">${coinLabel}</span>
                  </div>
                  <div class="list-item-content">
                    <div class="list-item-title">
                      ${escapeHtml(formatAddress(addr.address))}
                    </div>
                    <div class="list-item-subtitle">${
                        escapeHtml(unlocked ? `${coinLabel} · ${shortAddress(addr.address)}` : t.needUnlock)
                    }</div>
                  </div>
                  <div class="dapp-address-radio"></div>
                </button>
              `;
                          })
                          .join('')
            }
          </div>
        </div>

        <div class="card dapp-sign-message">
          <div class="list-title">${t.signMessage}</div>
          <pre>${escapeHtml(pending.message)}</pre>
        </div>

        <div class="dapp-connect-footer">
          <button class="btn btn-secondary btn-block" id="dappRejectBtn">${t.reject}</button>
          <button class="btn btn-primary btn-block" id="dappApproveBtn" disabled>${t.approve}</button>
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
            if (item.disabled) return;
            const address = item.dataset.address || '';
            updateSelection(address);
        });
    });

    if (rejectBtn) {
        rejectBtn.addEventListener('click', async () => {
            await chrome.runtime.sendMessage({
                type: 'PANGU_DAPP_SIGN_REJECT',
                payload: { requestId: pending.requestId },
            });
            (window as any).showToast('已拒绝签名', 'info');
            const remaining = await getDappSignPendingConnections(account.accountId);
            if (remaining.length > 0) {
                await renderDappSignConnect();
            } else {
                (window as any).navigateTo('home');
            }
        });
    }

    if (approveBtn) {
        approveBtn.addEventListener('click', async () => {
            if (!selectedAddress) return;
            const privKey = resolvePrivKey(selectedAddress, account.mainAddress);
            if (!privKey) {
                (window as any).showToast(t.needUnlock, 'warning');
                return;
            }

            approveBtn.disabled = true;
            const signature = signMessage(pending.message, privKey);
            const pubKey = getPublicKeyHexFromPrivate(privKey);

            const response = await chrome.runtime.sendMessage({
                type: 'PANGU_DAPP_SIGN_APPROVE',
                payload: {
                    requestId: pending.requestId,
                    address: selectedAddress,
                    signature,
                    publicKey: pubKey,
                },
            });

            if (response?.success) {
                (window as any).showToast('签名连接成功', 'success');
                const remaining = await getDappSignPendingConnections(account.accountId);
                if (remaining.length > 0) {
                    await renderDappSignConnect();
                } else {
                    (window as any).navigateTo('home');
                }
            } else {
                approveBtn.disabled = false;
                (window as any).showToast(response?.error || '签名失败', 'error');
            }
        });
    }
}
