/**
 * 新建钱包地址页面
 */

import { createNewAddressOnBackendWithPriv, registerAddressOnComNode } from '../../core/address';
import { generateKeyPair, generateAddress, getPublicKeyHexFromPrivate } from '../../core/signature';
import { getActiveAccount, getOrganization, getSessionKey, saveAccount, setSessionAddressKey } from '../../core/storage';
import { bindInlineHandlers } from '../utils/inlineHandlers';
import { enhanceCustomSelects } from '../utils/customSelect';

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
        <div class="card form-section section-space">
          <div class="form-section-title">币种类型</div>
          <select id="walletCoinType" class="input recipient-coin-select">
            <option value="0">PGC</option>
            <option value="1">BTC</option>
            <option value="2">ETH</option>
          </select>
        </div>

        <div class="card account-card section-space">
          <div class="account-row">
            <div class="account-label">钱包地址</div>
            <div class="account-value account-value--mono">${address}</div>
          </div>
        </div>

        <div class="card notice-card section-space">
          <div class="notice-icon">!</div>
          <div>
            <div class="notice-title">请妥善保管私钥</div>
            <div class="notice-desc">私钥是该地址资产的唯一凭证，请勿泄露</div>
          </div>
        </div>

        <div class="input-group">
          <div class="label-row">
            <label class="input-label">私钥（点击显示）</label>
            <button class="link-btn" type="button" onclick="copyPrivateKey()" aria-label="复制私钥">复制</button>
          </div>
          <div class="reveal-card" onclick="togglePrivateKey()">
            <div id="privateKeyDisplay" class="reveal-text">
              点击显示私钥...
            </div>
          </div>
        </div>

        <div class="form-actions">
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
        copyPrivateKey,
        handleAddWallet,
    });

    enhanceCustomSelects(app);
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

function getSelectedCoinType(): number {
    const select = document.getElementById('walletCoinType') as HTMLSelectElement | null;
    const parsed = Number.parseInt(select?.value || '0', 10);
    return [0, 1, 2].includes(parsed) ? parsed : 0;
}

function copyPrivateKey(): void {
    if (!generatedPrivateKey) {
        (window as any).showToast('请先生成私钥', 'info');
        return;
    }
    navigator.clipboard.writeText(generatedPrivateKey).then(() => {
        (window as any).showToast('私钥已复制', 'success');
    });
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

        const normalizedAddress = generatedAddress.toLowerCase();
        const normalizedMain = account.mainAddress.toLowerCase();
        const coinType = getSelectedCoinType();

        if (normalizedAddress === normalizedMain) {
            (window as any).showToast('该私钥为账户私钥，不能作为子钱包', 'error');
            return;
        }

        const org = await getOrganization(account.accountId);
        const inOrg = !!org?.groupId;
        if (inOrg) {
            const session = getSessionKey();
            if (!session || session.accountId !== account.accountId) {
                (window as any).showToast('请先解锁账户私钥', 'error');
                return;
            }

            const result = await createNewAddressOnBackendWithPriv(
                account.accountId,
                normalizedAddress,
                generatedPubXHex || '',
                generatedPubYHex || '',
                coinType,
                session.privKey,
                org
            );

            if (!result.success) {
                (window as any).showToast(result.error || '创建地址失败', 'error');
                return;
            }
        }

        if (!account.addresses[normalizedAddress]) {
            account.addresses[normalizedAddress] = {
                address: normalizedAddress,
                type: coinType,
                balance: 0,
                utxoCount: 0,
                txCerCount: 0,
                source: 'created',
                pubXHex: generatedPubXHex || '',
                pubYHex: generatedPubYHex || '',
                utxos: {},
                txCers: {},
                value: { totalValue: 0, utxoValue: 0, txCerValue: 0 },
                estInterest: 0,
            };
        } else if (!account.addresses[normalizedAddress].source) {
            account.addresses[normalizedAddress].source = 'created';
        }

        if (!account.defaultAddress || !account.addresses[account.defaultAddress]) {
            account.defaultAddress = normalizedAddress;
        }

        await saveAccount(account);
        setSessionAddressKey(normalizedAddress, generatedPrivateKey);

        if (!inOrg) {
            const registerResult = await registerAddressOnComNode(
                normalizedAddress,
                generatedPubXHex || '',
                generatedPubYHex || '',
                generatedPrivateKey,
                coinType
            );
            if (!registerResult.success) {
                const msg = registerResult.error || '地址注册失败';
                const boundMatch = msg.match(/address already bound to guarantor group (\d+)/i);
                if (boundMatch && boundMatch[1]) {
                    (window as any).showToast(`该地址已绑定担保组织 ${boundMatch[1]}，请先加入组织后导入`, 'error');
                } else {
                    (window as any).showToast(msg, 'error');
                }
                return;
            }
        }

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
