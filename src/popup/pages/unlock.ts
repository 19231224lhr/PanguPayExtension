/**
 * Wallet unlock page.
 */

import {
    getActiveAccountId,
    getEncryptedKey,
    hydrateSessionAddressKeys,
    setSessionKey,
    getActiveAccount,
    getOnboardingStep,
    getDappPendingConnection,
    getDappSignPendingConnection,
    getDappPendingTransaction,
} from '../../core/storage';
import { syncAccountFromReOnline } from '../../core/auth';
import { startTxStatusSync } from '../../core/txStatus';
import { decryptPrivateKey } from '../../core/keyEncryption';
import { bindInlineHandlers } from '../utils/inlineHandlers';
import { getActiveLanguage } from '../utils/appSettings';
import { escapeHtml, icon, renderNotice } from '../utils/ui';

const TEXT = {
    'zh-CN': {
        title: '欢迎回来',
        subtitle: '请输入密码解锁钱包',
        password: '输入密码',
        unlock: '解锁',
        unlocking: '解锁中...',
        other: '使用其他账户',
        required: '请输入密码',
        accountMissing: '未找到账户',
        encryptedMissing: '未找到加密数据',
        syncFail: '账户同步失败，将继续使用本地数据',
        success: '解锁成功',
        wrong: '密码错误',
        pendingTitle: '待处理 DApp 请求',
        pendingDesc: '解锁后将继续处理站点授权、签名或交易确认。',
    },
    en: {
        title: 'Welcome Back',
        subtitle: 'Enter your password to unlock the wallet',
        password: 'Password',
        unlock: 'Unlock',
        unlocking: 'Unlocking...',
        other: 'Use another account',
        required: 'Please enter password',
        accountMissing: 'Account not found',
        encryptedMissing: 'Encrypted key not found',
        syncFail: 'Account sync failed, local data will be used',
        success: 'Unlocked',
        wrong: 'Wrong password',
        pendingTitle: 'Pending DApp request',
        pendingDesc: 'After unlocking, the wallet will continue the site request, signature, or transaction confirmation.',
    },
};

function getText() {
    return getActiveLanguage() === 'en' ? TEXT.en : TEXT['zh-CN'];
}

export async function renderUnlock(): Promise<void> {
    const app = document.getElementById('app');
    if (!app) return;

    const t = getText();
    const accountId = await getActiveAccountId();
    const hasPending = accountId
        ? !!(await getDappPendingTransaction(accountId)) ||
          !!(await getDappSignPendingConnection(accountId)) ||
          !!(await getDappPendingConnection(accountId))
        : false;

    app.innerHTML = `
      <div class="unlock-page unlock-page--refined">
        <div class="unlock-icon">${icon('lock', 32)}</div>
        <h2 class="unlock-title">${escapeHtml(t.title)}</h2>
        <p class="unlock-subtitle">${escapeHtml(t.subtitle)}</p>
        ${hasPending ? renderNotice('info', t.pendingTitle, t.pendingDesc) : ''}

        <form id="unlockForm" class="unlock-form">
          <div class="input-group">
            <div class="input-with-action">
              <input
                type="password"
                class="input"
                id="password"
                placeholder="${escapeHtml(t.password)}"
                required
                autofocus
              >
              <button class="input-action" type="button" id="toggleUnlockPassword" aria-label="${escapeHtml(t.password)}">${icon('eye', 16)}</button>
            </div>
            <div class="form-inline-error" id="unlockError"><span class="form-inline-error-icon">!</span><span class="form-inline-error-text"></span></div>
          </div>

          <button type="submit" id="unlockSubmit" class="btn btn-primary btn-block btn-lg">
            ${escapeHtml(t.unlock)}
          </button>

          <button type="button" class="btn btn-ghost btn-sm unlock-other" onclick="navigateTo('welcome')">
            ${escapeHtml(t.other)}
          </button>
        </form>
      </div>
    `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
    });

    const form = document.getElementById('unlockForm') as HTMLFormElement;
    form.addEventListener('submit', handleUnlock);
    document.getElementById('toggleUnlockPassword')?.addEventListener('click', () => {
        const input = document.getElementById('password') as HTMLInputElement | null;
        if (input) input.type = input.type === 'password' ? 'text' : 'password';
    });
}

async function handleUnlock(e: Event): Promise<void> {
    e.preventDefault();

    const t = getText();
    const input = document.getElementById('password') as HTMLInputElement;
    const submitBtn = document.getElementById('unlockSubmit') as HTMLButtonElement | null;
    const password = input.value;

    clearUnlockError();
    if (!password) {
        setUnlockError(t.required);
        return;
    }

    try {
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = t.unlocking;
        }
        const accountId = await getActiveAccountId();
        if (!accountId) {
            (window as any).showToast(t.accountMissing, 'error');
            (window as any).navigateTo('welcome');
            return;
        }

        const encryptedData = await getEncryptedKey(accountId);
        if (!encryptedData) {
            setUnlockError(t.encryptedMissing);
            return;
        }

        const privateKey = await decryptPrivateKey(
            encryptedData.encrypted,
            encryptedData.salt,
            encryptedData.iv,
            password
        );

        setSessionKey(accountId, privateKey);
        await hydrateSessionAddressKeys(accountId, privateKey);

        let syncedAccount = await getActiveAccount();
        if (syncedAccount) {
            try {
                const syncResult = await syncAccountFromReOnline(syncedAccount, privateKey);
                syncedAccount = syncResult.account;
                if (syncResult.notice) {
                    (window as any).showToast(syncResult.notice, 'info');
                }
            } catch (error) {
                console.warn('[Unlock] re-online sync failed:', error);
                (window as any).showToast(t.syncFail, 'warning');
            }
        }

        void startTxStatusSync(accountId);
        (window as any).showToast(t.success, 'success');

        setTimeout(async () => {
            const step = await getOnboardingStep(accountId);
            if (step === 'complete') {
                const pendingTx = await getDappPendingTransaction(accountId);
                if (pendingTx) {
                    (window as any).navigateTo('dappTransaction');
                    return;
                }
                const pendingSign = await getDappSignPendingConnection(accountId);
                if (pendingSign) {
                    (window as any).navigateTo('dappSign');
                    return;
                }
                const pending = await getDappPendingConnection(accountId);
                (window as any).navigateTo(pending ? 'dappConnect' : 'home');
            } else {
                (window as any).navigateTo(step === 'organization' ? 'organization' : 'walletManager');
            }
        }, 300);
    } catch (error) {
        console.error('[Unlock] failed:', error);
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = t.unlock;
        }
        setUnlockError(t.wrong);
    }
}

function setUnlockError(message: string): void {
    const input = document.getElementById('password') as HTMLInputElement | null;
    const errorEl = document.getElementById('unlockError');
    if (input) input.classList.add('input-error');
    if (!errorEl) return;
    const textEl = errorEl.querySelector('.form-inline-error-text');
    if (textEl) textEl.textContent = message;
    errorEl.classList.add('is-visible');
}

function clearUnlockError(): void {
    const input = document.getElementById('password') as HTMLInputElement | null;
    const errorEl = document.getElementById('unlockError');
    if (input) input.classList.remove('input-error');
    errorEl?.classList.remove('is-visible');
}

