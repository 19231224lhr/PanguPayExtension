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
        <div class="card onboarding-card" style="margin-bottom: 16px;">
          <div style="font-weight: 600; margin-bottom: 6px;">步骤 1 / 4 · 创建账户</div>
          <div style="font-size: 12px; color: var(--text-secondary);">
            生成账户 ID 与私钥，用于后续登录
          </div>
        </div>

        <div class="card" style="margin-bottom: 16px;">
          <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">账户 ID</div>
          <div style="font-weight: 600; letter-spacing: 0.5px;">${accountId}</div>
        </div>

        <div class="card" style="margin-bottom: 16px;">
          <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">账户地址</div>
          <div style="font-family: monospace; font-size: 12px; word-break: break-all; color: var(--primary-light);">
            ${address}
          </div>
        </div>

        <div class="card" style="margin-bottom: 16px; border-color: var(--warning);">
          <div style="display: flex; align-items: flex-start; gap: 12px;">
            <span style="font-size: 20px;">⚠️</span>
            <div>
              <div style="font-weight: 600; margin-bottom: 4px; color: var(--warning);">请妥善保管账户私钥</div>
              <div style="font-size: 12px; color: var(--text-secondary);">
                私钥是您资产的唯一凭证，丢失将无法找回
              </div>
            </div>
          </div>
        </div>

        <div class="input-group">
          <label class="input-label">私钥（点击显示）</label>
          <div class="card" style="cursor: pointer;" onclick="togglePrivateKey()">
            <div id="privateKeyDisplay" style="font-family: monospace; font-size: 11px; word-break: break-all; color: var(--text-muted);">
              点击显示私钥...
            </div>
          </div>
        </div>

        <div style="margin-top: 24px;">
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
