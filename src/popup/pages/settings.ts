/**
 * 设置页面
 */

import {
    getActiveAccount,
    deleteAccount,
    clearOrganization,
    clearTransactionHistory,
    clearActiveAccount,
    clearSession,
    getEncryptedKey,
    getSettings,
    saveSettings,
    type ExtensionSettings,
    getDappConnections,
    removeDappConnection,
} from '../../core/storage';
import { stopTxStatusSync } from '../../core/txStatus';
import { applyLanguage, applyTheme } from '../utils/appSettings';
import { bindInlineHandlers } from '../utils/inlineHandlers';
import { decryptPrivateKey } from '../../core/keyEncryption';

const TEXT = {
    'zh-CN': {
        title: '设置',
        accountId: '账户 ID',
        accountAddress: '账户地址',
        general: '常规设置',
        walletManager: '钱包管理',
        walletManagerDesc: '管理子钱包地址',
        language: '语言',
        languageDesc: '切换界面语言',
        theme: '主题',
        themeDesc: '切换外观模式',
        autoLock: '自动锁定',
        autoLockDesc: '到时自动锁定钱包',
        security: '安全',
        exportKey: '导出私钥',
        exportKeyDesc: '查看并备份私钥',
        lockWallet: '锁定钱包',
        lockWalletDesc: '立即锁定钱包',
        about: '关于',
        version: '版本',
        developer: '开发者',
        logout: '退出登录',
        logoutDesc: '返回首页',
        connectedSites: '已连接网站',
        connectedSitesDesc: '管理当前站点授权',
        disconnectSite: '断开',
        noConnectedSites: '暂无已连接网站',
        navHome: '首页',
        navHistory: '历史',
        navOrg: '组织',
        navSettings: '设置',
        toastLanguage: '语言已切换',
        toastTheme: '主题已切换',
        toastLogout: '已退出登录',
        verifyPassword: '验证密码',
        passwordPlaceholder: '输入登录密码',
        passwordRequired: '请输入密码',
        passwordInvalid: '密码错误',
        encryptedMissing: '未找到加密数据',
        exportKeyTitle: '导出私钥',
        exportKeyHint: '请妥善保管，避免泄露',
        copyKey: '复制私钥',
        keyCopied: '私钥已复制',
        cancel: '取消',
        confirm: '确认',
        langLabels: { zh: '简体中文', en: 'English' },
        themeLabels: { light: '浅色', dark: '深色' },
        autoLockUnit: '分钟',
    },
    en: {
        title: 'Settings',
        accountId: 'Account ID',
        accountAddress: 'Main Address',
        general: 'General',
        walletManager: 'Wallet Manager',
        walletManagerDesc: 'Manage sub wallets',
        language: 'Language',
        languageDesc: 'Switch UI language',
        theme: 'Theme',
        themeDesc: 'Switch appearance',
        autoLock: 'Auto Lock',
        autoLockDesc: 'Lock wallet automatically',
        security: 'Security',
        exportKey: 'Export Key',
        exportKeyDesc: 'View and back up key',
        lockWallet: 'Lock Wallet',
        lockWalletDesc: 'Lock wallet now',
        about: 'About',
        version: 'Version',
        developer: 'Developer',
        logout: 'Log Out',
        logoutDesc: 'Back to home',
        connectedSites: 'Connected Sites',
        connectedSitesDesc: 'Manage site access',
        disconnectSite: 'Disconnect',
        noConnectedSites: 'No connected sites',
        navHome: 'Home',
        navHistory: 'History',
        navOrg: 'Org',
        navSettings: 'Settings',
        toastLanguage: 'Language switched',
        toastTheme: 'Theme switched',
        toastLogout: 'Logged out',
        verifyPassword: 'Verify Password',
        passwordPlaceholder: 'Enter password',
        passwordRequired: 'Please enter password',
        passwordInvalid: 'Invalid password',
        encryptedMissing: 'Encrypted key not found',
        exportKeyTitle: 'Export Private Key',
        exportKeyHint: 'Keep it safe and never share',
        copyKey: 'Copy Private Key',
        keyCopied: 'Private key copied',
        cancel: 'Cancel',
        confirm: 'Confirm',
        langLabels: { zh: 'Chinese', en: 'English' },
        themeLabels: { light: 'Light', dark: 'Dark' },
        autoLockUnit: 'min',
    },
};

