/**
 * Receive page with capsule address and QR code.
 */

import { getActiveAccount, getDefaultWalletAddress, getWalletAddresses, type AddressInfo } from '../../core/storage';
import { COIN_NAMES } from '../../core/types';
import { requestCapsuleAddress } from '../../core/capsule';
import { bindInlineHandlers } from '../utils/inlineHandlers';
import { enhanceCustomSelects } from '../utils/customSelect';
import { getActiveLanguage } from '../utils/appSettings';
import { bindNavigation, escapeAttr, escapeHtml, icon, renderCoinBadge, renderHeaderBar, renderNotice, shortAddress } from '../utils/ui';

let selectedReceiveAddress = '';
let currentCapsuleAddress = '';
let capsuleRequestId = 0;

const TEXT = {
    'zh-CN': {
        title: '接收',
        qrTitle: '胶囊收款地址',
        qrDesc: '分享二维码或胶囊地址即可接收指定币种。',
        select: '选择接收地址',
        capsule: '胶囊地址',
        generating: '正在生成胶囊地址...',
        failed: '胶囊地址生成失败',
        copy: '复制胶囊地址',
        copied: '胶囊地址已复制',
        noAddress: '请先添加钱包地址',
        retry: '切换地址后会自动重新生成',
        safeTitle: '仅用于收款',
        safeDesc: '胶囊地址不会暴露私钥，请确认币种后再分享。',
    },
    en: {
        title: 'Receive',
        qrTitle: 'Capsule Address',
        qrDesc: 'Share the QR code or capsule address to receive the selected coin.',
        select: 'Receive Address',
        capsule: 'Capsule Address',
        generating: 'Generating capsule address...',
        failed: 'Failed to generate capsule address',
        copy: 'Copy Capsule Address',
        copied: 'Capsule address copied',
        noAddress: 'Add a wallet address first',
        retry: 'Changing address regenerates the capsule automatically',
        safeTitle: 'Receive only',
        safeDesc: 'Capsule addresses do not expose private keys. Check the coin before sharing.',
    },
};

function getText() {
    return getActiveLanguage() === 'en' ? TEXT.en : TEXT['zh-CN'];
}

export async function renderReceive(): Promise<void> {
    const app = document.getElementById('app');
    if (!app) return;

    const t = getText();
    const account = await getActiveAccount();
    if (!account) {
        (window as any).navigateTo('home');
        return;
    }

    const walletAddresses = getWalletAddresses(account);
    if (!walletAddresses.length) {
        (window as any).showToast(t.noAddress, 'info');
        (window as any).navigateTo('walletManager');
        return;
    }

    const defaultAddress = getDefaultWalletAddress(account) || walletAddresses[0];
    if (!selectedReceiveAddress || !walletAddresses.some((item) => item.address === selectedReceiveAddress)) {
        selectedReceiveAddress = defaultAddress.address;
    }
    const selectedInfo = walletAddresses.find((item) => item.address === selectedReceiveAddress) || defaultAddress;
    const coinLabel = COIN_NAMES[selectedInfo.type as keyof typeof COIN_NAMES] || 'PGC';

    app.innerHTML = `
      <div class="page receive-page-shell">
        ${renderHeaderBar({ title: t.title, backPage: 'home' })}
        <div class="page-content receive-page">
          <div class="receive-card receive-qr-card">
            <div class="receive-qr" id="qrcode">
              <div class="receive-qr-placeholder">
                <div class="loading-spinner"></div>
                <div>${escapeHtml(t.generating)}</div>
              </div>
            </div>
            <div class="receive-title">${escapeHtml(t.qrTitle)}</div>
            <div class="receive-subtitle">${escapeHtml(t.qrDesc)}</div>
            ${renderCoinBadge(selectedInfo.type, true)}
          </div>

          <div class="receive-card">
            <div class="receive-field">
              <label class="receive-label" for="receiveAddressSelect">${escapeHtml(t.select)}</label>
              <select id="receiveAddressSelect" class="input receive-select">
                ${walletAddresses
                    .map((item) => {
                        const short = shortAddress(item.address, 8, 6);
                        const coin = COIN_NAMES[item.type as keyof typeof COIN_NAMES] || 'PGC';
                        const selected = item.address === selectedInfo.address ? 'selected' : '';
                        return `<option value="${escapeAttr(item.address)}" ${selected}>${escapeHtml(coin)} - ${escapeHtml(short)}</option>`;
                    })
                    .join('')}
              </select>
            </div>

            <div class="receive-field">
              <label class="receive-label">${escapeHtml(t.capsule)}</label>
              <div class="copy-row">
                <div class="copy-row-main">
                  <div class="copy-row-value" id="capsuleAddressValue">${escapeHtml(t.generating)}</div>
                </div>
              </div>
            </div>

            <button class="btn btn-primary btn-block" id="copyCapsuleBtn" type="button" onclick="copyReceiveAddress()" disabled>
              ${icon('copy', 16)}
              ${escapeHtml(t.copy)}
            </button>
          </div>

          ${renderNotice('info', t.safeTitle, t.safeDesc)}
        </div>
      </div>
    `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
        copyReceiveAddress,
    });
    bindNavigation(app);

    enhanceCustomSelects(app);

    const selectEl = document.getElementById('receiveAddressSelect') as HTMLSelectElement | null;
    if (selectEl) {
        selectEl.addEventListener('change', () => {
            handleAddressSelect(selectEl.value);
        });
    }

    await updateCapsuleAddress(account.accountId, selectedInfo);
}

