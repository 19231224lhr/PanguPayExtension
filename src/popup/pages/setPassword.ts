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
        <div class="card onboarding-card" style="margin-bottom: 16px;">
          <div style="font-weight: 600; margin-bottom: 6px;">步骤 2 / 4 · 设置密码</div>
          <div style="font-size: 12px; color: var(--text-secondary);">
            设置登录密码用于加密私钥
          </div>
        </div>

        <div class="card" style="margin-bottom: 20px;">
          <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 6px;">即将创建的账户</div>
          <div style="font-weight: 600; margin-bottom: 4px;">账户 ID: ${pending.accountId}</div>
          <div style="font-family: monospace; font-size: 12px;">${shortAddress}</div>
        </div>

        <form id="setPasswordForm">
          <div class="input-group">
            <label class="input-label">设置登录密码</label>
            <input type="password" class="input" id="password" placeholder="至少6位字符" required minlength="6">
          </div>
          
          <div class="input-group">
            <label class="input-label">确认密码</label>
            <input type="password" class="input" id="confirmPassword" placeholder="再次输入密码" required>
          </div>

          <button type="submit" class="btn btn-primary btn-block btn-lg" style="margin-top: 16px;">
            完成创建
          </button>
        </form>
      </div>
    </div>
  `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
    });

    const form = document.getElementById('setPasswordForm') as HTMLFormElement;
    form.addEventListener('submit', handleSetPassword);
}

async function handleSetPassword(e: Event): Promise<void> {
    e.preventDefault();

    const pending = getPendingAccountData();
    if (!pending) {
        (window as any).showToast('账户数据丢失，请重新创建', 'error');
        (window as any).navigateTo('create');
        return;
    }

    const password = (document.getElementById('password') as HTMLInputElement).value;
    const confirmPassword = (document.getElementById('confirmPassword') as HTMLInputElement).value;

    if (password !== confirmPassword) {
        (window as any).showToast('两次密码不一致', 'error');
        return;
    }

    if (password.length < 6) {
        (window as any).showToast('密码至少6位', 'error');
        return;
    }

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
