/**
 * Create a wallet address derived from AddressRootSeed.
 */

import { createNewAddressOnBackendWithPriv, registerAddressOnComNode } from '../../core/address';
import { getPublicKeyHexFromPrivate } from '../../core/signature';
import {
  deriveAddressKeypairFromAddressRootSeed,
  formatAddressRootSeedForExport,
  generateAddressRootSeedHex,
} from '../../core/addressRootSeed';
import {
  getActiveAccount,
  getOrganization,
  getOnboardingStep,
  getSessionKey,
  saveAccount,
  setSessionAddressKey,
  persistAddressKey,
} from '../../core/storage';
import { bindInlineHandlers } from '../utils/inlineHandlers';
import { getActiveLanguage } from '../utils/appSettings';
import {
  escapeHtml,
  renderCoinBadge,
  renderHeaderBar,
  renderNotice,
  renderStatusBadge,
} from '../utils/ui';

let generatedPrivateKey: string | null = null;
let generatedAddress: string | null = null;
let generatedPubXHex: string | null = null;
let generatedPubYHex: string | null = null;
let generatedAddressRootSeedHex: string | null = null;

const TEXT = {
  'zh-CN': {
    title: '新建钱包',
    coin: '币种类型',
    address: '钱包地址',
    seed: 'AddressRootSeed',
    hidden: '点击显示 AddressRootSeed...',
    copy: '复制',
    add: '添加到钱包',
    adding: '添加中...',
    warningTitle: '请妥善保管 AddressRootSeed',
    warningDesc: '它可恢复该币种地址和 seed-chain，本地丢失后可能无法继续签名。',
    initial: '初始 seed step',
    generated: '已生成',
    copied: '密钥材料已复制',
    missing: '密钥生成失败',
    accountMissing: '账户未找到',
    unlockRequired: '请先解锁账户私钥',
    sameAsMain: '该私钥为账户私钥，不能作为子钱包',
    createFailed: '创建地址失败',
    registerFailed: '地址注册失败',
    added: '钱包地址已添加',
  },
  en: {
    title: 'Create Wallet',
    coin: 'Coin',
    address: 'Wallet Address',
    seed: 'AddressRootSeed',
    hidden: 'Click to reveal AddressRootSeed...',
    copy: 'Copy',
    add: 'Add to Wallet',
    adding: 'Adding...',
    warningTitle: 'Keep AddressRootSeed safe',
    warningDesc: 'It restores this coin address and seed-chain. Without it, signing may become unavailable.',
    initial: 'Initial seed step',
    generated: 'Generated',
    copied: 'Key material copied',
    missing: 'Failed to generate key',
    accountMissing: 'Account not found',
    unlockRequired: 'Unlock account private key first',
    sameAsMain: 'This is the account private key and cannot be used as a sub wallet',
    createFailed: 'Failed to create address',
    registerFailed: 'Failed to register address',
    added: 'Wallet address added',
  },
};

function getText() {
  return getActiveLanguage() === 'en' ? TEXT.en : TEXT['zh-CN'];
}

