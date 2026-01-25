/**
 * 钱包管理页面 - 地址管理与新增
 */

import {
    getActiveAccount,
    getOnboardingStep,
    getWalletAddresses,
    hasSessionAddressKey,
    setOnboardingStep,
} from '../../core/storage';
import type { AddressInfo } from '../../core/storage';
import { getActiveLanguage } from '../utils/appSettings';
import { bindInlineHandlers } from '../utils/inlineHandlers';
import { COIN_NAMES } from '../../core/types';

const TEXT = {
    'zh-CN': {
        header: '钱包管理',
        walletAddress: '钱包地址',
        created: '新建',
        imported: '导入',
        unlocked: '已解锁',
        locked: '未解锁',
        copy: '复制',
        emptyTitle: '暂无地址',
        emptyDesc: '请新建或导入钱包地址',
        stepTitle: '步骤 3 / 4 · 钱包管理',
        stepDesc: '在这里新增或导入钱包地址，后续可随时管理',
        next: '下一步',
        navHome: '首页',
        navHistory: '历史',
        navOrg: '组织',
        navSettings: '设置',
        currentAccount: '当前账户',
        accountId: '账户 ID',
        chooseAction: '选择操作方式',
        createWallet: '新建钱包',
        createWalletDesc: '生成新的钱包地址',
        importWallet: '导入钱包',
        importWalletDesc: '输入私钥导入或解锁地址',
        addedAddresses: (count: number) => `已添加地址 (${count})`,
        copyToast: '地址已复制',
        needAddress: '请先添加钱包地址',
    },
    en: {
        header: 'Wallet Manager',
        walletAddress: 'Wallet Address',
        created: 'Created',
        imported: 'Imported',
        unlocked: 'Unlocked',
        locked: 'Locked',
        copy: 'Copy',
        emptyTitle: 'No addresses',
        emptyDesc: 'Create or import a wallet address',
        stepTitle: 'Step 3 / 4 · Wallet Manager',
        stepDesc: 'Add or import wallet addresses here for later management',
        next: 'Next',
        navHome: 'Home',
        navHistory: 'History',
        navOrg: 'Org',
        navSettings: 'Settings',
        currentAccount: 'Current Account',
        accountId: 'Account ID',
        chooseAction: 'Choose Action',
        createWallet: 'Create Wallet',
        createWalletDesc: 'Generate a new wallet address',
        importWallet: 'Import Wallet',
        importWalletDesc: 'Import or unlock with a private key',
        addedAddresses: (count: number) => `Added Addresses (${count})`,
        copyToast: 'Address copied',
        needAddress: 'Please add a wallet address first',
    },
};

type WalletText = (typeof TEXT)['zh-CN'];

function getText(): WalletText {
    return getActiveLanguage() === 'en' ? TEXT.en : TEXT['zh-CN'];
}

function renderAddressItem(address: AddressInfo, unlocked: boolean, t: WalletText): string {
    const sourceLabel = address.source === 'created' ? t.created : t.imported;
    const coinLabel = COIN_NAMES[address.type as keyof typeof COIN_NAMES] || 'PGC';
    return `
      <div class="list-item" style="cursor: default;">
        <div class="list-item-icon" style="background: var(--bg-input); color: var(--primary-color);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 10V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3"></path>
            <rect x="3" y="10" width="18" height="10" rx="2"></rect>
          </svg>
        </div>
        <div class="list-item-content">
          <div class="list-item-title">
            ${t.walletAddress}
            <span class="tag tag--neutral">${sourceLabel}</span>
            <span class="tag tag--primary">${coinLabel}</span>
          </div>
          <div class="list-item-subtitle" style="font-family: monospace;">${address.address}</div>
        </div>
        <div class="list-item-value" style="display: grid; gap: 6px; justify-items: end;">
          <span style="font-size: 12px; color: ${unlocked ? 'var(--success)' : 'var(--text-muted)'};">
            ${unlocked ? t.unlocked : t.locked}
          </span>
          <button class="btn btn-ghost btn-sm" onclick="copyAddress('${address.address}')">
            ${t.copy}
          </button>
        </div>
      </div>
    `;
}

