/**
 * 创建账户页面
 */

import { generateKeyPair, generateAddress, generateAccountIdFromPrivate } from '../../core/signature';
import { bindInlineHandlers } from '../utils/inlineHandlers';

let generatedPrivateKey: string | null = null;
let generatedAddress: string | null = null;
let generatedAccountId: string | null = null;

export function renderCreate(): void {
    const app = document.getElementById('app');
    if (!app) return;

    // 生成新密钥对
    const { privateKey, publicKey } = generateKeyPair();
    const address = generateAddress(publicKey);
    const accountId = generateAccountIdFromPrivate(privateKey);

    generatedPrivateKey = privateKey;
    generatedAddress = address;
    generatedAccountId = accountId;

    app.innerHTML = `
    <div class="page">
      <header class="header">
        <button class="header-btn" onclick="navigateTo('welcome')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <span style="font-weight: 600;">创建新账户</span>
        <div style="width: 32px;"></div>
      </header>
      
      <div class="page-content">
        <div class="card account-step-card section-space">
          <div class="account-step-title">步骤 1 / 4 · 创建账户</div>
          <div class="account-step-desc">生成账户 ID 与私钥，用于后续登录</div>
        </div>

        <div class="card account-card section-space">
          <div class="account-row">
            <div class="account-label">账户 ID</div>
            <div class="account-value">${accountId}</div>
          </div>
          <div class="account-row">
            <div class="account-label">账户地址</div>
            <div class="account-value account-value--mono">${address}</div>
          </div>
        </div>

        <div class="card notice-card section-space">
          <div class="notice-icon">!</div>
          <div>
            <div class="notice-title">请妥善保管账户私钥</div>
            <div class="notice-desc">私钥是您资产的唯一凭证，丢失将无法找回</div>
          </div>
        </div>

        <div class="input-group">
          <div class="label-row">
            <label class="input-label">私钥（点击显示）</label>
            <button class="link-btn" type="button" onclick="copyPrivateKey()" aria-label="复制私钥">复制</button>
          </div>
          <div class="reveal-card" onclick="togglePrivateKey()">
            <div id="privateKeyDisplay" class="reveal-text">
              点击显示私钥...
            </div>
          </div>
        </div>

        <div class="form-actions">
          <button class="btn btn-primary btn-block btn-lg" onclick="handleCreateNext()">
            下一步
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
    const display = document.getElementById('privateKeyDisplay');
    if (!display || !generatedPrivateKey) return;

    if (display.dataset.shown === 'true') {
        display.textContent = '点击显示私钥...';
        display.dataset.shown = 'false';
        display.style.color = 'var(--text-muted)';
    } else {
        display.textContent = generatedPrivateKey;
        display.dataset.shown = 'true';
        display.style.color = 'var(--warning)';
    }
}

function handleCreateNext(): void {
    if (!generatedPrivateKey || !generatedAddress) {
        (window as any).showToast('密钥生成失败', 'error');
        return;
    }

    try {
        (window as any).__pendingAccountData = {
            accountId: generatedAccountId || Date.now().toString(),
            address: generatedAddress,
            privHex: generatedPrivateKey,
        };

        // 清理临时变量
        generatedPrivateKey = null;
        generatedAddress = null;
        generatedAccountId = null;

        (window as any).navigateTo('setPassword');
    } catch (error) {
        console.error('[创建] 失败:', error);
        (window as any).showToast('创建失败: ' + (error as Error).message, 'error');
    }
}

function copyPrivateKey(): void {
    if (!generatedPrivateKey) {
        (window as any).showToast('请先生成私钥', 'info');
        return;
    }
    navigator.clipboard.writeText(generatedPrivateKey).then(() => {
        (window as any).showToast('私钥已复制', 'success');
    });
}