function getText(language: ExtensionSettings['language']) {
    return language === 'en' ? TEXT.en : TEXT['zh-CN'];
}

export async function renderSettings(): Promise<void> {
    const app = document.getElementById('app');
    if (!app) return;

    const account = await getActiveAccount();
    const settings = await getSettings();
    const t = getText(settings.language);
    const connections = account ? await getDappConnections(account.accountId) : {};
    const connectionList = Object.values(connections || {}).sort(
        (a, b) => (b.connectedAt || 0) - (a.connectedAt || 0)
    );

    const languageLabel =
        settings.language === 'zh-CN' ? t.langLabels.zh : t.langLabels.en;
    const themeLabel =
        settings.theme === 'dark' ? t.themeLabels.dark : t.themeLabels.light;
    const autoLockLabel = `${settings.autoLockMinutes} ${t.autoLockUnit}`;

    const logoUrl = chrome.runtime.getURL('logo.png');

    app.innerHTML = `
    <div class="page">
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
        <!-- 账户信息 -->
        <div class="card" style="margin-bottom: 20px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="logo-badge">
              <img src="${logoUrl}" alt="PanguPay" />
            </div>
            <div style="flex: 1; min-width: 0;">
              <div style="font-weight: 600; margin-bottom: 2px;">${t.accountId}</div>
              <div style="font-size: 12px; color: var(--text-primary);">
                ${account?.accountId || (settings.language === 'en' ? 'Not logged in' : '未登录')}
              </div>
              <div style="font-size: 11px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${t.accountAddress}：${account?.mainAddress || '--'}
              </div>
            </div>
          </div>
        </div>

        <!-- 常规设置 -->
        <div class="settings-section">
          <div class="settings-section-title">${t.general}</div>
          <div class="settings-card">
            <button class="settings-row" onclick="navigateTo('walletManager')">
              <span class="settings-row-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 8V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1"></path>
                  <path d="M21 12h-4a2 2 0 0 0 0 4h4"></path>
                </svg>
              </span>
              <span class="settings-row-content">
                <span class="settings-row-title">${t.walletManager}</span>
                <span class="settings-row-desc">${t.walletManagerDesc}</span>
              </span>
              <span class="settings-row-chevron">›</span>
            </button>

            <button class="settings-row" onclick="toggleLanguage()">
              <span class="settings-row-icon settings-row-icon--green">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="9"></circle>
                  <path d="M3 12h18"></path>
                  <path d="M12 3a15 15 0 0 1 0 18"></path>
                  <path d="M12 3a15 15 0 0 0 0 18"></path>
                </svg>
              </span>
              <span class="settings-row-content">
                <span class="settings-row-title">${t.language}</span>
                <span class="settings-row-desc">${t.languageDesc}</span>
              </span>
              <span class="settings-row-meta">${languageLabel}</span>
              <span class="settings-row-chevron">›</span>
            </button>
            
            <button class="settings-row" onclick="toggleTheme()">
              <span class="settings-row-icon settings-row-icon--orange">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"></path>
                </svg>
              </span>
              <span class="settings-row-content">
                <span class="settings-row-title">${t.theme}</span>
                <span class="settings-row-desc">${t.themeDesc}</span>
              </span>
              <span class="settings-row-meta">${themeLabel}</span>
              <span class="settings-row-chevron">›</span>
            </button>
            
            <div class="settings-row settings-row--static">
              <span class="settings-row-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="9"></circle>
                  <path d="M12 7v5l3 3"></path>
                </svg>
              </span>
              <span class="settings-row-content">
                <span class="settings-row-title">${t.autoLock}</span>
                <span class="settings-row-desc">${t.autoLockDesc}</span>
              </span>
              <span class="settings-row-meta">${autoLockLabel}</span>
            </div>
          </div>
        </div>

        <!-- 安全设置 -->
        <div class="settings-section">
          <div class="settings-section-title">${t.security}</div>
          <div class="settings-card">
            <button class="settings-row" onclick="showExportKey()">
              <span class="settings-row-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="7.5" cy="15.5" r="3.5"></circle>
                  <path d="M10.5 15.5h8"></path>
                  <path d="M18.5 15.5v-3"></path>
                  <path d="M16.5 12.5h4"></path>
                </svg>
              </span>
              <span class="settings-row-content">
                <span class="settings-row-title">${t.exportKey}</span>
                <span class="settings-row-desc">${t.exportKeyDesc}</span>
              </span>
              <span class="settings-row-chevron">›</span>
            </button>
            
            <button class="settings-row" onclick="handleLockWallet()">
              <span class="settings-row-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="11" width="18" height="11" rx="2"></rect>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
              </span>
              <span class="settings-row-content">
                <span class="settings-row-title">${t.lockWallet}</span>
                <span class="settings-row-desc">${t.lockWalletDesc}</span>
              </span>
              <span class="settings-row-chevron">›</span>
            </button>
          </div>
        </div>

        <!-- 关于 -->
        <div class="settings-section">
          <div class="settings-section-title">${t.about}</div>
          <div class="settings-card">
            <div class="settings-row settings-row--static">
              <span class="settings-row-icon settings-row-icon--green">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="9"></circle>
                  <path d="M12 8h.01"></path>
                  <path d="M11 12h1v4h1"></path>
                </svg>
              </span>
              <span class="settings-row-content">
                <span class="settings-row-title">${t.version}</span>
                <span class="settings-row-desc">1.0.0</span>
              </span>
            </div>
            
            <div class="settings-row settings-row--static">
              <span class="settings-row-icon settings-row-icon--orange">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
              </span>
              <span class="settings-row-content">
                <span class="settings-row-title">${t.developer}</span>
                <span class="settings-row-desc">PanguPay Team</span>
              </span>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">${t.connectedSites}</div>
          <div class="settings-card">
            ${
                connectionList.length === 0
                    ? `<div class="settings-empty">${t.noConnectedSites}</div>`
                    : connectionList
                          .map((conn) => {
                              const origin = conn.origin || '';
                              const title = conn.title || origin.replace(/^https?:\/\//, '');
                              const address = conn.address
                                  ? `${conn.address.slice(0, 8)}...${conn.address.slice(-6)}`
                                  : '--';
                              return `
                <div class="settings-row settings-row--static settings-row--site">
                  <span class="settings-row-icon settings-row-icon--green">
                    ${
                        conn.icon
                            ? `<img src="${conn.icon}" alt="${title}" />`
                            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="9"></circle>
                                <path d="M3 12h18"></path>
                                <path d="M12 3a15 15 0 0 1 0 18"></path>
                              </svg>`
                    }
                  </span>
                  <span class="settings-row-content">
                    <span class="settings-row-title">${title}</span>
                    <span class="settings-row-desc">${origin}</span>
                    <span class="settings-row-desc">${address}</span>
                  </span>
                  <button class="btn btn-ghost btn-sm settings-row-action" onclick="disconnectSite('${origin}')">
                    ${t.disconnectSite}
                  </button>
                </div>
              `;
                          })
                          .join('')
            }
          </div>
        </div>

        <div class="settings-footer">
          <button class="btn btn-danger btn-block" onclick="handleLogout()">
            ${t.logout}
          </button>
        </div>
      </div>

      <!-- 底部导航 -->
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
        <button class="nav-item active" onclick="navigateTo('settings')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
          <span>${t.navSettings}</span>
        </button>
      </nav>
    </div>
  `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
        toggleLanguage,
        toggleTheme,
        showExportKey,
        handleLockWallet,
        handleLogout,
        disconnectSite,
    });
}

async function toggleLanguage(): Promise<void> {
    const settings = await getSettings();
    const newLang = settings.language === 'zh-CN' ? 'en' : 'zh-CN';
    await saveSettings({ language: newLang });
    applyLanguage(newLang);
    const t = getText(newLang);
    (window as any).showToast(t.toastLanguage, 'success');
    renderSettings();
}

async function toggleTheme(): Promise<void> {
    const settings = await getSettings();
    const newTheme = settings.theme === 'dark' ? 'light' : 'dark';
    await saveSettings({ theme: newTheme });
    applyTheme(newTheme);
    const t = getText(settings.language);
    (window as any).showToast(t.toastTheme, 'success');
    renderSettings();
}

function handleLockWallet(): void {
    clearSession();
    stopTxStatusSync();
    (window as any).showToast('钱包已锁定', 'info');
    (window as any).navigateTo('unlock');
}

async function handleLogout(): Promise<void> {
    const settings = await getSettings();
    const t = getText(settings.language);
    const account = await getActiveAccount();

    if (account) {
        await deleteAccount(account.accountId);
        await clearOrganization(account.accountId);
        await clearTransactionHistory(account.accountId);
    }

    await clearActiveAccount();
    clearSession();
    stopTxStatusSync();
    (window as any).showToast(t.toastLogout, 'info');
    (window as any).navigateTo('welcome');
}

async function disconnectSite(origin: string): Promise<void> {
    const account = await getActiveAccount();
    if (!account) return;
    await removeDappConnection(account.accountId, origin);
    try {
        await chrome.runtime.sendMessage({
            type: 'PANGU_DAPP_NOTIFY',
            payload: { origin, event: 'disconnect' },
        });
    } catch {
        // ignore
    }
    (window as any).showToast('已断开连接', 'info');
    renderSettings();
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
        if (event.target === overlay) close();
    });

    return {
        overlay,
        body: overlay.querySelector('.modal-body') as HTMLElement,
        footer: overlay.querySelector('.modal-footer') as HTMLElement,
        close,
    };
}

async function showExportKey(): Promise<void> {
    const settings = await getSettings();
    const t = getText(settings.language);
    const account = await getActiveAccount();
    if (!account) return;

    const encrypted = await getEncryptedKey(account.accountId);
    if (!encrypted) {
        (window as any).showToast(t.encryptedMissing, 'error');
        return;
    }

    const modal = openModal(t.exportKeyTitle || t.exportKey);
    modal.body.innerHTML = `
      <div class="input-group" style="margin-bottom: 8px;">
        <label class="input-label">${t.verifyPassword}</label>
        <input type="password" class="input" id="exportKeyPassword" placeholder="${t.passwordPlaceholder}">
        <div class="input-hint">${t.exportKeyHint}</div>
      </div>
    `;
    modal.footer.innerHTML = `
      <button class="btn btn-secondary" id="exportCancelBtn" type="button" style="flex: 1;">${t.cancel}</button>
      <button class="btn btn-primary" id="exportConfirmBtn" type="button" style="flex: 1;">${t.confirm}</button>
    `;
    modal.footer.style.display = 'flex';

    const cancelBtn = modal.overlay.querySelector('#exportCancelBtn') as HTMLButtonElement | null;
    const confirmBtn = modal.overlay.querySelector('#exportConfirmBtn') as HTMLButtonElement | null;

    if (cancelBtn) cancelBtn.addEventListener('click', modal.close);
    if (confirmBtn) {
        confirmBtn.addEventListener('click', async () => {
            const passwordEl = modal.overlay.querySelector<HTMLInputElement>('#exportKeyPassword');
            const password = passwordEl?.value.trim() || '';
            if (!password) {
                (window as any).showToast(t.passwordRequired, 'info');
                return;
            }
            try {
                const privKey = await decryptPrivateKey(
                    encrypted.encrypted,
                    encrypted.salt,
                    encrypted.iv,
                    password
                );
                modal.body.innerHTML = `
                  <div class="capsule-block">
                    <div class="capsule-label">${t.exportKeyTitle}</div>
                    <div class="capsule-code">${privKey}</div>
                    <div class="capsule-hint" style="color: var(--warning);">${t.exportKeyHint}</div>
                  </div>
                `;
                modal.footer.innerHTML = `
                  <button class="btn btn-secondary" id="exportCloseBtn" type="button" style="flex: 1;">${t.cancel}</button>
                  <button class="btn btn-primary" id="exportCopyBtn" type="button" style="flex: 1;">${t.copyKey}</button>
                `;
                const copyBtn = modal.overlay.querySelector('#exportCopyBtn') as HTMLButtonElement | null;
                const closeBtn = modal.overlay.querySelector('#exportCloseBtn') as HTMLButtonElement | null;
                if (closeBtn) closeBtn.addEventListener('click', modal.close);
                if (copyBtn) {
                    copyBtn.addEventListener('click', () => {
                        navigator.clipboard.writeText(privKey).then(() => {
                            (window as any).showToast(t.keyCopied, 'success');
                        });
                    });
                }
            } catch (error) {
                (window as any).showToast(t.passwordInvalid, 'error');
            }
        });
    }
}