function handleAddressSelect(address: string): void {
    selectedReceiveAddress = address;
    void renderReceive();
}

async function updateCapsuleAddress(accountId: string, info: AddressInfo): Promise<void> {
    const t = getText();
    const targetId = ++capsuleRequestId;
    currentCapsuleAddress = '';
    const addressEl = document.getElementById('capsuleAddressValue');
    const qrContainer = document.getElementById('qrcode');
    const copyBtn = document.getElementById('copyCapsuleBtn') as HTMLButtonElement | null;

    if (addressEl) addressEl.textContent = t.generating;
    if (copyBtn) copyBtn.disabled = true;
    if (qrContainer) {
        qrContainer.innerHTML = `
          <div class="receive-qr-placeholder">
            <div class="loading-spinner"></div>
            <div>${escapeHtml(t.generating)}</div>
          </div>
        `;
    }

    try {
        const capsule = await requestCapsuleAddress(accountId, info.address);
        if (targetId !== capsuleRequestId) return;
        currentCapsuleAddress = capsule;
        if (addressEl) addressEl.textContent = capsule;
        if (copyBtn) copyBtn.disabled = false;
        await renderQrCode(capsule);
    } catch (error) {
        if (targetId !== capsuleRequestId) return;
        if (addressEl) addressEl.textContent = (error as Error).message || t.failed;
        if (copyBtn) copyBtn.disabled = true;
        if (qrContainer) {
            qrContainer.innerHTML = `
              <div class="receive-qr-placeholder receive-qr-placeholder--error">
                ${icon('alert', 32)}
                <div>${escapeHtml(t.failed)}</div>
              </div>
            `;
        }
    }
}

async function renderQrCode(value: string): Promise<void> {
    const qrContainer = document.getElementById('qrcode');
    if (!qrContainer || !value) return;
    try {
        const QRCode = (await import('qrcode')).default;
        const canvas = document.createElement('canvas');
        await QRCode.toCanvas(canvas, value, {
            width: 190,
            margin: 2,
            color: {
                dark: '#1f5eff',
                light: '#ffffff',
            },
        });
        qrContainer.innerHTML = '';
        qrContainer.appendChild(canvas);
    } catch (error) {
        console.log('[Receive] QR generation failed:', error);
    }
}

function copyReceiveAddress(): void {
    const t = getText();
    if (!currentCapsuleAddress) {
        (window as any).showToast(t.retry, 'info');
        return;
    }
    navigator.clipboard.writeText(currentCapsuleAddress).then(() => {
        (window as any).showToast(t.copied, 'success');
    });
}
