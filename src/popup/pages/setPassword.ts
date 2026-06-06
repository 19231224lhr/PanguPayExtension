/**
 * Set login password for a newly created account.
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
import { getActiveLanguage } from '../utils/appSettings';
import { escapeHtml, icon, renderHeaderBar, renderNotice, shortAddress } from '../utils/ui';

interface PendingAccountData {
    accountId: string;
    address: string;
    privHex: string;
}

const TEXT = {
    'zh-CN': {
        title: '设置登录密码',
        step: '步骤 2 / 4',
        desc: '登录密码用于加密本地私钥，请选择容易记住但不易猜到的密码。',
        account: '即将创建的账户',
        password: '登录密码',
        confirm: '确认密码',
        placeholder: '至少 6 位字符',
        confirmPlaceholder: '再次输入密码',
        ruleLength: '至少 6 位字符',
        ruleMatch: '两次密码一致',
        submit: '完成创建',
        submitting: '创建中...',
        missing: '账户数据丢失，请重新创建',
        passwordRequired: '请输入登录密码',
        confirmRequired: '请再次输入密码',
        lengthError: '密码至少 6 位字符',
        matchError: '两次输入的密码不一致',
        success: '账户创建成功',
        failed: '创建失败',
        securityTitle: '本地加密',
        securityDesc: '密码只用于加密浏览器本地私钥，插件不会上传你的私钥。',
    },
    en: {
        title: 'Set Login Password',
        step: 'Step 2 / 4',
        desc: 'This password encrypts your local private key. Choose one you can remember.',
        account: 'Account to create',
        password: 'Password',
        confirm: 'Confirm Password',
        placeholder: 'At least 6 characters',
        confirmPlaceholder: 'Enter password again',
        ruleLength: 'At least 6 characters',
        ruleMatch: 'Passwords match',
        submit: 'Create Account',
        submitting: 'Creating...',
        missing: 'Account data missing. Please create again.',
        passwordRequired: 'Please enter password',
        confirmRequired: 'Please confirm password',
        lengthError: 'Password must be at least 6 characters',
        matchError: 'Passwords do not match',
        success: 'Account created',
        failed: 'Failed to create account',
        securityTitle: 'Local encryption',
        securityDesc: 'The password encrypts the local key. The extension never uploads your private key.',
    },
};

function getText() {
    return getActiveLanguage() === 'en' ? TEXT.en : TEXT['zh-CN'];
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

    const t = getText();
    const pending = getPendingAccountData();
    if (!pending) {
        (window as any).showToast(t.missing, 'error');
        (window as any).navigateTo('create');
        return;
    }

    app.innerHTML = `
      <div class="page account-flow-page">
        ${renderHeaderBar({ title: t.title, backPage: 'create' })}
        <div class="page-content">
          <div class="card account-step-card">
            <div class="account-step-title">${escapeHtml(t.step)} · ${escapeHtml(t.title)}</div>
            <div class="account-step-desc">${escapeHtml(t.desc)}</div>
          </div>

          <div class="card account-preview-card">
            <div class="account-preview-label">${escapeHtml(t.account)}</div>
            <div class="account-preview-id">${escapeHtml(pending.accountId)}</div>
            <div class="account-preview-address">${escapeHtml(shortAddress(pending.address))}</div>
          </div>

          ${renderNotice('info', t.securityTitle, t.securityDesc)}

          <form id="setPasswordForm" class="form-stack" novalidate>
            <div class="input-group">
              <label class="input-label" for="password">${escapeHtml(t.password)}</label>
              <div class="input-with-action">
                <input type="password" class="input" id="password" placeholder="${escapeHtml(t.placeholder)}" required minlength="6">
                <button class="input-action" type="button" data-toggle-password="password" aria-label="${escapeHtml(t.password)}">${icon('eye', 16)}</button>
              </div>
              <div class="form-inline-error" id="passwordError"><span class="form-inline-error-icon">!</span><span class="form-inline-error-text"></span></div>
            </div>

            <div class="input-group">
              <label class="input-label" for="confirmPassword">${escapeHtml(t.confirm)}</label>
              <div class="input-with-action">
                <input type="password" class="input" id="confirmPassword" placeholder="${escapeHtml(t.confirmPlaceholder)}" required>
                <button class="input-action" type="button" data-toggle-password="confirmPassword" aria-label="${escapeHtml(t.confirm)}">${icon('eye', 16)}</button>
              </div>
              <div class="form-inline-error" id="confirmPasswordError"><span class="form-inline-error-icon">!</span><span class="form-inline-error-text"></span></div>
            </div>

            <div class="password-rules">
              <div class="password-rule" id="ruleLength">${icon('check', 14)}<span>${escapeHtml(t.ruleLength)}</span></div>
              <div class="password-rule" id="ruleMatch">${icon('check', 14)}<span>${escapeHtml(t.ruleMatch)}</span></div>
            </div>

            <div class="form-actions">
              <button type="submit" id="setPasswordSubmit" class="btn btn-primary btn-block btn-lg">
                ${escapeHtml(t.submit)}
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
    const passwordInput = document.getElementById('password') as HTMLInputElement;
    const confirmInput = document.getElementById('confirmPassword') as HTMLInputElement;
    form.addEventListener('submit', handleSetPassword);
    passwordInput.addEventListener('input', updatePasswordRules);
    confirmInput.addEventListener('input', updatePasswordRules);
    app.querySelectorAll<HTMLButtonElement>('[data-toggle-password]').forEach((button) => {
        button.addEventListener('click', () => togglePasswordVisibility(button.dataset.togglePassword || ''));
    });
    updatePasswordRules();
}

async function handleSetPassword(e: Event): Promise<void> {
    e.preventDefault();

    const t = getText();
    const pending = getPendingAccountData();
    if (!pending) {
        (window as any).showToast(t.missing, 'error');
        (window as any).navigateTo('create');
        return;
    }

    const passwordInput = document.getElementById('password') as HTMLInputElement;
    const confirmInput = document.getElementById('confirmPassword') as HTMLInputElement;
    const submitBtn = document.getElementById('setPasswordSubmit') as HTMLButtonElement | null;
    const password = passwordInput.value.trim();
    const confirmPassword = confirmInput.value.trim();

    let hasError = false;
    clearFieldError(passwordInput, 'passwordError');
    clearFieldError(confirmInput, 'confirmPasswordError');

    if (!password) {
        setFieldError(passwordInput, 'passwordError', t.passwordRequired);
        hasError = true;
    } else if (password.length < 6) {
        setFieldError(passwordInput, 'passwordError', t.lengthError);
        hasError = true;
    }

    if (!confirmPassword) {
        setFieldError(confirmInput, 'confirmPasswordError', t.confirmRequired);
        hasError = true;
    } else if (password !== confirmPassword) {
        setFieldError(confirmInput, 'confirmPasswordError', t.matchError);
        hasError = true;
    }

    if (hasError) return;

    try {
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = t.submitting;
        }
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
        (window as any).showToast(t.success, 'success');
        setTimeout(() => {
            (window as any).navigateTo('walletManager');
        }, 400);
    } catch (error) {
        console.error('[SetPassword] failed:', error);
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = t.submit;
        }
        (window as any).showToast(`${t.failed}: ${(error as Error).message}`, 'error');
    }
}

function togglePasswordVisibility(id: string): void {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
}

function updatePasswordRules(): void {
    const passwordInput = document.getElementById('password') as HTMLInputElement | null;
    const confirmInput = document.getElementById('confirmPassword') as HTMLInputElement | null;
    const password = passwordInput?.value || '';
    const confirm = confirmInput?.value || '';
    document.getElementById('ruleLength')?.classList.toggle('is-ok', password.length >= 6);
    document.getElementById('ruleMatch')?.classList.toggle('is-ok', !!password && password === confirm);
    if (passwordInput) clearFieldError(passwordInput, 'passwordError');
    if (confirmInput) clearFieldError(confirmInput, 'confirmPasswordError');
}

function setFieldError(input: HTMLInputElement, errorId: string, message: string): void {
    input.classList.add('input-error');
    const errorEl = document.getElementById(errorId);
    if (!errorEl) return;
    const textEl = errorEl.querySelector('.form-inline-error-text');
    if (textEl) textEl.textContent = message;
    errorEl.classList.add('is-visible');
}

function clearFieldError(input: HTMLInputElement, errorId: string): void {
    input.classList.remove('input-error');
    const errorEl = document.getElementById(errorId);
    if (errorEl) errorEl.classList.remove('is-visible');
}

