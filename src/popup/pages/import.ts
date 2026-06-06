/**
 * Account import/login page.
 */

import { getPublicKeyFromPrivate, generateAddress, generateAccountIdFromPrivate } from '../../core/signature';
import { encryptPrivateKey } from '../../core/keyEncryption';
import {
    getAccount,
    getOnboardingStep,
    hydrateSessionAddressKeys,
    saveAccount,
    saveEncryptedKey,
    setActiveAccount,
    setSessionKey,
    type UserAccount,
} from '../../core/storage';
import { startTxStatusSync } from '../../core/txStatus';
import { syncAccountFromReOnline } from '../../core/auth';
import { getActiveLanguage } from '../utils/appSettings';
import { bindInlineHandlers } from '../utils/inlineHandlers';
import { bindNavigation, escapeHtml, icon, renderHeaderBar, renderNotice, shortAddress } from '../utils/ui';

const TEXT = {
    'zh-CN': {
        title: '账户登录',
        cardTitle: '私钥登录',
        cardDesc: '输入账户私钥以恢复账户并设置登录密码',
        keyLabel: '私钥',
        keyPlaceholder: '输入您的私钥（64字符十六进制）',
        keyHint: '请确保在安全环境中操作',
        preview: '账户预览',
        accountId: '账户 ID',
        accountAddress: '账户地址',
        password: '设置登录密码',
        passwordPlaceholder: '至少6位字符',
        confirmPassword: '确认密码',
        confirmPlaceholder: '再次输入密码',
        submit: '登录账户',
        submitting: '正在登录',
        ruleLength: '至少 6 位字符',
        ruleConfirm: '两次密码一致',
        invalidKey: '私钥格式无效',
        passwordRequired: '请输入登录密码',
        passwordTooShort: '密码至少 6 位字符',
        confirmRequired: '请再次输入密码',
        confirmMismatch: '两次输入的密码不一致',
        connectedOrg: (groupId: string) => `已连接到担保组织 ${groupId}`,
        retailMode: '已连接，当前为散户模式',
        syncFailed: '账户同步失败，将继续使用本地数据',
        success: '账户登录成功',
        failed: '登录失败',
    },
    en: {
        title: 'Account Login',
        cardTitle: 'Private Key Login',
        cardDesc: 'Restore your account with a private key and set a login password.',
        keyLabel: 'Private Key',
        keyPlaceholder: 'Enter your private key (64 hex chars)',
        keyHint: 'Only operate in a secure environment.',
        preview: 'Account Preview',
        accountId: 'Account ID',
        accountAddress: 'Account Address',
        password: 'Set Login Password',
        passwordPlaceholder: 'At least 6 characters',
        confirmPassword: 'Confirm Password',
        confirmPlaceholder: 'Enter password again',
        submit: 'Log In',
        submitting: 'Logging in',
        ruleLength: 'At least 6 characters',
        ruleConfirm: 'Passwords match',
        invalidKey: 'Invalid private key format',
        passwordRequired: 'Please enter password',
        passwordTooShort: 'Password must be at least 6 characters',
        confirmRequired: 'Please enter password again',
        confirmMismatch: 'Passwords do not match',
        connectedOrg: (groupId: string) => `Connected to organization ${groupId}`,
        retailMode: 'Connected in retail mode',
        syncFailed: 'Account sync failed, local data will be used',
        success: 'Account login succeeded',
        failed: 'Login failed',
    },
};

type ImportText = (typeof TEXT)['zh-CN'];

function getText(): ImportText {
    return getActiveLanguage() === 'en' ? TEXT.en : TEXT['zh-CN'];
}

