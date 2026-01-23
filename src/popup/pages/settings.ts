/**
 * 设置页面
 */

import { getActiveAccount, deleteAccount, clearSession, getSettings, saveSettings, type ExtensionSettings } from '../../core/storage';
import { bindInlineHandlers } from '../utils/inlineHandlers';

export async function renderSettings(): Promise<void> {
    const app = document.getElementById('app');
    if (!app) return;

    const account = await getActiveAccount();
    const settings = await getSettings();

    const logoUrl = chrome.runtime.getURL('logo.png');

    app.innerHTML = `
    <div class="page">
      <header class="header">
        <button class="header-btn" onclick="navigateTo('home')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <span style="font-weight: 600;">设置</span>
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
              <div style="font-weight: 600; margin-bottom: 2px;">账户 ID</div>
              <div style="font-size: 12px; color: var(--text-primary);">
                ${account?.accountId || '未登录'}
              </div>
              <div style="font-size: 11px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                账户地址：${account?.mainAddress || '--'}
              </div>
            </div>
          </div>
        </div>

        <!-- 常规设置 -->
        <div class="list-section">
          <div class="list-title">常规设置</div>
          
          <div class="card" style="padding: 0;">
            <div class="settings-item" onclick="navigateTo('walletManager')">
              <div class="settings-label">钱包管理</div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="settings-arrow">›</span>
              </div>
            </div>

            <div class="settings-item" onclick="toggleLanguage()">
              <div class="settings-label">语言</div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="settings-value">${settings.language === 'zh-CN' ? '简体中文' : 'English'}</span>
                <span class="settings-arrow">›</span>
              </div>
            </div>
            
            <div class="settings-item" onclick="toggleTheme()">
              <div class="settings-label">主题</div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="settings-value">${settings.theme === 'dark' ? '深色' : '浅色'}</span>
                <span class="settings-arrow">›</span>
              </div>
            </div>
            
            <div class="settings-item">
              <div class="settings-label">自动锁定</div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="settings-value">${settings.autoLockMinutes} 分钟</span>
                <span class="settings-arrow">›</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 安全设置 -->
        <div class="list-section">
          <div class="list-title">安全</div>
          
          <div class="card" style="padding: 0;">
            <div class="settings-item" onclick="showExportKey()">
              <div class="settings-label">导出私钥</div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="settings-arrow">›</span>
              </div>
            </div>
            
            <div class="settings-item" onclick="handleLockWallet()">
              <div class="settings-label">锁定钱包</div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="settings-arrow">›</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 关于 -->
        <div class="list-section">
          <div class="list-title">关于</div>
          
          <div class="card" style="padding: 0;">
            <div class="settings-item">
              <div class="settings-label">版本</div>
              <div class="settings-value">1.0.0</div>
            </div>
            
            <div class="settings-item">
              <div class="settings-label">开发者</div>
              <div class="settings-value">PanguPay Team</div>
            </div>
          </div>
        </div>

        <!-- 危险操作 -->
        <div class="list-section">
          <div class="list-title" style="color: var(--error);">危险操作</div>
          
          <button class="btn btn-block" style="background: rgba(239, 68, 68, 0.1); color: var(--error); border: 1px solid var(--error);" onclick="confirmDeleteAccount()">
            删除钱包
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
        <button class="nav-item active" onclick="navigateTo('settings')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>
          </svg>
          <span>设置</span>
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
        confirmDeleteAccount,
    });
}

async function toggleLanguage(): Promise<void> {
    const settings = await getSettings();
    const newLang = settings.language === 'zh-CN' ? 'en' : 'zh-CN';
    await saveSettings({ language: newLang });
    (window as any).showToast('语言已切换', 'success');
    renderSettings();
}

async function toggleTheme(): Promise<void> {
    const settings = await getSettings();
    const newTheme = settings.theme === 'dark' ? 'light' : 'dark';
    await saveSettings({ theme: newTheme });
    (window as any).showToast('主题已切换', 'success');
    renderSettings();
}

function handleLockWallet(): void {
    clearSession();
    (window as any).showToast('钱包已锁定', 'info');
    (window as any).navigateTo('unlock');
}

function showExportKey(): void {
    (window as any).showToast('请先验证密码', 'info');
    // 这里可以弹出模态框验证密码后显示私钥
}

async function confirmDeleteAccount(): Promise<void> {
    const confirmed = confirm('确定要删除钱包吗？此操作不可恢复，请确保已备份私钥！');
    if (!confirmed) return;

    const account = await getActiveAccount();
    if (!account) return;

    try {
        await deleteAccount(account.accountId);
        clearSession();
        (window as any).showToast('钱包已删除', 'success');
        (window as any).navigateTo('welcome');
    } catch (error) {
        (window as any).showToast('删除失败', 'error');
    }
}
