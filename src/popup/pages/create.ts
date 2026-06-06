/**
 * Account creation page.
 */

import { generateKeyPair, generateAddress, generateAccountIdFromPrivate } from '../../core/signature';
import { bindInlineHandlers } from '../utils/inlineHandlers';
import { getActiveLanguage } from '../utils/appSettings';
import { escapeHtml, renderHeaderBar, renderNotice } from '../utils/ui';

let generatedPrivateKey: string | null = null;
let generatedAddress: string | null = null;
let generatedAccountId: string | null = null;

const TEXT = {
    'zh-CN': {
        title: '创建新账户',
        step: '步骤 1 / 4',
        desc: '生成账户 ID 与主私钥，用于后续登录和签名。',
        accountId: '账户 ID',
        address: '主地址',
        keyLabel: '私钥',
        hidden: '点击显示私钥...',
        copy: '复制私钥',
        next: '继续设置密码',
        warningTitle: '请妥善保管私钥',
        warningDesc: '私钥是资产的唯一凭证，请勿截图、泄露或发送给他人。',
        copied: '私钥已复制',
        failed: '密钥生成失败',
    },
    en: {
        title: 'Create Account',
        step: 'Step 1 / 4',
        desc: 'Generate an account ID and main private key for login and signing.',
        accountId: 'Account ID',
        address: 'Main Address',
        keyLabel: 'Private Key',
        hidden: 'Click to reveal private key...',
        copy: 'Copy Private Key',
        next: 'Continue',
        warningTitle: 'Keep your private key safe',
        warningDesc: 'This key controls your assets. Do not screenshot, share, or send it to anyone.',
        copied: 'Private key copied',
        failed: 'Failed to generate key',
    },
};

function getText() {
    return getActiveLanguage() === 'en' ? TEXT.en : TEXT['zh-CN'];
}

export function renderCreate(): void {
    const app = document.getElementById('app');
    if (!app) return;

    const t = getText();
    const { privateKey, publicKey } = generateKeyPair();
    const address = generateAddress(publicKey);
    const accountId = generateAccountIdFromPrivate(privateKey);

    generatedPrivateKey = privateKey;
    generatedAddress = address;
    generatedAccountId = accountId;

    app.innerHTML = `
      <div class="page account-flow-page">
        ${renderHeaderBar({ title: t.title, backPage: 'welcome' })}
        <div class="page-content">
          <div class="card account-step-card">
            <div class="account-step-title">${escapeHtml(t.step)} · ${escapeHtml(t.title)}</div>
            <div class="account-step-desc">${escapeHtml(t.desc)}</div>
          </div>

          <div class="card account-card">
            <div class="account-row">
              <div class="account-label">${escapeHtml(t.accountId)}</div>
              <div class="account-value">${escapeHtml(accountId)}</div>
            </div>
            <div class="account-row">
              <div class="account-label">${escapeHtml(t.address)}</div>
              <div class="account-value account-value--mono">${escapeHtml(address)}</div>
            </div>
          </div>

          ${renderNotice('warning', t.warningTitle, t.warningDesc)}

          <div class="card secret-card">
            <div class="label-row">
              <label class="input-label">${escapeHtml(t.keyLabel)}</label>
              <button class="link-btn" type="button" onclick="copyPrivateKey()">${escapeHtml(t.copy)}</button>
            </div>
            <button class="reveal-card reveal-card--button" type="button" onclick="togglePrivateKey()">
              <div id="privateKeyDisplay" class="reveal-text secret-value">${escapeHtml(t.hidden)}</div>
            </button>
          </div>

          <div class="form-actions">
            <button class="btn btn-primary btn-block btn-lg" type="button" onclick="handleCreateNext()">
              ${escapeHtml(t.next)}
            </button>
          </div>
        </div>
      </div>
    `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
        togglePrivateKey,
        copyPrivateKey,
        handleCreateNext,
    });
}

function togglePrivateKey(): void {
    const t = getText();
    const display = document.getElementById('privateKeyDisplay');
    if (!display || !generatedPrivateKey) return;

    if (display.dataset.shown === 'true') {
        display.textContent = t.hidden;
        display.dataset.shown = 'false';
        display.classList.remove('is-revealed');
    } else {
        display.textContent = generatedPrivateKey;
        display.dataset.shown = 'true';
        display.classList.add('is-revealed');
    }
}

function handleCreateNext(): void {
    const t = getText();
    if (!generatedPrivateKey || !generatedAddress) {
        (window as any).showToast(t.failed, 'error');
        return;
    }

    try {
        (window as any).__pendingAccountData = {
            accountId: generatedAccountId || Date.now().toString(),
            address: generatedAddress,
            privHex: generatedPrivateKey,
        };

        generatedPrivateKey = null;
        generatedAddress = null;
        generatedAccountId = null;

        (window as any).navigateTo('setPassword');
    } catch (error) {
        console.error('[Create] failed:', error);
        (window as any).showToast(`${t.failed}: ${(error as Error).message}`, 'error');
    }
}

function copyPrivateKey(): void {
    const t = getText();
    if (!generatedPrivateKey) {
        (window as any).showToast(t.failed, 'info');
        return;
    }
    navigator.clipboard.writeText(generatedPrivateKey).then(() => {
        (window as any).showToast(t.copied, 'success');
    });
}
