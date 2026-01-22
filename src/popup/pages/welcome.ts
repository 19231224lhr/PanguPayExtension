/**
 * 欢迎页面 - 首次使用
 */

import { bindInlineHandlers } from '../utils/inlineHandlers';

export function renderWelcome(): void {
    const app = document.getElementById('app');
    if (!app) return;

    const logoUrl = chrome.runtime.getURL('logo.png');

    app.innerHTML = `
    <div class="welcome-page">
      <div class="welcome-logo">
        <img src="${logoUrl}" alt="PanguPay" />
      </div>
      <h1 class="welcome-title">欢迎使用 PanguPay</h1>
      <p class="welcome-desc">
        安全、快速、便捷的盘古系统钱包扩展，支持即时到账与跨链转账
      </p>
      <div class="welcome-actions">
        <button class="btn btn-primary btn-block btn-lg" onclick="navigateTo('create')">
          创建新钱包
        </button>
        <button class="btn btn-secondary btn-block" onclick="navigateTo('import')">
          导入已有钱包
        </button>
      </div>
    </div>
  `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
    });
}

// 渲染函数别名
export function renderWelcomePage(): void {
    renderWelcome();
}
