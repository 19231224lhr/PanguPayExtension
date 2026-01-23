/**
 * 钱包管理页面 - 地址管理与新增
 */

import {
    getActiveAccount,
    getOnboardingStep,
    getDefaultWalletAddress,
    getWalletAddresses,
    hasSessionAddressKey,
    setOnboardingStep,
} from '../../core/storage';
import type { AddressInfo } from '../../core/storage';
import { bindInlineHandlers } from '../utils/inlineHandlers';

function renderAddressItem(address: AddressInfo, isDefault: boolean, unlocked: boolean): string {
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
            钱包地址
            ${isDefault ? '<span class="org-badge" style="background: var(--primary-color);">默认</span>' : ''}
          </div>
          <div class="list-item-subtitle" style="font-family: monospace;">${address.address}</div>
        </div>
        <div class="list-item-value" style="display: grid; gap: 6px; justify-items: end;">
          <span style="font-size: 12px; color: ${unlocked ? 'var(--success)' : 'var(--text-muted)'};">
            ${unlocked ? '已解锁' : '未解锁'}
          </span>
          <button class="btn btn-ghost btn-sm" onclick="copyAddress('${address.address}')">
            复制
          </button>
        </div>
      </div>
    `;
}

export async function renderWalletManager(): Promise<void> {
    const app = document.getElementById('app');
    if (!app) return;

    const account = await getActiveAccount();
    if (!account) {
        (window as any).navigateTo('welcome');
        return;
    }

    const step = await getOnboardingStep(account.accountId);
    const isOnboarding = step === 'wallet';
    const backTarget = isOnboarding ? 'welcome' : 'home';
    const walletAddresses = getWalletAddresses(account);
    const defaultAddress = getDefaultWalletAddress(account);

    const addressList = walletAddresses.length
        ? walletAddresses
            .map((item) => {
                const isDefault = defaultAddress?.address === item.address;
                const unlocked = hasSessionAddressKey(item.address);
                return renderAddressItem(item, isDefault, unlocked);
            })
            .join('')
        : `
          <div class="empty-state" style="padding: 24px 16px;">
            <div class="empty-title">暂无地址</div>
            <div class="empty-desc">请新建或导入钱包地址</div>
          </div>
        `;

    const onboardingBanner = isOnboarding
        ? `
        <div class="card onboarding-card" style="margin-bottom: 16px;">
          <div style="font-weight: 600; margin-bottom: 6px;">步骤 3 / 4 · 钱包管理</div>
          <div style="font-size: 12px; color: var(--text-secondary);">
            在这里新增或导入钱包地址，后续可随时管理
          </div>
        </div>
        `
        : '';

    const footerBlock = isOnboarding
        ? `
        <div class="onboarding-actions">
          <button class="btn btn-primary btn-block" onclick="continueToOrganization()">
            下一步
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
        `;

    app.innerHTML = `
    <div class="page">
      <header class="header">
        <button class="header-btn" onclick="navigateTo('${backTarget}')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <span style="font-weight: 600;">钱包管理</span>
        <div style="width: 32px;"></div>
      </header>

      <div class="page-content">
        ${onboardingBanner}

        <div class="card" style="margin-bottom: 16px;">
          <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 6px;">当前账户</div>
          <div style="font-weight: 600; margin-bottom: 4px;">账户 ID: ${account.accountId}</div>
          <div style="font-family: monospace; font-size: 12px; color: var(--text-muted);">
            ${account.mainAddress}
          </div>
        </div>

        <div class="list-section">
          <div class="list-title">选择操作方式</div>
          <div class="list-item" onclick="navigateTo('walletCreate')">
            <div class="list-item-icon" style="background: rgba(37, 99, 235, 0.1); color: var(--primary-color);">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="16"></line>
                <line x1="8" y1="12" x2="16" y2="12"></line>
              </svg>
            </div>
            <div class="list-item-content">
              <div class="list-item-title">新建钱包</div>
              <div class="list-item-subtitle">生成新的钱包地址</div>
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
              <div class="list-item-title">导入钱包</div>
              <div class="list-item-subtitle">输入私钥导入或解锁地址</div>
            </div>
            <div class="list-item-value">›</div>
          </div>
        </div>

        <div class="list-section">
          <div class="list-title">已添加地址 (${walletAddresses.length})</div>
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
        (window as any).showToast('地址已复制', 'success');
    });
}

async function continueToOrganization(): Promise<void> {
    const account = await getActiveAccount();
    if (!account) return;
    const walletAddresses = getWalletAddresses(account);
    if (walletAddresses.length === 0) {
        (window as any).showToast('请先添加钱包地址', 'info');
        return;
    }
    await setOnboardingStep(account.accountId, 'organization');
    (window as any).navigateTo('organization');
}
