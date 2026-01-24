/**
 * 新建钱包地址页面
 */

import { generateKeyPair, generateAddress, getPublicKeyHexFromPrivate } from '../../core/signature';
import { getActiveAccount, saveAccount, setSessionAddressKey } from '../../core/storage';
import { bindInlineHandlers } from '../utils/inlineHandlers';

let generatedPrivateKey: string | null = null;
let generatedAddress: string | null = null;
let generatedPubXHex: string | null = null;
let generatedPubYHex: string | null = null;

export function renderWalletCreate(): void {
    const app = document.getElementById('app');
    if (!app) return;

    const { privateKey, publicKey } = generateKeyPair();
    const address = generateAddress(publicKey);
    const { x: pubXHex, y: pubYHex } = getPublicKeyHexFromPrivate(privateKey);

    generatedPrivateKey = privateKey;
    generatedAddress = address;
    generatedPubXHex = pubXHex;
    generatedPubYHex = pubYHex;

    app.innerHTML = `
    <div class="page">
      <header class="header">
        <button class="header-btn" onclick="navigateTo('walletManager')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <span style="font-weight: 600;">新建钱包</span>
        <div style="width: 32px;"></div>
      </header>

      <div class="page-content">
        <div class="card" style="margin-bottom: 16px;">
          <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">钱包地址</div>
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
                私钥是该地址资产的唯一凭证，请勿泄露
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
          <button class="btn btn-primary btn-block btn-lg" onclick="handleAddWallet()">
            添加到钱包
          </button>
        </div>
      </div>
    </div>
  `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
        togglePrivateKey,
        handleAddWallet,
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

async function handleAddWallet(): Promise<void> {
    if (!generatedPrivateKey || !generatedAddress) {
        (window as any).showToast('密钥生成失败', 'error');
        return;
    }

    try {
        const account = await getActiveAccount();
        if (!account) {
            (window as any).showToast('账户未找到', 'error');
            (window as any).navigateTo('welcome');
            return;
        }

        if (generatedAddress === account.mainAddress) {
            (window as any).showToast('该私钥为账户私钥，不能作为子钱包', 'error');
            return;
        }

        if (!account.addresses[generatedAddress]) {
            account.addresses[generatedAddress] = {
                address: generatedAddress,
                type: 0,
                balance: 0,
                utxoCount: 0,
                txCerCount: 0,
                pubXHex: generatedPubXHex || '',
                pubYHex: generatedPubYHex || '',
                utxos: {},
                txCers: {},
                value: { totalValue: 0, utxoValue: 0, txCerValue: 0 },
                estInterest: 0,
            };
        }

        if (!account.defaultAddress || !account.addresses[account.defaultAddress]) {
            account.defaultAddress = generatedAddress;
        }

        await saveAccount(account);
        setSessionAddressKey(generatedAddress, generatedPrivateKey);

        generatedPrivateKey = null;
        generatedAddress = null;
        generatedPubXHex = null;
        generatedPubYHex = null;

        (window as any).showToast('钱包地址已添加', 'success');
        (window as any).navigateTo('walletManager');
    } catch (error) {
        console.error('[新建钱包] 失败:', error);
        (window as any).showToast('添加失败: ' + (error as Error).message, 'error');
    }
}
