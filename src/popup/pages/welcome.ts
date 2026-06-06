/**
 * First-run welcome page.
 */

import { bindInlineHandlers } from '../utils/inlineHandlers';
import { getActiveLanguage } from '../utils/appSettings';
import { escapeHtml, renderNotice } from '../utils/ui';

const TEXT = {
    'zh-CN': {
        title: '欢迎使用 PanguPay',
        desc: '本地加密管理私钥，清晰处理链上资产与交易确认。',
        create: '创建新账户',
        import: '登录账户',
        safeTitle: '本地安全存储',
        safeDesc: '私钥仅保存在本机浏览器扩展存储中，请妥善备份。',
    },
    en: {
        title: 'Welcome to PanguPay',
        desc: 'Manage keys locally and review every on-chain transaction clearly.',
        create: 'Create Account',
        import: 'Import Account',
        safeTitle: 'Local key storage',
        safeDesc: 'Private keys stay in this browser extension storage. Keep your backup safe.',
    },
};

export function renderWelcome(): void {
    const app = document.getElementById('app');
    if (!app) return;

    const t = getActiveLanguage() === 'en' ? TEXT.en : TEXT['zh-CN'];
    const logoUrl = chrome.runtime.getURL('logo.png');

    app.innerHTML = `
      <div class="welcome-page welcome-page--refined">
        <div class="welcome-logo">
          <img src="${logoUrl}" alt="PanguPay" />
        </div>
        <h1 class="welcome-title">${escapeHtml(t.title)}</h1>
        <p class="welcome-desc">${escapeHtml(t.desc)}</p>
        <div class="welcome-actions">
          <button class="btn btn-primary btn-block btn-lg" type="button" onclick="navigateTo('create')">
            ${escapeHtml(t.create)}
          </button>
          <button class="btn btn-secondary btn-block" type="button" onclick="navigateTo('import')">
            ${escapeHtml(t.import)}
          </button>
        </div>
        <div class="welcome-security">
          ${renderNotice('info', t.safeTitle, t.safeDesc)}
        </div>
      </div>
    `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
    });
}

export function renderWelcomePage(): void {
    renderWelcome();
}
