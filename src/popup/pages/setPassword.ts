/**
 * 设置密码页面 - 新建账户的第二步
 */

import { encryptPrivateKey } from '../../core/keyEncryption';
import {
    saveAccount,
    saveEncryptedKey,
    setActiveAccount,
    setSessionKey,
    type UserAccount,
} from '../../core/storage';
import { startTxStatusSync } from '../../core/txStatus';
import { bindInlineHandlers } from '../utils/inlineHandlers';

interface PendingAccountData {
    accountId: string;
    address: string;
    privHex: string;
}

function getPendingAccountData(): PendingAccountData | null {
    return (window as any).__pendingAccountData || null;
}

function clearPendingAccountData(): void {
    (window as any).__pendingAccountData = null;
}

export function renderSetPassword(): void {
    const app = document.getElementById('app');
    if (!app) return;

    const pending = getPendingAccountData();
    if (!pending) {
        (window as any).showToast('账户数据丢失，请重新创建', 'error');
        (window as any).navigateTo('create');
        return;
    }

    const shortAddress = pending.address.slice(0, 8) + '...' + pending.address.slice(-6);

    app.innerHTML = `
    <div class="page">
      <header class="header">
        <button class="header-btn" onclick="navigateTo('create')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <span style="font-weight: 600;">设置登录密码</span>
        <div style="width: 32px;"></div>
      </header>
      
      <div class="page-content">
        <div class="card account-step-card section-space">
          <div class="account-step-title">步骤 2 / 4 · 设置密码</div>
          <div class="account-step-desc">设置登录密码用于加密私钥</div>
        </div>

        <div class="card account-preview-card section-space-lg">
          <div class="account-preview-label">即将创建的账户</div>
          <div class="account-preview-id">账户 ID: ${pending.accountId}</div>
          <div class="account-preview-address">${shortAddress}</div>
        </div>

        <form id="setPasswordForm" novalidate>
          <div class="input-group">
            <label class="input-label">设置登录密码</label>
            <input type="password" class="input" id="password" placeholder="至少6位字符" required minlength="6">
            <div class="form-inline-error" id="passwordError" style="display: none;">
              <span class="form-inline-error-icon">!</span>
              <span class="form-inline-error-text"></span>
            </div>
          </div>
          
          <div class="input-group">
            <label class="input-label">确认密码</label>
            <input type="password" class="input" id="confirmPassword" placeholder="再次输入密码" required>
            <div class="form-inline-error" id="confirmPasswordError" style="display: none;">
              <span class="form-inline-error-icon">!</span>
              <span class="form-inline-error-text"></span>
            </div>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary btn-block btn-lg">
              完成创建
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
    });

    const form = document.getElementById('setPasswordForm') as HTMLFormElement;
    form.addEventListener('submit', handleSetPassword);

    const passwordInput = document.getElementById('password') as HTMLInputElement;
    const confirmInput = document.getElementById('confirmPassword') as HTMLInputElement;
    passwordInput.addEventListener('input', () => clearFieldError(passwordInput, 'passwordError'));
    confirmInput.addEventListener('input', () => clearFieldError(confirmInput, 'confirmPasswordError'));
}

async function handleSetPassword(e: Event): Promise<void> {
    e.preventDefault();

    const pending = getPendingAccountData();
    if (!pending) {
        (window as any).showToast('账户数据丢失，请重新创建', 'error');
        (window as any).navigateTo('create');
        return;
    }

    const passwordInput = document.getElementById('password') as HTMLInputElement;
    const confirmInput = document.getElementById('confirmPassword') as HTMLInputElement;
    const password = passwordInput.value.trim();
    const confirmPassword = confirmInput.value.trim();

    let hasError = false;
    clearFieldError(passwordInput, 'passwordError');
    clearFieldError(confirmInput, 'confirmPasswordError');

    if (!password) {
        setFieldError(passwordInput, 'passwordError', '请输入登录密码');
        hasError = true;
    } else if (password.length < 6) {
        setFieldError(passwordInput, 'passwordError', '密码至少 6 位字符');
        hasError = true;
    }

    if (!confirmPassword) {
        setFieldError(confirmInput, 'confirmPasswordError', '请再次输入密码');
        hasError = true;
    } else if (password !== confirmPassword) {
        setFieldError(confirmInput, 'confirmPasswordError', '两次输入的密码不一致');
        hasError = true;
    }

    if (hasError) return;

    try {
        const encrypted = await encryptPrivateKey(pending.privHex, password);

        const account: UserAccount = {
            accountId: pending.accountId,
            mainAddress: pending.address,
            addresses: {},
            onboardingComplete: false,
            onboardingStep: 'wallet',
            totalBalance: { 0: 0, 1: 0, 2: 0 },
            createdAt: Date.now(),
            lastLogin: Date.now(),
        };

        await saveAccount(account);
        await saveEncryptedKey(pending.accountId, {
            encrypted: encrypted.encrypted,
            salt: encrypted.salt,
            iv: encrypted.iv,
            mainAddress: pending.address,
        });
        await setActiveAccount(pending.accountId);
        setSessionKey(pending.accountId, pending.privHex);
        void startTxStatusSync(pending.accountId);

        clearPendingAccountData();

        (window as any).showToast('账户创建成功！', 'success');

        setTimeout(() => {
            (window as any).navigateTo('walletManager');
        }, 400);
    } catch (error) {
        console.error('[设置密码] 失败:', error);
        (window as any).showToast('创建失败: ' + (error as Error).message, 'error');
    }
}

function setFieldError(input: HTMLInputElement, errorId: string, message: string): void {
    input.classList.add('input-error');
    const errorEl = document.getElementById(errorId);
    if (errorEl) {
        const textEl = errorEl.querySelector('.form-inline-error-text');
        if (textEl) {
            textEl.textContent = message;
        } else {
            errorEl.textContent = message;
        }
        (errorEl as HTMLElement).style.display = 'flex';
    }
}

function clearFieldError(input: HTMLInputElement, errorId: string): void {
    input.classList.remove('input-error');
    const errorEl = document.getElementById(errorId);
    if (errorEl) {
        (errorEl as HTMLElement).style.display = 'none';
    }
}
