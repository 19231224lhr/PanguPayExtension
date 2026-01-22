/**
 * 首页 - 余额与快捷操作
 */

import { getActiveAccount, getOrganization, clearSession } from '../../core/storage';
import { COIN_NAMES } from '../../core/types';
import { bindInlineHandlers } from '../utils/inlineHandlers';

export async function renderHome(): Promise<void> {
    const app = document.getElementById('app');
    if (!app) return;

    // 获取账户信息
    const account = await getActiveAccount();
    if (!account) {
        (window as any).navigateTo('welcome');
        return;
    }

    const org = await getOrganization(account.accountId);

    // 格式化余额
    const pgcBalance = account.totalBalance[0] || 0;
    const btcBalance = account.totalBalance[1] || 0;
    const ethBalance = account.totalBalance[2] || 0;

    // 截取地址显示
    const shortAddress = account.mainAddress.slice(0, 8) + '...' + account.mainAddress.slice(-6);

    const logoUrl = chrome.runtime.getURL('logo.png');

    app.innerHTML = `
    <div class="page">
      <header class="header">
        <div class="header-logo">
          <img src="${logoUrl}" alt="PanguPay" />
          <span>PanguPay</span>
        </div>
        <div class="header-actions">
          <button class="header-btn" onclick="navigateTo('settings')" title="设置">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
          <button class="header-btn" onclick="handleLock()" title="锁定">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </button>
        </div>
      </header>
      
      <div class="page-content">
        <!-- 余额卡片 -->
        <div class="balance-card">
          <div class="balance-label">总资产 (PGC)</div>
          <div class="balance-amount">${pgcBalance.toFixed(2)}</div>
          <div class="balance-currency">
            ${org ? `<span class="org-badge" style="background: var(--success); margin-right: 8px;">${org.groupName}</span>` : ''}
            ≈ $${(pgcBalance * 0).toFixed(2)} USD
          </div>
          <div class="balance-address">
            <span class="balance-address-text">${shortAddress}</span>
            <button class="copy-btn" onclick="copyAddress('${account.mainAddress}')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>
        </div>

        <!-- 快捷操作 -->
        <div class="quick-actions">
          <div class="quick-action" onclick="navigateTo('send')">
            <div class="quick-action-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="19" x2="12" y2="5"></line>
                <polyline points="5 12 12 5 19 12"></polyline>
              </svg>
            </div>
            <span class="quick-action-label">发送</span>
          </div>
          <div class="quick-action" onclick="navigateTo('receive')">
            <div class="quick-action-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <polyline points="19 12 12 19 5 12"></polyline>
              </svg>
            </div>
            <span class="quick-action-label">接收</span>
          </div>
          <div class="quick-action" onclick="navigateTo('history')">
            <div class="quick-action-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
            </div>
            <span class="quick-action-label">历史</span>
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
            <span class="quick-action-label">组织</span>
          </div>
        </div>

        <!-- 资产列表 -->
        <div class="list-section">
          <div class="list-title">我的资产</div>
          
          <div class="list-item" onclick="selectCoin(0)">
            <div class="list-item-icon" style="background: linear-gradient(135deg, #4a6cf7, #6b8cff); color: white;">
              <span style="font-weight: 700; font-size: 12px;">PGC</span>
            </div>
            <div class="list-item-content">
              <div class="list-item-title">盘古币</div>
              <div class="list-item-subtitle">Pangu Coin</div>
            </div>
            <div class="list-item-value">
              <div class="list-item-amount">${pgcBalance.toFixed(2)}</div>
            </div>
          </div>

          <div class="list-item" onclick="selectCoin(1)">
            <div class="list-item-icon" style="background: linear-gradient(135deg, #f7931a, #ffb347); color: white;">
              <span style="font-weight: 700; font-size: 12px;">BTC</span>
            </div>
            <div class="list-item-content">
              <div class="list-item-title">比特币</div>
              <div class="list-item-subtitle">Bitcoin</div>
            </div>
            <div class="list-item-value">
              <div class="list-item-amount">${btcBalance.toFixed(8)}</div>
            </div>
          </div>

          <div class="list-item" onclick="selectCoin(2)">
            <div class="list-item-icon" style="background: linear-gradient(135deg, #627eea, #8fa8ff); color: white;">
              <span style="font-weight: 700; font-size: 12px;">ETH</span>
            </div>
            <div class="list-item-content">
              <div class="list-item-title">以太坊</div>
              <div class="list-item-subtitle">Ethereum</div>
            </div>
            <div class="list-item-value">
              <div class="list-item-amount">${ethBalance.toFixed(6)}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部导航 -->
      <nav class="bottom-nav">
        <button class="nav-item active" onclick="navigateTo('home')">
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
    </div>
  `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
        copyAddress,
        handleLock,
        selectCoin,
    });
}

function copyAddress(address: string): void {
    navigator.clipboard.writeText(address).then(() => {
        (window as any).showToast('地址已复制', 'success');
    });
}

function handleLock(): void {
    clearSession();
    (window as any).showToast('钱包已锁定', 'info');
    (window as any).navigateTo('unlock');
}

function selectCoin(coinType: number): void {
    console.log('选择币种:', coinType);
}
