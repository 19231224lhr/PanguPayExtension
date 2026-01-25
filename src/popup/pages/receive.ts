/**
 * 接收页面 - 显示收款地址和二维码
 */

import { getActiveAccount, getDefaultWalletAddress, getWalletAddresses, type AddressInfo } from '../../core/storage';
import { COIN_NAMES } from '../../core/types';
import { requestCapsuleAddress } from '../../core/capsule';
import { bindInlineHandlers } from '../utils/inlineHandlers';
import { enhanceCustomSelects } from '../utils/customSelect';

let selectedReceiveAddress = '';
let currentCapsuleAddress = '';
let capsuleRequestId = 0;

export async function renderReceive(): Promise<void> {
    const app = document.getElementById('app');
    if (!app) return;

    const account = await getActiveAccount();
    if (!account) {
        (window as any).navigateTo('home');
        return;
    }

    const walletAddresses = getWalletAddresses(account);
    if (!walletAddresses.length) {
        (window as any).showToast('请先添加钱包地址', 'info');
        (window as any).navigateTo('walletManager');
        return;
    }

    const defaultAddress = getDefaultWalletAddress(account) || walletAddresses[0];
    if (!selectedReceiveAddress || !walletAddresses.some((item) => item.address === selectedReceiveAddress)) {
        selectedReceiveAddress = defaultAddress.address;
    }
    const selectedInfo = walletAddresses.find((item) => item.address === selectedReceiveAddress) || defaultAddress;
    const coinLabel = COIN_NAMES[selectedInfo.type as keyof typeof COIN_NAMES] || 'PGC';
    const coinClass = coinLabel.toLowerCase();

    app.innerHTML = `
    <div class="page">
      <header class="header">
        <button class="header-btn" onclick="navigateTo('home')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <span style="font-weight: 600;">接收</span>
        <div style="width: 32px;"></div>
      </header>
      
      <div class="page-content receive-page">
        <div class="receive-card receive-qr-card">
          <div class="receive-qr" id="qrcode">
            <div class="receive-qr-placeholder">
              <div class="receive-qr-icon">📱</div>
              <div>生成胶囊地址中</div>
            </div>
          </div>
          <div class="receive-title">胶囊收款地址</div>
          <div class="receive-subtitle">分享此二维码即可接收指定币种</div>
          <div class="receive-coin-badge receive-coin-badge--${coinClass}">${coinLabel}</div>
        </div>

        <div class="receive-card">
          <div class="receive-field">
            <label class="receive-label">选择接收地址</label>
            <select id="receiveAddressSelect" class="input receive-select">
              ${walletAddresses
                  .map((item) => {
                      const short = `${item.address.slice(0, 8)}...${item.address.slice(-6)}`;
                      const coin = COIN_NAMES[item.type as keyof typeof COIN_NAMES] || 'PGC';
                      const selected = item.address === selectedInfo.address ? 'selected' : '';
                      return `<option value="${item.address}" ${selected}>${coin} · ${short}</option>`;
                  })
                  .join('')}
            </select>
          </div>

          <div class="receive-field">
            <label class="receive-label">胶囊地址</label>
            <div class="receive-address" id="capsuleAddressValue">生成中...</div>
          </div>

          <button class="btn btn-primary btn-block" id="copyCapsuleBtn" onclick="copyReceiveAddress()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            复制胶囊地址
          </button>
        </div>

        <div class="receive-card receive-coin-card">
          <div class="receive-coin-title">当前可接收币种</div>
          <div class="receive-coin-badge receive-coin-badge--${coinClass}">${coinLabel}</div>
        </div>
      </div>
    </div>
  `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
        copyReceiveAddress,
        handleAddressSelect,
    });

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
    renderReceive();
}

async function updateCapsuleAddress(accountId: string, info: AddressInfo): Promise<void> {
    const targetId = ++capsuleRequestId;
    currentCapsuleAddress = '';
    const addressEl = document.getElementById('capsuleAddressValue');
    const qrContainer = document.getElementById('qrcode');
    const copyBtn = document.getElementById('copyCapsuleBtn') as HTMLButtonElement | null;

    if (addressEl) addressEl.textContent = '生成中...';
    if (copyBtn) copyBtn.disabled = true;
    if (qrContainer) {
        qrContainer.innerHTML = `
          <div class="receive-qr-placeholder">
            <div class="receive-qr-icon">📱</div>
            <div>生成胶囊地址中</div>
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
        if (addressEl) addressEl.textContent = (error as Error).message || '生成失败';
        if (copyBtn) copyBtn.disabled = true;
        if (qrContainer) {
            qrContainer.innerHTML = `
              <div class="receive-qr-placeholder">
                <div class="receive-qr-icon">⚠️</div>
                <div>胶囊地址生成失败</div>
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
                dark: '#1d4ed8',
                light: '#ffffff',
            },
        });
        qrContainer.innerHTML = '';
        qrContainer.appendChild(canvas);
    } catch (error) {
        console.log('[接收] 二维码生成失败，使用占位符');
    }
}

function copyReceiveAddress(): void {
    if (!currentCapsuleAddress) {
        (window as any).showToast('请先生成胶囊地址', 'info');
        return;
    }
    navigator.clipboard.writeText(currentCapsuleAddress).then(() => {
        (window as any).showToast('胶囊地址已复制', 'success');
    });
}
