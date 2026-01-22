/**
 * 导入账户页面
 */

import { getPublicKeyFromPrivate, generateAddress, getPublicKeyHexFromPrivate } from '../../core/signature';
import { encryptPrivateKey } from '../../core/keyEncryption';
import { saveAccount, saveEncryptedKey, setActiveAccount, setSessionKey, type UserAccount } from '../../core/storage';
import { bindInlineHandlers } from '../utils/inlineHandlers';

export function renderImport(): void {
    const app = document.getElementById('app');
    if (!app) return;

    app.innerHTML = `
    <div class="page">
      <header class="header">
        <button class="header-btn" onclick="navigateTo('welcome')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <span style="font-weight: 600;">导入钱包</span>
        <div style="width: 32px;"></div>
      </header>
      
      <div class="page-content">
        <div class="card" style="margin-bottom: 20px;">
          <div style="display: flex; align-items: flex-start; gap: 12px;">
            <span style="font-size: 20px;">🔑</span>
            <div>
              <div style="font-weight: 500; margin-bottom: 4px;">私钥导入</div>
              <div style="font-size: 12px; color: var(--text-secondary);">
                输入 64 字符的十六进制私钥来恢复您的钱包
              </div>
            </div>
          </div>
        </div>

        <form id="importForm">
          <div class="input-group">
            <label class="input-label">私钥</label>
            <textarea 
              class="input" 
              id="privateKey" 
              placeholder="输入您的私钥（64字符十六进制）" 
              required
              style="height: 80px; resize: none; font-family: monospace; font-size: 12px;"
            ></textarea>
            <div class="input-hint">请确保在安全环境中操作</div>
          </div>

          <div id="addressPreview" style="display: none; margin-bottom: 16px;">
            <div class="card">
              <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 4px;">钱包地址预览</div>
              <div id="previewAddress" style="font-family: monospace; font-size: 12px; word-break: break-all; color: var(--success);"></div>
            </div>
          </div>
          
          <div class="input-group">
            <label class="input-label">设置登录密码</label>
            <input type="password" class="input" id="password" placeholder="至少6位字符" required minlength="6">
          </div>
          
          <div class="input-group">
            <label class="input-label">确认密码</label>
            <input type="password" class="input" id="confirmPassword" placeholder="再次输入密码" required>
          </div>

          <button type="submit" class="btn btn-primary btn-block btn-lg" style="margin-top: 16px;">
            导入钱包
          </button>
        </form>
      </div>
    </div>
  `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
    });

    // 绑定私钥输入事件
    const privateKeyInput = document.getElementById('privateKey') as HTMLTextAreaElement;
    privateKeyInput.addEventListener('input', handlePrivateKeyInput);

    // 绑定表单提交
    const form = document.getElementById('importForm') as HTMLFormElement;
    form.addEventListener('submit', handleImport);
}

function handlePrivateKeyInput(e: Event): void {
    const input = e.target as HTMLTextAreaElement;
    let value = input.value.trim().toLowerCase();

    // 移除 0x 前缀
    if (value.startsWith('0x')) {
        value = value.slice(2);
    }

    const preview = document.getElementById('addressPreview');
    const previewAddress = document.getElementById('previewAddress');

    if (!preview || !previewAddress) return;

    // 验证私钥格式
    if (value.length === 64 && /^[0-9a-f]+$/.test(value)) {
        try {
            const publicKey = getPublicKeyFromPrivate(value);
            const address = generateAddress(publicKey);
            previewAddress.textContent = address;
            preview.style.display = 'block';
        } catch {
            preview.style.display = 'none';
        }
    } else {
        preview.style.display = 'none';
    }
}

async function handleImport(e: Event): Promise<void> {
    e.preventDefault();

    let privateKey = (document.getElementById('privateKey') as HTMLTextAreaElement).value.trim().toLowerCase();
    const password = (document.getElementById('password') as HTMLInputElement).value;
    const confirmPassword = (document.getElementById('confirmPassword') as HTMLInputElement).value;

    // 移除 0x 前缀
    if (privateKey.startsWith('0x')) {
        privateKey = privateKey.slice(2);
    }

    // 验证私钥
    if (privateKey.length !== 64 || !/^[0-9a-f]+$/.test(privateKey)) {
        (window as any).showToast('私钥格式无效', 'error');
        return;
    }

    if (password !== confirmPassword) {
        (window as any).showToast('两次密码不一致', 'error');
        return;
    }

    if (password.length < 6) {
        (window as any).showToast('密码至少6位', 'error');
        return;
    }

    try {
        // 生成地址
        const publicKey = getPublicKeyFromPrivate(privateKey);
        const address = generateAddress(publicKey);
        const { x: pubXHex, y: pubYHex } = getPublicKeyHexFromPrivate(privateKey);

        // 加密私钥
        const encrypted = await encryptPrivateKey(privateKey, password);

        // 生成账户 ID
        const accountId = Date.now().toString();

        // 创建账户
        const account: UserAccount = {
            accountId,
            mainAddress: address,
            addresses: {
                [address]: {
                    address,
                    type: 0,
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

        // 保存
        await saveAccount(account);
        await saveEncryptedKey(accountId, {
            encrypted: encrypted.encrypted,
            salt: encrypted.salt,
            iv: encrypted.iv,
            mainAddress: address,
        });
        await setActiveAccount(accountId);
        setSessionKey(accountId, privateKey);

        (window as any).showToast('钱包导入成功！', 'success');

        setTimeout(() => {
            (window as any).navigateTo('home');
        }, 500);
    } catch (error) {
        console.error('[导入] 失败:', error);
        (window as any).showToast('导入失败: ' + (error as Error).message, 'error');
    }
}
