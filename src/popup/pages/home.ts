/**
 * 首页 - 钱包总览与地址管理
 */

import {
  clearSession,
  getActiveAccount,
  getOrganization,
  getSessionKey,
  getSessionAddressKey,
  getWalletAddresses,
  removePersistedAddressKey,
  removeSessionAddressKey,
  saveAccount,
  type UserAccount,
  type AddressInfo,
} from '../../core/storage';
import { stopTxStatusSync } from '../../core/txStatus';
import { COIN_NAMES } from '../../core/types';
import { requestCapsuleAddress } from '../../core/capsule';
import { registerAddressesOnMainEntry, unbindAddressOnBackend } from '../../core/address';
import { syncAccountAddresses } from '../../core/walletSync';
import { bigIntToHex } from '../../core/signature';
import { isTXCerLocked } from '../../core/txCerLockManager';
import { getLockedUTXOs } from '../../core/utxoLock';
import { getActiveLanguage } from '../utils/appSettings';
import { bindInlineHandlers } from '../utils/inlineHandlers';

const COIN_META: Record<number, { short: string; label: string; className: string; decimals: number }> = {
  0: { short: 'P', label: '盘古币', className: 'pgc', decimals: 2 },
  1: { short: 'B', label: '比特币', className: 'btc', decimals: 8 },
  2: { short: 'E', label: '以太坊', className: 'eth', decimals: 6 },
};

const USDT_RATES: Record<number, number> = {
  0: 1,
  1: 100,
  2: 10,
};

const TEXT = {
  'zh-CN': {
    settings: '设置',
    lock: '锁定',
    walletTitle: '我的钱包',
    walletSubtitle: '安全管理数字资产',
    totalEstimate: '总资产估值',
    subWalletCount: (count: number) => `子钱包 ${count} 个`,
    joinedOrg: (name: string) => `已加入 ${name}`,
    noOrg: '未加入组织',
    refresh: '刷新',
    history: '历史',
    send: '发送',
    receive: '接收',
    org: '组织',
    addressManage: '地址管理',
    addressCount: (count: number) => `${count} 个地址`,
    createWallet: '新建钱包',
    importWallet: '导入钱包',
    noAddressTitle: '暂无地址',
    noAddressDesc: '请先创建或导入子钱包地址',
    navHome: '首页',
    navHistory: '历史',
    navOrg: '组织',
    navSettings: '设置',
    createdLabel: '新建',
    importedLabel: '导入',
    fullAddress: '完整地址',
    copyAddress: '复制地址',
    totalBalance: '总余额',
    availableBalance: '可用余额',
    txCerAvailable: 'TXCer 可用',
    txCerLocked: 'TXCer 锁定',
    export: '导出',
    delete: '删除',
    gas: 'GAS',
    copyToast: '地址已复制',
    lockToast: '钱包已锁定',
    refreshToast: '数据已刷新',
    unlockAddressToast: '请先导入或解锁该地址私钥',
    keyCopied: '私钥已复制',
    addressDeleted: '地址已删除',
    capsuleTitle: '收款胶囊地址',
    capsuleLoading: '正在生成胶囊地址...',
    capsuleCode: '收款码',
    capsuleHint: '将此收款码发送给付款方',
    capsuleCopy: '复制胶囊地址',
    capsuleCopied: '胶囊地址已复制',
    createFailed: '生成失败',
    close: '关闭',
    exportKey: '导出私钥',
    keyHex: '私钥（Hex）',
    keyHint: '请妥善保管，避免泄露',
    copyKey: '复制私钥',
  },
  en: {
    settings: 'Settings',
    lock: 'Lock',
    walletTitle: 'My Wallet',
    walletSubtitle: 'Securely manage digital assets',
    totalEstimate: 'Total Value',
    subWalletCount: (count: number) => `Sub wallets ${count}`,
    joinedOrg: (name: string) => `Joined ${name}`,
    noOrg: 'Not in organization',
    refresh: 'Refresh',
    history: 'History',
    send: 'Send',
    receive: 'Receive',
    org: 'Org',
    addressManage: 'Address Management',
    addressCount: (count: number) => `${count} addresses`,
    createWallet: 'Create Wallet',
    importWallet: 'Import Wallet',
    noAddressTitle: 'No addresses',
    noAddressDesc: 'Create or import a sub wallet first',
    navHome: 'Home',
    navHistory: 'History',
    navOrg: 'Org',
    navSettings: 'Settings',
    createdLabel: 'Created',
    importedLabel: 'Imported',
    fullAddress: 'Full Address',
    copyAddress: 'Copy Address',
    totalBalance: 'Total Balance',
    availableBalance: 'Available',
    txCerAvailable: 'TXCer Available',
    txCerLocked: 'TXCer Locked',
    export: 'Export',
    delete: 'Delete',
    gas: 'GAS',
    copyToast: 'Address copied',
    lockToast: 'Wallet locked',
    refreshToast: 'Data refreshed',
    unlockAddressToast: 'Import or unlock this address first',
    keyCopied: 'Private key copied',
    addressDeleted: 'Address removed',
    capsuleTitle: 'Capsule Address',
    capsuleLoading: 'Generating capsule address...',
    capsuleCode: 'Capsule Code',
    capsuleHint: 'Share this code with the sender',
    capsuleCopy: 'Copy capsule address',
    capsuleCopied: 'Capsule address copied',
    createFailed: 'Failed',
    close: 'Close',
    exportKey: 'Export Private Key',
    keyHex: 'Private Key (Hex)',
    keyHint: 'Keep it safe and never share',
    copyKey: 'Copy Private Key',
  },
};