export async function renderWalletManager(): Promise<void> {
    const app = document.getElementById('app');
    if (!app) return;

    const t = getText();

    const account = await getActiveAccount();
    if (!account) {
        (window as any).navigateTo('welcome');
        return;
    }

    const step = await getOnboardingStep(account.accountId);
    const isOnboarding = step === 'wallet';
    const backTarget = isOnboarding ? 'welcome' : 'home';
    const walletAddresses = getWalletAddresses(account);

    const addressList = walletAddresses.length
        ? walletAddresses
            .map((item) => {
                const unlocked = hasSessionAddressKey(item.address);
                return renderAddressItem(item, unlocked, t);
            })
            .join('')
        : `
          <div class="empty-state" style="padding: 24px 16px;">
            <div class="empty-title">${t.emptyTitle}</div>
            <div class="empty-desc">${t.emptyDesc}</div>
          </div>
        `;

    const onboardingBanner = isOnboarding
        ? `
        <div class="card onboarding-card" style="margin-bottom: 16px;">
          <div style="font-weight: 600; margin-bottom: 6px;">${t.stepTitle}</div>
          <div style="font-size: 12px; color: var(--text-secondary);">
            ${t.stepDesc}
          </div>
        </div>
        `
        : '';

    const footerBlock = isOnboarding
        ? `
        <div class="onboarding-actions">
          <button class="btn btn-primary btn-block" onclick="continueToOrganization()">
            ${t.next}
          </button>
        </div>
        `
        : `
        <nav class="bottom-nav">
          <button class="nav-item" onclick="navigateTo('home')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
            <span>${t.navHome}</span>
          </button>
          <button class="nav-item" onclick="navigateTo('history')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            <span>${t.navHistory}</span>
          </button>
          <button class="nav-item" onclick="navigateTo('organization')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
            <span>${t.navOrg}</span>
          </button>
          <button class="nav-item" onclick="navigateTo('settings')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            <span>${t.navSettings}</span>
          </button>
        </nav>
        `;

    app.innerHTML = `
    <div class="page">
      <header class="header">
        <button class="header-btn" onclick="navigateTo('${backTarget}')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <span style="font-weight: 600;">${t.header}</span>
        <div style="width: 32px;"></div>
      </header>

      <div class="page-content">
        ${onboardingBanner}

        <div class="card" style="margin-bottom: 16px;">
          <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 6px;">${t.currentAccount}</div>
          <div style="font-weight: 600; margin-bottom: 4px;">${t.accountId}: ${account.accountId}</div>
          <div style="font-family: monospace; font-size: 12px; color: var(--text-muted);">
            ${account.mainAddress}
          </div>
        </div>

        <div class="list-section">
          <div class="list-title">${t.chooseAction}</div>
          <div class="list-item" onclick="navigateTo('walletCreate')">
            <div class="list-item-icon" style="background: rgba(37, 99, 235, 0.1); color: var(--primary-color);">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="16"></line>
                <line x1="8" y1="12" x2="16" y2="12"></line>
              </svg>
            </div>
            <div class="list-item-content">
              <div class="list-item-title">${t.createWallet}</div>
              <div class="list-item-subtitle">${t.createWalletDesc}</div>
            </div>
            <div class="list-item-value">›</div>
          </div>

          <div class="list-item" onclick="navigateTo('walletImport')">
            <div class="list-item-icon" style="background: rgba(16, 185, 129, 0.1); color: var(--success);">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </div>
            <div class="list-item-content">
              <div class="list-item-title">${t.importWallet}</div>
              <div class="list-item-subtitle">${t.importWalletDesc}</div>
            </div>
            <div class="list-item-value">›</div>
          </div>
        </div>

        <div class="list-section">
          <div class="list-title">${t.addedAddresses(walletAddresses.length)}</div>
          ${addressList}
        </div>
      </div>

      ${footerBlock}
    </div>
  `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
        copyAddress,
        continueToOrganization,
    });
}

function copyAddress(address: string): void {
    navigator.clipboard.writeText(address).then(() => {
        const t = getText();
        (window as any).showToast(t.copyToast, 'success');
    });
}

async function continueToOrganization(): Promise<void> {
    const account = await getActiveAccount();
    if (!account) return;
    const walletAddresses = getWalletAddresses(account);
    if (walletAddresses.length === 0) {
        const t = getText();
        (window as any).showToast(t.needAddress, 'info');
        return;
    }
    await setOnboardingStep(account.accountId, 'organization');
    (window as any).navigateTo('organization');
}
