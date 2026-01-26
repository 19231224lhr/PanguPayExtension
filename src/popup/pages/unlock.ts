/**
 * 解锁页面
 */

import {
    getActiveAccountId,
    getEncryptedKey,
    setSessionKey,
    getActiveAccount,
    getOnboardingStep,
    getDappPendingConnection,
} from '../../core/storage';
import { syncAccountFromReOnline } from '../../core/auth';
import { startTxStatusSync } from '../../core/txStatus';
import { decryptPrivateKey } from '../../core/keyEncryption';
import { bindInlineHandlers } from '../utils/inlineHandlers';

export function renderUnlock(): void {
    const app = document.getElementById('app');
    if (!app) return;

    app.innerHTML = `
    <div class="unlock-page">
      <div class="unlock-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
      </div>
      
      <h2 class="unlock-title">欢迎回来</h2>
      <p class="unlock-subtitle">请输入密码解锁钱包</p>
      
      <form id="unlockForm" class="unlock-form">
        <div class="input-group">
          <input 
            type="password" 
            class="input" 
            id="password" 
            placeholder="输入密码" 
            required
            autofocus
          >
        </div>
        
        <button type="submit" class="btn btn-primary btn-block btn-lg">
          解锁
        </button>
        
        <div style="text-align: center; margin-top: 24px;">
          <button type="button" class="btn btn-ghost btn-sm" onclick="navigateTo('welcome')">
            使用其他账户
          </button>
        </div>
      </form>
    </div>
  `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
    });

    // 绑定表单提交
    const form = document.getElementById('unlockForm') as HTMLFormElement;
    form.addEventListener('submit', handleUnlock);
}

async function handleUnlock(e: Event): Promise<void> {
    e.preventDefault();

    const password = (document.getElementById('password') as HTMLInputElement).value;

    if (!password) {
        (window as any).showToast('请输入密码', 'error');
        return;
    }

    try {
        // 获取当前账户
        const accountId = await getActiveAccountId();
        if (!accountId) {
            (window as any).showToast('未找到账户', 'error');
            (window as any).navigateTo('welcome');
            return;
        }

        // 获取加密密钥
        const encryptedData = await getEncryptedKey(accountId);
        if (!encryptedData) {
            (window as any).showToast('未找到加密数据', 'error');
            return;
        }

        // 解密私钥
        const privateKey = await decryptPrivateKey(
            encryptedData.encrypted,
            encryptedData.salt,
            encryptedData.iv,
            password
        );

        // 设置会话
        setSessionKey(accountId, privateKey);

        // 同步账户状态与担保组织信息
        let syncedAccount = await getActiveAccount();
        if (syncedAccount) {
            try {
                const syncResult = await syncAccountFromReOnline(syncedAccount, privateKey);
                syncedAccount = syncResult.account;
                if (syncResult.notice) {
                    (window as any).showToast(syncResult.notice, 'info');
                }
            } catch (error) {
                console.warn('[解锁] re-online 同步失败:', error);
                (window as any).showToast('账户同步失败，将继续使用本地数据', 'warning');
            }
        }

        void startTxStatusSync(accountId);

        (window as any).showToast('解锁成功', 'success');

        // 跳转到下一步
        setTimeout(async () => {
            const step = await getOnboardingStep(accountId);
            if (step === 'complete') {
                const pending = await getDappPendingConnection(accountId);
                (window as any).navigateTo(pending ? 'dappConnect' : 'home');
            } else {
                (window as any).navigateTo(step === 'organization' ? 'organization' : 'walletManager');
            }
        }, 300);
    } catch (error) {
        console.error('[解锁] 失败:', error);
        (window as any).showToast('密码错误', 'error');
    }
}