type HomeText = (typeof TEXT)['zh-CN'];

function getText(): HomeText {
  return getActiveLanguage() === 'en' ? TEXT.en : TEXT['zh-CN'];
}

export async function renderHome(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;

  const t = getText();

  const account = await getActiveAccount();
  if (!account) {
    (window as any).navigateTo('welcome');
    return;
  }

  void registerAddressesOnMainEntry(account).catch((error) => {
    console.error('[Home] 地址注册失败:', error);
  });

  const org = await getOrganization(account.accountId);
  const walletAddresses = getWalletAddresses(account);
  const logoUrl = chrome.runtime.getURL('logo.png');

  const totals = getAvailableTotals(account);
  const pgcBalance = totals.pgc;
  const btcBalance = totals.btc;
  const ethBalance = totals.eth;
  const totalEstimate = Math.round(
    pgcBalance * USDT_RATES[0] + btcBalance * USDT_RATES[1] + ethBalance * USDT_RATES[2]
  );

  const addressList = walletAddresses.length
    ? walletAddresses.map((item) => renderAddressCard(item, t)).join('')
    : `
        <div class="empty-state address-empty">
          <div class="empty-title">${t.noAddressTitle}</div>
          <div class="empty-desc">${t.noAddressDesc}</div>
          <div class="address-empty-actions">
            <button class="btn btn-primary btn-sm" onclick="navigateTo('walletCreate')">${t.createWallet}</button>
            <button class="btn btn-secondary btn-sm" onclick="navigateTo('walletImport')">${t.importWallet}</button>
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
          <button class="header-btn" onclick="handleLock()" title="${t.lock}">
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
                <div class="wallet-hero-name">${t.walletTitle}</div>
                <div class="wallet-hero-subtitle">${t.walletSubtitle}</div>
              </div>
            </div>
            <div class="hero-actions">
              <button class="icon-btn icon-btn--light" onclick="refreshHome()" title="${t.refresh}">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="23 4 23 10 17 10"></polyline>
                  <polyline points="1 20 1 14 7 14"></polyline>
                  <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"></path>
                  <path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14"></path>
                </svg>
              </button>
            </div>
          </div>

          <div class="hero-balance-label">${t.totalEstimate}</div>
          <div class="hero-balance-amount">${totalEstimate.toLocaleString()} <span>USDT</span></div>

          <div class="hero-tags">
            <span class="hero-tag">${t.subWalletCount(walletAddresses.length)}</span>
            <span class="hero-tag">${org?.groupName ? t.joinedOrg(org.groupName) : t.noOrg}</span>
          </div>

          <div class="hero-asset-section">
            <div class="asset-summary asset-summary--hero">
              ${renderAssetCard(0, pgcBalance)}
              ${renderAssetCard(1, btcBalance)}
              ${renderAssetCard(2, ethBalance)}
            </div>
          </div>

        </section>

        <section class="quick-actions">
          <div class="quick-action" onclick="navigateTo('send')">
            <div class="quick-action-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="19" x2="12" y2="5"></line>
                <polyline points="5 12 12 5 19 12"></polyline>
              </svg>
            </div>
            <span class="quick-action-label">${t.send}</span>
          </div>
          <div class="quick-action" onclick="navigateTo('receive')">
            <div class="quick-action-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <polyline points="19 12 12 19 5 12"></polyline>
              </svg>
            </div>
            <span class="quick-action-label">${t.receive}</span>
          </div>
          <div class="quick-action" onclick="navigateTo('history')">
            <div class="quick-action-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
            </div>
            <span class="quick-action-label">${t.history}</span>
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
            <span class="quick-action-label">${t.org}</span>
          </div>
        </section>

        <section class="address-section">
          <div class="address-section-header">
            <div>
              <div class="section-title">${t.addressManage}</div>
              <div class="section-subtitle">${t.addressCount(walletAddresses.length)}</div>
            </div>
            <div class="address-section-actions">
              <button class="icon-btn icon-btn--outline" onclick="navigateTo('walletCreate')" title="${t.createWallet}">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="16"></line>
                  <line x1="8" y1="12" x2="16" y2="12"></line>
                </svg>
              </button>
              <button class="icon-btn icon-btn--outline" onclick="navigateTo('walletImport')" title="${t.importWallet}">
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

  attachAccountUpdateListener();
}

function renderAssetCard(coinType: number, balance: number): string {
  const meta = getCoinMeta(coinType);
  const displayBalance = balance.toFixed(2);
  return `
      <div class="asset-card">
        <div class="asset-name">${COIN_NAMES[coinType as keyof typeof COIN_NAMES]}</div>
        <div class="asset-amount">${displayBalance}</div>
      </div>
    `;
}

function renderAddressCard(address: AddressInfo, t: HomeText): string {
  const meta = getCoinMeta(address.type);
  const coinName = COIN_NAMES[address.type as keyof typeof COIN_NAMES] || 'PGC';
  const sourceLabel = address.source === 'created' ? t.createdLabel : t.importedLabel;
  const shortAddress = address.address.slice(0, 8) + '...' + address.address.slice(-6);
  const detailsId = `address-details-${address.address}`;
  const balanceSnapshot = getAddressBalanceSnapshot(address);
  const totalBalance = balanceSnapshot.total.toFixed(meta.decimals);
  const availableBalance = balanceSnapshot.available.toFixed(meta.decimals);
  const txCerEntries = Object.entries(address.txCers || {});
  const txCerTotal = txCerEntries.reduce((sum, [, value]) => sum + (Number(value) || 0), 0);
  const txCerLocked = txCerEntries.reduce((sum, [id, value]) => {
    if (!isTXCerLocked(id)) return sum;
    return sum + (Number(value) || 0);
  }, 0);
  const txCerAvailable = Math.max(0, txCerTotal - txCerLocked);
  const gasValue = Number(address.estInterest || 0).toFixed(2);

  return `
      <div class="address-card">
        <div class="address-card-header" data-address-header="${address.address}" onclick="toggleAddressDetails('${address.address}')" aria-expanded="false" role="button">
          <div class="address-card-left">
            <div class="coin-badge coin-badge--${meta.className}">${meta.short}</div>
            <div class="address-card-main">
              <div class="address-title">${shortAddress}</div>
              <div class="address-subtitle">${sourceLabel} · ${coinName}</div>
            </div>
          </div>
          <div class="address-card-right">
            <div class="address-balance">${availableBalance} ${coinName}</div>
            <svg class="address-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
        </div>
        <div id="${detailsId}" class="address-details">
          <div class="address-detail-row">
            <div>
              <div class="address-detail-label">${t.fullAddress}</div>
              <div class="address-detail-value">${address.address}</div>
            </div>
            <button class="icon-btn icon-btn--outline copy-icon-btn" onclick="copyAddress('${address.address}')" title="${t.copyAddress}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>
          <div class="address-balance-panel">
            <div class="balance-panel-row">
              <span>${t.totalBalance}</span>
              <span>${totalBalance} ${coinName}</span>
            </div>
            <div class="balance-panel-row">
              <span>${t.availableBalance}</span>
              <span>${availableBalance} ${coinName}</span>
            </div>
            ${txCerTotal > 0
      ? `
            <div class="balance-panel-row balance-panel-row--muted">
              <span>${t.txCerAvailable}</span>
              <span>${txCerAvailable.toFixed(meta.decimals)} ${coinName}</span>
            </div>
            <div class="balance-panel-row balance-panel-row--muted">
              <span>${t.txCerLocked}</span>
              <span>${txCerLocked.toFixed(meta.decimals)} ${coinName}</span>
            </div>
            `
      : ''
    }
          </div>
          <div class="address-gas-row">
            <span>${t.gas}</span>
            <span>${gasValue}</span>
          </div>
          <div class="address-actions">
            <button class="address-action-btn address-action-btn--primary" onclick="showCapsuleReceive('${address.address}')">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none">
                <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4"></path>
                <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 1 0 7.07 7.07L13 20"></path>
              </svg>
              ${t.receive}
            </button>
            <button class="address-action-btn address-action-btn--secondary" onclick="showExportKey('${address.address}')">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              ${t.export}
            </button>
            <button class="address-action-btn address-action-btn--danger" onclick="deleteWalletAddress('${address.address}')">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                <line x1="10" y1="11" x2="10" y2="17"></line>
                <line x1="14" y1="11" x2="14" y2="17"></line>
              </svg>
              ${t.delete}
            </button>
          </div>
        </div>
      </div>
    `;
}

function getAvailableTotals(account: UserAccount): { pgc: number; btc: number; eth: number } {
  const totals = { pgc: 0, btc: 0, eth: 0 };
  const lockedUtxos = getLockedUTXOs();
  const lockedByAddress = lockedUtxos.reduce<Record<string, number>>((sum, item) => {
    const addr = item.address?.toLowerCase() || '';
    if (!addr) return sum;
    sum[addr] = (sum[addr] || 0) + (Number(item.value) || 0);
    return sum;
  }, {});

  const mainAddress = account.mainAddress?.toLowerCase() || '';
  for (const [addr, info] of Object.entries(account.addresses || {})) {
    if (!info) continue;
    const addrLower = addr.toLowerCase();
    if (mainAddress && addrLower === mainAddress) continue;
    const coinType = Number(info.type ?? 0);
    const utxos = info.utxos || {};
    const txCers = info.txCers || {};
    const rawUtxoValue = info.value?.utxoValue;
    const rawTxCerValue = info.value?.txCerValue;
    const rawTotalValue = info.value?.totalValue;

    let utxoBalance = 0;
    if (Object.keys(utxos).length > 0) {
      utxoBalance = Object.values(utxos).reduce<number>((sum, val) => sum + (Number(val?.Value) || 0), 0);
    } else if (Number.isFinite(Number(rawUtxoValue))) {
      utxoBalance = Number(rawUtxoValue || 0);
    } else if (Number.isFinite(Number(rawTotalValue))) {
      const total = Number(rawTotalValue || 0);
      const txc = Number(rawTxCerValue || 0);
      utxoBalance = Math.max(0, total - txc);
    }

    const lockedBalance = lockedByAddress[addrLower] || 0;
    const unlockedUtxoBalance = Math.max(0, utxoBalance - lockedBalance);

    const txCerIds = Object.keys(txCers);
    let txCerBalance = 0;
    if (txCerIds.length > 0) {
      txCerBalance = Object.values(txCers).reduce<number>((sum, val) => sum + (Number(val) || 0), 0);
    } else if (Number.isFinite(Number(rawTxCerValue))) {
      txCerBalance = Number(rawTxCerValue || 0);
    }

    const lockedTxCerBalance = txCerIds.reduce((sum, id) => {
      if (!isTXCerLocked(id)) return sum;
      return sum + (Number((txCers as Record<string, number>)[id]) || 0);
    }, 0);
    const unlockedTxCerBalance = Math.max(0, txCerBalance - lockedTxCerBalance);

    const available = unlockedUtxoBalance + unlockedTxCerBalance;

    if (coinType === 0) totals.pgc += available;
    if (coinType === 1) totals.btc += available;
    if (coinType === 2) totals.eth += available;
  }

  return totals;
}

function attachAccountUpdateListener(): void {
  if (typeof window === 'undefined') return;
  const existing = (window as any).__panguHomeAccountUpdateHandler as EventListener | undefined;
  if (existing) {
    window.removeEventListener('pangu_account_updated', existing);
  }

  const handler = async (event: Event) => {
    if ((window as any).__currentPage !== 'home') return;
    const detail = (event as CustomEvent).detail || {};
    const account = await getActiveAccount();
    if (!account) return;
    if (detail.accountId && detail.accountId !== account.accountId) return;
    renderHome();
  };

  (window as any).__panguHomeAccountUpdateHandler = handler;
  window.addEventListener('pangu_account_updated', handler);
}

function getCoinMeta(type: number): { short: string; label: string; className: string; decimals: number } {
  return COIN_META[type] || COIN_META[0];
}

function getAddressBalanceSnapshot(address: AddressInfo): {
  total: number;
  available: number;
  utxoBalance: number;
  lockedUtxo: number;
  txCerBalance: number;
  lockedTxCer: number;
} {
  const utxos = address.utxos || {};
  const txCers = address.txCers || {};
  const rawUtxoValue = address.value?.utxoValue;
  const rawTxCerValue = address.value?.txCerValue;
  const rawTotalValue = address.value?.totalValue;

  let utxoBalance = 0;
  if (Object.keys(utxos).length > 0) {
    utxoBalance = Object.values(utxos).reduce<number>((sum, val) => sum + (Number(val?.Value) || 0), 0);
  } else if (Number.isFinite(Number(rawUtxoValue))) {
    utxoBalance = Number(rawUtxoValue || 0);
  } else if (Number.isFinite(Number(rawTotalValue))) {
    const total = Number(rawTotalValue || 0);
    const txc = Number(rawTxCerValue || 0);
    utxoBalance = Math.max(0, total - txc);
  } else {
    utxoBalance = Number(address.balance || 0);
  }

  const lockedUtxo = getLockedUTXOs()
    .filter((lock) => lock.address?.toLowerCase() === address.address.toLowerCase())
    .reduce((sum, lock) => sum + (Number(lock.value) || 0), 0);
  const availableUtxo = Math.max(0, utxoBalance - lockedUtxo);

  let txCerBalance = 0;
  if (Object.keys(txCers).length > 0) {
    txCerBalance = Object.values(txCers).reduce<number>((sum, val) => sum + (Number(val) || 0), 0);
  } else if (Number.isFinite(Number(rawTxCerValue))) {
    txCerBalance = Number(rawTxCerValue || 0);
  }

  const lockedTxCer = Object.keys(txCers).reduce((sum, id) => {
    if (!isTXCerLocked(id)) return sum;
    return sum + (Number((txCers as Record<string, number>)[id]) || 0);
  }, 0);
  const availableTxCer = Math.max(0, txCerBalance - lockedTxCer);

  return {
    total: utxoBalance + txCerBalance,
    available: availableUtxo + availableTxCer,
    utxoBalance,
    lockedUtxo,
    txCerBalance,
    lockedTxCer,
  };
}

function copyAddress(address: string): void {
  const t = getText();
  navigator.clipboard.writeText(address).then(() => {
    (window as any).showToast(t.copyToast, 'success');
  });
}

function handleLock(): void {
  const t = getText();
  clearSession();
  stopTxStatusSync();
  (window as any).showToast(t.lockToast, 'info');
  (window as any).navigateTo('unlock');
}

async function refreshHome(): Promise<void> {
  const t = getText();
  const account = await getActiveAccount();
  if (!account) return;

  const walletAddresses = getWalletAddresses(account);
  if (walletAddresses.length > 0) {
    try {
      await syncAccountAddresses(
        account,
        walletAddresses.map((item) => item.address)
      );
      (window as any).showToast(t.refreshToast, 'success');
    } catch (error) {
      (window as any).showToast(
        (error as Error).message || '刷新失败',
        'error'
      );
    }
  } else {
    (window as any).showToast(t.refreshToast, 'success');
  }

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

  const t = getText();
  const modal = openModal(t.capsuleTitle);
  modal.body.innerHTML = `
      <div class="modal-loading">
        <div class="loading-spinner"></div>
        <div>${t.capsuleLoading}</div>
      </div>
    `;
  modal.footer.style.display = 'none';

  try {
    const capsule = await requestCapsuleAddress(account.accountId, address);
    modal.body.innerHTML = `
          <div class="capsule-block">
            <div class="capsule-label">${t.capsuleCode}</div>
            <div class="capsule-code">${capsule}</div>
            <div class="capsule-hint">${t.capsuleHint}</div>
          </div>
        `;
    modal.footer.innerHTML = `
          <button class="btn btn-primary btn-block" id="capsuleCopyBtn">${t.capsuleCopy}</button>
        `;
    modal.footer.style.display = 'flex';
    const copyBtn = modal.overlay.querySelector('#capsuleCopyBtn') as HTMLButtonElement | null;
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(capsule).then(() => {
          (window as any).showToast(t.capsuleCopied, 'success');
        });
      });
    }
  } catch (error) {
    modal.body.innerHTML = `
          <div class="empty-state" style="padding: 24px 8px;">
            <div class="empty-title">${t.createFailed}</div>
            <div class="empty-desc">${(error as Error).message}</div>
          </div>
        `;
    modal.footer.innerHTML = `
          <button class="btn btn-secondary btn-block" id="capsuleCloseBtn">${t.close}</button>
        `;
    modal.footer.style.display = 'flex';
    const closeBtn = modal.overlay.querySelector('#capsuleCloseBtn') as HTMLButtonElement | null;
    if (closeBtn) {
      closeBtn.addEventListener('click', modal.close);
    }
  }
}

function showExportKey(address: string): void {
  const t = getText();
  const privKey = getSessionAddressKey(address);
  if (!privKey) {
    (window as any).showToast(t.unlockAddressToast, 'info');
    return;
  }

  const modal = openModal(t.exportKey);
  modal.body.innerHTML = `
      <div class="capsule-block">
        <div class="capsule-label">${t.keyHex}</div>
        <div class="capsule-code">${privKey}</div>
        <div class="capsule-hint" style="color: var(--warning);">${t.keyHint}</div>
      </div>
    `;
  modal.footer.innerHTML = `
      <button class="btn btn-secondary btn-block" id="exportCopyBtn">${t.copyKey}</button>
    `;
  modal.footer.style.display = 'flex';
  const copyBtn = modal.overlay.querySelector('#exportCopyBtn') as HTMLButtonElement | null;
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(privKey).then(() => {
        (window as any).showToast(t.keyCopied, 'success');
      });
    });
  }
}

function confirmDeleteAddress(): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = openModal('删除地址');
    modal.body.innerHTML = `
          <div class="delete-confirm">
            <div class="delete-confirm-icon">!</div>
            <div class="delete-confirm-title">确认删除该地址？</div>
            <div class="delete-confirm-desc">此操作无法撤销，请谨慎操作。</div>
          </div>
        `;
    modal.footer.innerHTML = `
          <button class="btn btn-secondary" id="deleteCancelBtn" type="button" style="flex: 1;">取消</button>
          <button class="btn btn-danger" id="deleteConfirmBtn" type="button" style="flex: 1;">删除</button>
        `;
    modal.footer.style.display = 'flex';

    const closeBtn = modal.overlay.querySelector('.modal-close') as HTMLButtonElement | null;
    const cancelBtn = modal.overlay.querySelector('#deleteCancelBtn') as HTMLButtonElement | null;
    const confirmBtn = modal.overlay.querySelector('#deleteConfirmBtn') as HTMLButtonElement | null;

    const handleClose = (confirmed: boolean) => {
      modal.close();
      resolve(confirmed);
    };

    if (closeBtn) closeBtn.addEventListener('click', () => handleClose(false));
    if (cancelBtn) cancelBtn.addEventListener('click', () => handleClose(false));
    if (confirmBtn) confirmBtn.addEventListener('click', () => handleClose(true));
  });
}

async function deleteWalletAddress(address: string): Promise<void> {
  const confirmed = await confirmDeleteAddress();
  if (!confirmed) return;

  const account = await getActiveAccount();
  if (!account) return;
  const info = account.addresses[address];
  if (!info) return;

  let pubXHex = info.pubXHex || '';
  let pubYHex = info.pubYHex || '';
  if ((!pubXHex || !pubYHex) && info.publicKeyNew?.X && info.publicKeyNew?.Y) {
    try {
      pubXHex = bigIntToHex(String(info.publicKeyNew.X));
      pubYHex = bigIntToHex(String(info.publicKeyNew.Y));
    } catch {
      pubXHex = pubXHex || '';
      pubYHex = pubYHex || '';
    }
  }

  const unbindResult = await unbindAddressOnBackend(
    account.accountId,
    address,
    pubXHex,
    pubYHex,
    info.type
  );
  if (!unbindResult.success) {
    (window as any).showToast(unbindResult.error || '解绑失败', 'error');
    return;
  }

  delete account.addresses[address];
  removeSessionAddressKey(address);
  const session = getSessionKey();
  if (session && session.accountId === account.accountId) {
    await removePersistedAddressKey(account.accountId, address, session.privKey);
  }

  if (account.defaultAddress === address) {
    const remaining = getWalletAddresses(account);
    account.defaultAddress = remaining[0]?.address;
  }

  await saveAccount(account);
  const t = getText();
  (window as any).showToast(t.addressDeleted, 'success');
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
