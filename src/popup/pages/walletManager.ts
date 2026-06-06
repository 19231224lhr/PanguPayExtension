/**
 * Wallet manager page.
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
import {
    bindNavigation,
    escapeAttr,
    escapeHtml,
    icon,
    renderBottomNav,
    renderCoinBadge,
    renderEmptyState,
    renderHeaderBar,
    renderStatusBadge,
    shortAddress,
} from '../utils/ui';

const TEXT = {
    'zh-CN': {
        header: '钱包管理',
        walletAddress: '钱包地址',
        created: '新建',
        imported: '导入',
        unlocked: '已解锁',
        locked: '未解锁',
        readOnly: '只读',
        seedRepair: 'Seed 修复',
        pendingSeed: 'Seed 待确认',
        registered: '已注册',
        pending: '注册中',
        failed: '注册失败',
        unknown: '未知状态',
        copy: '复制',
        emptyTitle: '暂无地址',
        emptyDesc: '请新建或导入钱包地址',
        stepTitle: '步骤 3 / 4 · 钱包管理',
        stepDesc: '在这里新增或导入钱包地址，后续可随时管理。',
        next: '下一步',
        currentAccount: '当前账户',
        accountId: '账户 ID',
        mainAddress: '主地址',
        chooseAction: '选择操作方式',
        createWallet: '新建钱包',
        createWalletDesc: '生成新的钱包地址与 AddressRootSeed。',
        importWallet: '导入钱包',
        importWalletDesc: '导入 AddressRootSeed 或旧私钥并同步链上状态。',
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
        readOnly: 'Read Only',
        seedRepair: 'Seed Repair',
        pendingSeed: 'Pending Seed',
        registered: 'Registered',
        pending: 'Registering',
        failed: 'Register Failed',
        unknown: 'Unknown',
        copy: 'Copy',
        emptyTitle: 'No addresses',
        emptyDesc: 'Create or import a wallet address',
        stepTitle: 'Step 3 / 4 · Wallet Manager',
        stepDesc: 'Add or import wallet addresses here for later management.',
        next: 'Next',
        currentAccount: 'Current Account',
        accountId: 'Account ID',
        mainAddress: 'Main Address',
        chooseAction: 'Choose Action',
        createWallet: 'Create Wallet',
        createWalletDesc: 'Generate a new address and AddressRootSeed.',
        importWallet: 'Import Wallet',
        importWalletDesc: 'Import AddressRootSeed or legacy key and sync chain state.',
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
    const sourceTone = address.source === 'created' ? 'primary' : 'neutral';
    const registrationState = address.registrationState || 'unknown';
    const registrationTone =
        registrationState === 'registered'
            ? 'success'
            : registrationState === 'pending'
              ? 'warning'
              : registrationState === 'failed'
                ? 'danger'
                : 'neutral';
    const registrationLabel =
        registrationState === 'registered'
            ? t.registered
            : registrationState === 'pending'
              ? t.pending
              : registrationState === 'failed'
                ? t.failed
                : t.unknown;

    const protocolBadges = [
        renderStatusBadge(sourceLabel, sourceTone),
        renderStatusBadge(unlocked ? t.unlocked : t.locked, unlocked ? 'success' : 'neutral'),
        renderStatusBadge(registrationLabel, registrationTone),
        address.readOnly ? renderStatusBadge(t.readOnly, 'warning') : '',
        address.seedRepairRequired ? renderStatusBadge(t.seedRepair, 'danger') : '',
        address.pendingSeedStep || address.pendingNextSeedStep ? renderStatusBadge(t.pendingSeed, 'warning') : '',
    ]
        .filter(Boolean)
        .join('');

    return `
      <article class="wallet-address-item">
        <div class="wallet-address-left">
          ${renderCoinBadge(address.type)}
          <div class="wallet-address-main">
            <div class="wallet-address-title">${escapeHtml(t.walletAddress)}</div>
            <div class="wallet-address-value">${escapeHtml(shortAddress(address.address, 12, 8))}</div>
            <div class="protocol-badges">${protocolBadges}</div>
            <div class="wallet-address-meta">
              Seed ${escapeHtml(String(address.seedChainStep ?? 0))}
              ${address.defaultSpendAlgorithm ? ` · ${escapeHtml(address.defaultSpendAlgorithm)}` : ''}
            </div>
          </div>
        </div>
        <button class="icon-btn icon-btn--outline" type="button" onclick="copyAddress('${escapeAttr(address.address)}')" aria-label="${escapeAttr(t.copy)}">
          ${icon('copy', 15)}
        </button>
      </article>
    `;
}

export async function renderWalletManager(): Promise<void> {
    const app = document.getElementById('app');
    if (!app) return;

    const language = getActiveLanguage();
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
              .map((item) => renderAddressItem(item, hasSessionAddressKey(item.address), t))
              .join('')
        : renderEmptyState({
              title: t.emptyTitle,
              description: t.emptyDesc,
              iconName: 'wallet',
              actionsHtml: `
                <button class="btn btn-primary btn-sm" type="button" data-nav="walletCreate">${escapeHtml(t.createWallet)}</button>
                <button class="btn btn-secondary btn-sm" type="button" data-nav="walletImport">${escapeHtml(t.importWallet)}</button>
              `,
          });

    const onboardingBanner = isOnboarding
        ? `
        <section class="card onboarding-card">
          <div class="onboarding-card-title">${escapeHtml(t.stepTitle)}</div>
          <div class="onboarding-card-desc">${escapeHtml(t.stepDesc)}</div>
        </section>
        `
        : '';

    app.innerHTML = `
      <div class="page wallet-manager-page">
        ${renderHeaderBar({ title: t.header, backPage: backTarget })}
        <div class="page-content">
          ${onboardingBanner}

          <section class="card wallet-manager-account">
            <div class="section-heading">${escapeHtml(t.currentAccount)}</div>
            <div class="copy-row">
              <div class="copy-row-main">
                <div class="copy-row-label">${escapeHtml(t.accountId)}</div>
                <div class="copy-row-value">${escapeHtml(account.accountId)}</div>
              </div>
            </div>
            <div class="copy-row">
              <div class="copy-row-main">
                <div class="copy-row-label">${escapeHtml(t.mainAddress)}</div>
                <div class="copy-row-value">${escapeHtml(account.mainAddress)}</div>
              </div>
              <button class="icon-btn icon-btn--outline" type="button" onclick="copyAddress('${escapeAttr(account.mainAddress)}')" aria-label="${escapeAttr(t.copy)}">
                ${icon('copy', 15)}
              </button>
            </div>
          </section>

          <section class="wallet-action-section">
            <div class="section-heading">${escapeHtml(t.chooseAction)}</div>
            <div class="wallet-action-grid">
              <button class="wallet-action-card" type="button" data-nav="walletCreate">
                <span class="wallet-action-icon wallet-action-icon--primary">${icon('plus', 18)}</span>
                <span class="wallet-action-text">
                  <span class="wallet-action-title">${escapeHtml(t.createWallet)}</span>
                  <span class="wallet-action-desc">${escapeHtml(t.createWalletDesc)}</span>
                </span>
              </button>
              <button class="wallet-action-card" type="button" data-nav="walletImport">
                <span class="wallet-action-icon wallet-action-icon--success">${icon('key', 18)}</span>
                <span class="wallet-action-text">
                  <span class="wallet-action-title">${escapeHtml(t.importWallet)}</span>
                  <span class="wallet-action-desc">${escapeHtml(t.importWalletDesc)}</span>
                </span>
              </button>
            </div>
          </section>

          <section class="wallet-address-section">
            <div class="section-heading">${escapeHtml(t.addedAddresses(walletAddresses.length))}</div>
            <div class="wallet-address-list">${addressList}</div>
          </section>
        </div>

        ${
            isOnboarding
                ? `<div class="onboarding-actions"><button class="btn btn-primary btn-block" type="button" onclick="continueToOrganization()">${escapeHtml(t.next)}</button></div>`
                : renderBottomNav('settings', language)
        }
      </div>
    `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
        copyAddress,
        continueToOrganization,
    });
    bindNavigation(app);
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