export function renderWalletCreate(): void {
  const app = document.getElementById('app');
  if (!app) return;

  const t = getText();
  generatedAddressRootSeedHex = generateAddressRootSeedHex();
  deriveForCoin(0);

  app.innerHTML = `
    <div class="page wallet-create-page">
      ${renderHeaderBar({ title: t.title, backPage: 'walletManager' })}
      <div class="page-content">
        <div class="card form-section">
          <div class="form-section-title">${escapeHtml(t.coin)}</div>
          <div class="segmented-control" role="tablist" aria-label="${escapeHtml(t.coin)}">
            ${[0, 1, 2]
              .map((type) => `
                <button class="segment-option ${type === 0 ? 'active' : ''}" type="button" data-coin-type="${type}">
                  ${renderCoinBadge(type, true)}
                </button>
              `)
              .join('')}
          </div>
        </div>

        <div class="card account-card wallet-preview-card">
          <div class="wallet-preview-top">
            <div>
              <div class="account-label">${escapeHtml(t.address)}</div>
              <div id="walletCoinLabel" class="wallet-preview-coin">${renderCoinBadge(0, true)} ${renderStatusBadge(t.generated, 'success')}</div>
            </div>
            <div class="status-badge status-badge--info">${escapeHtml(t.initial)} 0</div>
          </div>
          <div id="walletAddressPreview" class="account-value account-value--mono">${escapeHtml(generatedAddress || '')}</div>
        </div>

        ${renderNotice('warning', t.warningTitle, t.warningDesc)}

        <div class="card secret-card">
          <div class="label-row">
            <label class="input-label">${escapeHtml(t.seed)}</label>
            <button class="link-btn" type="button" onclick="copyPrivateKey()">${escapeHtml(t.copy)}</button>
          </div>
          <button class="reveal-card reveal-card--button" type="button" onclick="togglePrivateKey()">
            <div id="privateKeyDisplay" class="reveal-text secret-value">${escapeHtml(t.hidden)}</div>
          </button>
        </div>

        <div class="form-actions">
          <button id="addWalletBtn" class="btn btn-primary btn-block btn-lg" type="button" onclick="handleAddWallet()">
            ${escapeHtml(t.add)}
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

  app.querySelectorAll<HTMLButtonElement>('[data-coin-type]').forEach((button) => {
    button.addEventListener('click', () => {
      const type = Number(button.dataset.coinType || 0);
      app.querySelectorAll('[data-coin-type]').forEach((node) => node.classList.remove('active'));
      button.classList.add('active');
      refreshDerivedAddress(type);
    });
  });
}

function deriveForCoin(coinType: number): void {
  if (!generatedAddressRootSeedHex) return;
  const derived = deriveAddressKeypairFromAddressRootSeed(generatedAddressRootSeedHex, coinType);
  const { x: pubXHex, y: pubYHex } = getPublicKeyHexFromPrivate(derived.privHex);
  generatedPrivateKey = derived.privHex;
  generatedAddress = derived.address;
  generatedPubXHex = pubXHex || derived.pubXHex;
  generatedPubYHex = pubYHex || derived.pubYHex;
}

function refreshDerivedAddress(coinType = getSelectedCoinType()): void {
  const t = getText();
  deriveForCoin(coinType);
  const preview = document.getElementById('walletAddressPreview');
  if (preview) preview.textContent = generatedAddress || '';
  const coinLabel = document.getElementById('walletCoinLabel');
  if (coinLabel) {
    coinLabel.innerHTML = `${renderCoinBadge(coinType, true)} ${renderStatusBadge(t.generated, 'success')}`;
  }
  const display = document.getElementById('privateKeyDisplay');
  if (display?.dataset.shown === 'true' && generatedAddressRootSeedHex) {
    display.textContent = formatAddressRootSeedForExport(generatedAddressRootSeedHex, coinType);
  }
}

function togglePrivateKey(): void {
  const t = getText();
  const display = document.getElementById('privateKeyDisplay');
  if (!display || !generatedPrivateKey) return;

  if (display.dataset.shown === 'true') {
    display.textContent = t.hidden;
    display.dataset.shown = 'false';
    display.classList.remove('is-revealed');
  } else {
    display.textContent = generatedAddressRootSeedHex
      ? formatAddressRootSeedForExport(generatedAddressRootSeedHex, getSelectedCoinType())
      : generatedPrivateKey;
    display.dataset.shown = 'true';
    display.classList.add('is-revealed');
  }
}

function getSelectedCoinType(): number {
  const active = document.querySelector<HTMLElement>('[data-coin-type].active');
  const parsed = Number.parseInt(active?.dataset.coinType || '0', 10);
  return [0, 1, 2].includes(parsed) ? parsed : 0;
}

function copyPrivateKey(): void {
  const t = getText();
  if (!generatedPrivateKey) {
    (window as any).showToast(t.missing, 'info');
    return;
  }
  const material = generatedAddressRootSeedHex
    ? formatAddressRootSeedForExport(generatedAddressRootSeedHex, getSelectedCoinType())
    : generatedPrivateKey;
  navigator.clipboard.writeText(material).then(() => {
    (window as any).showToast(t.copied, 'success');
  });
}

async function handleAddWallet(): Promise<void> {
  const t = getText();
  if (!generatedPrivateKey || !generatedAddress) {
    (window as any).showToast(t.missing, 'error');
    return;
  }

  const submitBtn = document.getElementById('addWalletBtn') as HTMLButtonElement | null;

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = t.adding;
    }

    const account = await getActiveAccount();
    if (!account) {
      (window as any).showToast(t.accountMissing, 'error');
      (window as any).navigateTo('welcome');
      return;
    }

    const normalizedAddress = generatedAddress.toLowerCase();
    const normalizedMain = account.mainAddress.toLowerCase();
    const coinType = getSelectedCoinType();

    if (normalizedAddress === normalizedMain) {
      (window as any).showToast(t.sameAsMain, 'error');
      return;
    }

    const org = await getOrganization(account.accountId);
    const inOrg = !!org?.groupId;
    const onboardingStep = await getOnboardingStep(account.accountId);
    const isOnboarding = onboardingStep !== 'complete';
    const session = getSessionKey();

    if (inOrg && !isOnboarding) {
      if (!session || session.accountId !== account.accountId) {
        (window as any).showToast(t.unlockRequired, 'error');
        return;
      }

      const result = await createNewAddressOnBackendWithPriv(
        account.accountId,
        normalizedAddress,
        generatedPubXHex || '',
        generatedPubYHex || '',
        coinType,
        session.privKey,
        org,
        generatedPrivateKey
      );

      if (!result.success) {
        (window as any).showToast(result.error || t.createFailed, 'error');
        return;
      }
    }

    if (!inOrg && !isOnboarding && (!session || session.accountId !== account.accountId)) {
      (window as any).showToast(t.unlockRequired, 'error');
      return;
    }

    if (!account.addresses[normalizedAddress]) {
      account.addresses[normalizedAddress] = {
        address: normalizedAddress,
        type: coinType,
        balance: 0,
        utxoCount: 0,
        txCerCount: 0,
        source: 'created',
        privHex: generatedPrivateKey,
        addressRootSeedHex: generatedAddressRootSeedHex || undefined,
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
    if (session && session.accountId === account.accountId) {
      await persistAddressKey(account.accountId, normalizedAddress, generatedPrivateKey, session.privKey);
    }

    if (!inOrg && !isOnboarding) {
      const registerResult = await registerAddressOnComNode({
        accountId: account.accountId,
        address: normalizedAddress,
        pubXHex: generatedPubXHex || '',
        pubYHex: generatedPubYHex || '',
        addressPrivHex: generatedPrivateKey,
        accountPrivHex: session!.privKey,
        addressType: coinType,
      });
      const registerSuccess = registerResult.success &&
        (typeof registerResult.data?.success === 'boolean' ? registerResult.data.success : true);
      if (!registerSuccess) {
        const msg = registerResult.success
          ? registerResult.data?.error || registerResult.data?.message || t.registerFailed
          : registerResult.error || t.registerFailed;
        account.addresses[normalizedAddress] = {
          ...account.addresses[normalizedAddress],
          registrationState: 'failed',
          registrationError: msg,
        };
        await saveAccount(account);
        (window as any).showToast(msg, 'error');
        return;
      }

      account.addresses[normalizedAddress] = {
        ...account.addresses[normalizedAddress],
        signPublicKeyV2: registerResult.data.signPublicKeyV2,
        seedAnchor: registerResult.data.seedAnchor,
        seedChainStep: registerResult.data.seedChainStep,
        defaultSpendAlgorithm: registerResult.data.defaultSpendAlgorithm,
        registrationState: 'registered',
        registrationError: undefined,
      };
      await saveAccount(account);
    }

    generatedPrivateKey = null;
    generatedAddress = null;
    generatedPubXHex = null;
    generatedPubYHex = null;
    generatedAddressRootSeedHex = null;

    (window as any).showToast(t.added, 'success');
    (window as any).navigateTo('walletManager');
  } catch (error) {
    console.error('[WalletCreate] failed:', error);
    (window as any).showToast(`${t.createFailed}: ${(error as Error).message}`, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = t.add;
    }
  }
}