export function renderImport(): void {
    const app = document.getElementById('app');
    if (!app) return;

    const t = getText();
    app.innerHTML = `
      <div class="page import-page">
        ${renderHeaderBar({ title: t.title, backPage: 'welcome' })}
        <div class="page-content">
          ${renderNotice('info', t.cardTitle, t.cardDesc)}

          <form id="importForm" class="form-stack" novalidate>
            <div class="input-group">
              <label class="input-label" for="privateKey">${escapeHtml(t.keyLabel)}</label>
              <textarea class="input textarea-mono" id="privateKey" placeholder="${escapeHtml(t.keyPlaceholder)}" required></textarea>
              <div class="input-hint">${escapeHtml(t.keyHint)}</div>
            </div>

            <section id="accountPreview" class="card account-preview-card" hidden>
              <div class="section-heading">${escapeHtml(t.preview)}</div>
              <div>
                <div class="account-preview-label">${escapeHtml(t.accountId)}</div>
                <div class="account-preview-id" id="previewAccountId"></div>
              </div>
              <div>
                <div class="account-preview-label">${escapeHtml(t.accountAddress)}</div>
                <div class="account-preview-address" id="previewAddress"></div>
              </div>
            </section>

            <div class="input-group">
              <label class="input-label" for="password">${escapeHtml(t.password)}</label>
              <input type="password" class="input" id="password" placeholder="${escapeHtml(t.passwordPlaceholder)}" required minlength="6">
              ${renderFieldError('passwordError')}
            </div>

            <div class="input-group">
              <label class="input-label" for="confirmPassword">${escapeHtml(t.confirmPassword)}</label>
              <input type="password" class="input" id="confirmPassword" placeholder="${escapeHtml(t.confirmPlaceholder)}" required>
              ${renderFieldError('confirmPasswordError')}
            </div>

            <div class="password-rules">
              <div class="password-rule" id="ruleLength">${icon('check', 14)}<span>${escapeHtml(t.ruleLength)}</span></div>
              <div class="password-rule" id="ruleConfirm">${icon('check', 14)}<span>${escapeHtml(t.ruleConfirm)}</span></div>
            </div>

            <button type="submit" class="btn btn-primary btn-block btn-lg" id="importSubmitBtn">
              ${escapeHtml(t.submit)}
            </button>
          </form>
        </div>
      </div>
    `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
    });
    bindNavigation(app);

    const privateKeyInput = document.getElementById('privateKey') as HTMLTextAreaElement;
    const form = document.getElementById('importForm') as HTMLFormElement;
    const passwordInput = document.getElementById('password') as HTMLInputElement;
    const confirmInput = document.getElementById('confirmPassword') as HTMLInputElement;

    privateKeyInput.addEventListener('input', handlePrivateKeyInput);
    form.addEventListener('submit', handleImport);
    passwordInput.addEventListener('input', () => {
        clearFieldError(passwordInput, 'passwordError');
        updatePasswordRules();
    });
    confirmInput.addEventListener('input', () => {
        clearFieldError(confirmInput, 'confirmPasswordError');
        updatePasswordRules();
    });
    updatePasswordRules();
}

function renderFieldError(id: string): string {
    return `
      <div class="form-inline-error" id="${id}" hidden>
        <span class="form-inline-error-icon">!</span>
        <span class="form-inline-error-text"></span>
      </div>
    `;
}

function normalizePrivateKey(value: string): string {
    const trimmed = value.trim().toLowerCase();
    return trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
}

function handlePrivateKeyInput(e: Event): void {
    const input = e.target as HTMLTextAreaElement;
    const value = normalizePrivateKey(input.value);
    const preview = document.getElementById('accountPreview') as HTMLElement | null;
    const previewAccountId = document.getElementById('previewAccountId');
    const previewAddress = document.getElementById('previewAddress');

    if (!preview || !previewAddress || !previewAccountId) return;

    if (value.length === 64 && /^[0-9a-f]+$/.test(value)) {
        try {
            const publicKey = getPublicKeyFromPrivate(value);
            const address = generateAddress(publicKey);
            const accountId = generateAccountIdFromPrivate(value);
            previewAccountId.textContent = accountId;
            previewAddress.textContent = `${shortAddress(address, 14, 10)} · ${address}`;
            preview.hidden = false;
        } catch {
            preview.hidden = true;
        }
    } else {
        preview.hidden = true;
    }
}

