/**
 * 导入钱包地址页面
 */

import { getPublicKeyFromPrivate, generateAddress, getPublicKeyHexFromPrivate } from '../../core/signature';
import { getActiveAccount, saveAccount, setSessionAddressKey } from '../../core/storage';
import { bindInlineHandlers } from '../utils/inlineHandlers';

export function renderWalletImport(): void {
    const app = document.getElementById('app');
    if (!app) return;

    app.innerHTML = `
    <div class="page">
      <header class="header">
        <button class="header-btn" onclick="navigateTo('walletManager')">
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
              <div style="font-weight: 500; margin-bottom: 4px;">私钥导入/解锁</div>
              <div style="font-size: 12px; color: var(--text-secondary);">
                输入 64 字符十六进制私钥以导入或解锁地址
              </div>
            </div>
          </div>
        </div>

        <form id="walletImportForm">
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
              <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 4px;">地址预览</div>
              <div id="previewAddress" style="font-family: monospace; font-size: 12px; word-break: break-all; color: var(--success);"></div>
            </div>
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

    const privateKeyInput = document.getElementById('privateKey') as HTMLTextAreaElement;
    privateKeyInput.addEventListener('input', handlePrivateKeyInput);

    const form = document.getElementById('walletImportForm') as HTMLFormElement;
    form.addEventListener('submit', handleImport);
}

function handlePrivateKeyInput(e: Event): void {
    const input = e.target as HTMLTextAreaElement;
    let value = input.value.trim().toLowerCase();

    if (value.startsWith('0x')) {
        value = value.slice(2);
    }

    const preview = document.getElementById('addressPreview');
    const previewAddress = document.getElementById('previewAddress');
    if (!preview || !previewAddress) return;

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
    if (privateKey.startsWith('0x')) {
        privateKey = privateKey.slice(2);
    }

    if (privateKey.length !== 64 || !/^[0-9a-f]+$/.test(privateKey)) {
        (window as any).showToast('私钥格式无效', 'error');
        return;
    }

    try {
        const account = await getActiveAccount();
        if (!account) {
            (window as any).showToast('账户未找到', 'error');
            (window as any).navigateTo('welcome');
            return;
        }

        const publicKey = getPublicKeyFromPrivate(privateKey);
        const address = generateAddress(publicKey);
        const { x: pubXHex, y: pubYHex } = getPublicKeyHexFromPrivate(privateKey);

        if (address === account.mainAddress) {
            (window as any).showToast('该私钥为账户私钥，不能作为子钱包', 'error');
            return;
        }

        const exists = !!account.addresses[address];
        if (!exists) {
            account.addresses[address] = {
                address,
                type: 0,
                balance: 0,
                utxoCount: 0,
                txCerCount: 0,
                pubXHex,
                pubYHex,
            };
        } else {
            account.addresses[address] = {
                ...account.addresses[address],
                pubXHex,
                pubYHex,
            };
        }

        if (!account.defaultAddress || !account.addresses[account.defaultAddress]) {
            account.defaultAddress = address;
        }

        await saveAccount(account);
        setSessionAddressKey(address, privateKey);

        (window as any).showToast(exists ? '地址已解锁' : '钱包导入成功', 'success');
        (window as any).navigateTo('walletManager');
    } catch (error) {
        console.error('[导入钱包] 失败:', error);
        (window as any).showToast('导入失败: ' + (error as Error).message, 'error');
    }
}
