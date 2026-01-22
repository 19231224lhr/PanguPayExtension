/**
 * 创建账户页面
 */

import { generateKeyPair, generateAddress, getPublicKeyHexFromPrivate } from '../../core/signature';
import { encryptPrivateKey } from '../../core/keyEncryption';
import { saveAccount, saveEncryptedKey, setActiveAccount, setSessionKey, type UserAccount } from '../../core/storage';
import { bindInlineHandlers } from '../utils/inlineHandlers';

let generatedPrivateKey: string | null = null;
let generatedAddress: string | null = null;

export function renderCreate(): void {
    const app = document.getElementById('app');
    if (!app) return;

    // 生成新密钥对
    const { privateKey, publicKey } = generateKeyPair();
    const address = generateAddress(publicKey);
    const { x: pubXHex, y: pubYHex } = getPublicKeyHexFromPrivate(privateKey);

    generatedPrivateKey = privateKey;
    generatedAddress = address;

    app.innerHTML = `
    <div class="page">
      <header class="header">
        <button class="header-btn" onclick="navigateTo('welcome')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <span style="font-weight: 600;">创建新钱包</span>
        <div style="width: 32px;"></div>
      </header>
      
      <div class="page-content">
        <div class="card" style="margin-bottom: 16px;">
          <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">您的钱包地址</div>
          <div style="font-family: monospace; font-size: 12px; word-break: break-all; color: var(--primary-light);">
            ${address}
          </div>
        </div>

        <div class="card" style="margin-bottom: 16px; border-color: var(--warning);">
          <div style="display: flex; align-items: flex-start; gap: 12px;">
            <span style="font-size: 20px;">⚠️</span>
            <div>
              <div style="font-weight: 600; margin-bottom: 4px; color: var(--warning);">请妥善保管私钥</div>
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

        <form id="createForm" style="margin-top: 24px;">
          <div class="input-group">
            <label class="input-label">设置登录密码</label>
            <input type="password" class="input" id="password" placeholder="至少6位字符" required minlength="6">
          </div>
          
          <div class="input-group">
            <label class="input-label">确认密码</label>
            <input type="password" class="input" id="confirmPassword" placeholder="再次输入密码" required>
          </div>

          <button type="submit" class="btn btn-primary btn-block btn-lg" style="margin-top: 16px;">
            创建钱包
          </button>
        </form>
      </div>
    </div>
  `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
        togglePrivateKey,
    });

    // 绑定事件
    const form = document.getElementById('createForm') as HTMLFormElement;
    form.addEventListener('submit', handleCreate);
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

async function handleCreate(e: Event): Promise<void> {
    e.preventDefault();

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

    if (!generatedPrivateKey || !generatedAddress) {
        (window as any).showToast('密钥生成失败', 'error');
        return;
    }

    try {
        // 加密私钥
        const encrypted = await encryptPrivateKey(generatedPrivateKey, password);

        // 生成账户 ID
        const accountId = Date.now().toString();

        // 获取公钥
        const { x: pubXHex, y: pubYHex } = getPublicKeyHexFromPrivate(generatedPrivateKey);

        // 创建账户
        const account: UserAccount = {
            accountId,
            mainAddress: generatedAddress,
            addresses: {
                [generatedAddress]: {
                    address: generatedAddress,
                    type: 0, // PGC
                    balance: 0,
                    utxoCount: 0,
                    txCerCount: 0,
                    pubXHex,
                    pubYHex,
                },
            },
            totalBalance: { 0: 0, 1: 0, 2: 0 },
            createdAt: Date.now(),
            lastLogin: Date.now(),
        };

        // 保存账户
        await saveAccount(account);

        // 保存加密密钥
        await saveEncryptedKey(accountId, {
            encrypted: encrypted.encrypted,
            salt: encrypted.salt,
            iv: encrypted.iv,
            mainAddress: generatedAddress,
        });

        // 设置为当前账户
        await setActiveAccount(accountId);

        // 设置会话
        setSessionKey(accountId, generatedPrivateKey);

        // 清理临时变量
        generatedPrivateKey = null;
        generatedAddress = null;

        (window as any).showToast('钱包创建成功！', 'success');

        // 跳转到首页
        setTimeout(() => {
            (window as any).navigateTo('home');
        }, 500);
    } catch (error) {
        console.error('[创建] 失败:', error);
        (window as any).showToast('创建失败: ' + (error as Error).message, 'error');
    }
}