async function handleImport(e: Event): Promise<void> {
    e.preventDefault();
    const t = getText();
    const submitBtn = document.getElementById('importSubmitBtn') as HTMLButtonElement | null;
    const passwordInput = document.getElementById('password') as HTMLInputElement;
    const confirmInput = document.getElementById('confirmPassword') as HTMLInputElement;
    const privateKey = normalizePrivateKey((document.getElementById('privateKey') as HTMLTextAreaElement).value);
    const password = passwordInput.value.trim();
    const confirmPassword = confirmInput.value.trim();

    if (privateKey.length !== 64 || !/^[0-9a-f]+$/.test(privateKey)) {
        (window as any).showToast(t.invalidKey, 'error');
        return;
    }

    let hasError = false;
    clearFieldError(passwordInput, 'passwordError');
    clearFieldError(confirmInput, 'confirmPasswordError');

    if (!password) {
        setFieldError(passwordInput, 'passwordError', t.passwordRequired);
        hasError = true;
    } else if (password.length < 6) {
        setFieldError(passwordInput, 'passwordError', t.passwordTooShort);
        hasError = true;
    }

    if (!confirmPassword) {
        setFieldError(confirmInput, 'confirmPasswordError', t.confirmRequired);
        hasError = true;
    } else if (password !== confirmPassword) {
        setFieldError(confirmInput, 'confirmPasswordError', t.confirmMismatch);
        hasError = true;
    }

    if (hasError) return;

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span class="loading-spinner"></span>${escapeHtml(t.submitting)}`;
    }

    try {
        const publicKey = getPublicKeyFromPrivate(privateKey);
        const address = generateAddress(publicKey);
        const encrypted = await encryptPrivateKey(privateKey, password);
        const accountId = generateAccountIdFromPrivate(privateKey);

        const existing = await getAccount(accountId);
        const cleanedAddresses = existing?.addresses ? { ...existing.addresses } : {};
        if (address in cleanedAddresses) {
            delete cleanedAddresses[address];
        }

        const account: UserAccount = existing
            ? {
                  ...existing,
                  mainAddress: existing.mainAddress || address,
                  addresses: cleanedAddresses,
                  defaultAddress:
                      existing.defaultAddress && cleanedAddresses[existing.defaultAddress]
                          ? existing.defaultAddress
                          : undefined,
                  lastLogin: Date.now(),
              }
            : {
                  accountId,
                  mainAddress: address,
                  addresses: {},
                  onboardingComplete: false,
                  onboardingStep: 'wallet',
                  totalBalance: { 0: 0, 1: 0, 2: 0 },
                  createdAt: Date.now(),
                  lastLogin: Date.now(),
              };

        await saveAccount(account);
        await saveEncryptedKey(accountId, {
            encrypted: encrypted.encrypted,
            salt: encrypted.salt,
            iv: encrypted.iv,
            mainAddress: address,
        });
        await setActiveAccount(accountId);
        setSessionKey(accountId, privateKey);
        await hydrateSessionAddressKeys(accountId, privateKey);

        try {
            const syncResult = await syncAccountFromReOnline(account, privateKey);
            if (syncResult.org?.groupId) {
                (window as any).showToast(t.connectedOrg(syncResult.org.groupId), 'success');
            } else {
                (window as any).showToast(t.retailMode, 'info');
            }
            if (syncResult.notice) {
                (window as any).showToast(syncResult.notice, 'warning');
            }
        } catch (error) {
            console.warn('[Login] re-online sync failed:', error);
            (window as any).showToast(t.syncFailed, 'warning');
        }

        void startTxStatusSync(accountId);
        (window as any).showToast(t.success, 'success');

        setTimeout(async () => {
            const step = await getOnboardingStep(accountId);
            (window as any).navigateTo(step === 'complete' ? 'home' : step === 'organization' ? 'organization' : 'walletManager');
        }, 500);
    } catch (error) {
        console.error('[Login] failed:', error);
        (window as any).showToast(`${t.failed}: ${(error as Error).message}`, 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = t.submit;
        }
    }
}

function updatePasswordRules(): void {
    const password = (document.getElementById('password') as HTMLInputElement | null)?.value || '';
    const confirm = (document.getElementById('confirmPassword') as HTMLInputElement | null)?.value || '';
    document.getElementById('ruleLength')?.classList.toggle('is-ok', password.length >= 6);
    document.getElementById('ruleConfirm')?.classList.toggle('is-ok', Boolean(confirm) && password === confirm);
}

function setFieldError(input: HTMLInputElement, errorId: string, message: string): void {
    input.classList.add('input-error');
    const errorEl = document.getElementById(errorId);
    if (!errorEl) return;
    const textEl = errorEl.querySelector('.form-inline-error-text');
    if (textEl) {
        textEl.textContent = message;
    }
    errorEl.hidden = false;
    errorEl.classList.add('is-visible');
}

function clearFieldError(input: HTMLInputElement, errorId: string): void {
    input.classList.remove('input-error');
    const errorEl = document.getElementById(errorId);
    if (!errorEl) return;
    errorEl.hidden = true;
    errorEl.classList.remove('is-visible');
}
