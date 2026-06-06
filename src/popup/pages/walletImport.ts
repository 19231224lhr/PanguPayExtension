/**
 * 导入钱包地址页面
 */

import {
    createNewAddressOnBackendWithPriv,
    isInGuarGroup,
    queryAddressGroupInfo,
    registerAddressOnComNode,
} from '../../core/address';
import { getPublicKeyFromPrivate, generateAddress, getPublicKeyHexFromPrivate } from '../../core/signature';
import {
    deriveAddressKeypairFromAddressRootSeed,
    parseAddressRecoveryMaterial,
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
import { escapeHtml, renderHeaderBar, renderNotice, renderStatusBadge } from '../utils/ui';

const TEXT = {
    'zh-CN': {
        title: '导入钱包',
        importTitle: '导入材料',
        importDesc: '支持 AddressRootSeed 和旧版 64 位私钥。',
        material: 'AddressRootSeed / 私钥',
        placeholder: '输入 arsk_pgc_... / arsk_btc_... / arsk_eth_... 或 64 位十六进制私钥',
        hint: '请确保在安全环境中操作，导入后会本地加密保存。',
        preview: '地址预览',
        type: '导入类型',
        submit: '导入钱包',
        submitting: '导入中...',
        invalid: '密钥格式无效',
        rootSeed: 'AddressRootSeed',
        legacy: 'Legacy Private Key',
        safeTitle: '链上状态会自动补齐',
        safeDesc: '导入后插件会查询地址所属组织、seed 元数据和注册状态。',
    },
    en: {
        title: 'Import Wallet',
        importTitle: 'Recovery Material',
        importDesc: 'AddressRootSeed and legacy 64-char private keys are supported.',
        material: 'AddressRootSeed / Private Key',
        placeholder: 'Enter arsk_pgc_... / arsk_btc_... / arsk_eth_... or 64-char private key',
        hint: 'Use a trusted environment. The key will be encrypted locally after import.',
        preview: 'Address Preview',
        type: 'Import Type',
        submit: 'Import Wallet',
        submitting: 'Importing...',
        invalid: 'Invalid key material',
        rootSeed: 'AddressRootSeed',
        legacy: 'Legacy Private Key',
        safeTitle: 'On-chain state will sync',
        safeDesc: 'The extension will query organization, seed metadata, and registration state after import.',
    },
};

function getText() {
    return getActiveLanguage() === 'en' ? TEXT.en : TEXT['zh-CN'];
}

export function renderWalletImport(): void {
    const app = document.getElementById('app');
    if (!app) return;

    const t = getText();
    app.innerHTML = `
    <div class="page wallet-import-page">
      ${renderHeaderBar({ title: t.title, backPage: 'walletManager' })}

      <div class="page-content">
        <div class="card import-card">
          <div class="section-heading">${escapeHtml(t.importTitle)}</div>
          <div class="input-hint">${escapeHtml(t.importDesc)}</div>
        </div>

        ${renderNotice('info', t.safeTitle, t.safeDesc)}

        <form id="walletImportForm" class="form-stack">
          <div class="input-group">
            <label class="input-label" for="privateKey">${escapeHtml(t.material)}</label>
            <textarea
              class="input textarea-mono"
              id="privateKey"
              placeholder="${escapeHtml(t.placeholder)}"
              required
            ></textarea>
            <div class="input-hint">${escapeHtml(t.hint)}</div>
          </div>

          <div id="addressPreview" class="card import-preview" hidden>
            <div class="summary-row">
              <span>${escapeHtml(t.preview)}</span>
              <span id="previewType">${renderStatusBadge(t.legacy, 'neutral')}</span>
            </div>
            <div id="previewAddress" class="copy-row-value"></div>
          </div>

          <button id="walletImportSubmit" type="submit" class="btn btn-primary btn-block btn-lg">
            ${escapeHtml(t.submit)}
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
    const t = getText();
    const input = e.target as HTMLTextAreaElement;
    const value = input.value.trim();

    const preview = document.getElementById('addressPreview') as HTMLElement | null;
    const previewAddress = document.getElementById('previewAddress');
    const previewType = document.getElementById('previewType');
    if (!preview || !previewAddress) return;

    try {
        const material = parseAddressRecoveryMaterial(value);
        const privateKey = material.kind === 'root_seed'
            ? deriveAddressKeypairFromAddressRootSeed(material.hex, material.addressType ?? 0).privHex
            : material.hex;
        if (privateKey.length !== 64 || !/^[0-9a-f]+$/.test(privateKey)) {
            preview.hidden = true;
            return;
        }
        const publicKey = getPublicKeyFromPrivate(privateKey);
        const address = generateAddress(publicKey);
        previewAddress.textContent = address;
        if (previewType) {
            previewType.innerHTML = renderStatusBadge(material.kind === 'root_seed' ? t.rootSeed : t.legacy, material.kind === 'root_seed' ? 'primary' : 'neutral');
        }
        preview.hidden = false;
    } catch {
        preview.hidden = true;
    }
}

async function handleImport(e: Event): Promise<void> {
    e.preventDefault();

    const t = getText();
    const submitBtn = document.getElementById('walletImportSubmit') as HTMLButtonElement | null;
    const rawInput = (document.getElementById('privateKey') as HTMLTextAreaElement).value.trim();
    let privateKey = '';
    let addressRootSeedHex: string | undefined;
    let importedAddressType: number | undefined;
    try {
        const material = parseAddressRecoveryMaterial(rawInput);
        if (material.kind === 'root_seed') {
            importedAddressType = material.addressType ?? 0;
            const derived = deriveAddressKeypairFromAddressRootSeed(material.hex, importedAddressType);
            privateKey = derived.privHex;
            addressRootSeedHex = derived.addressRootSeedHex;
        } else {
            privateKey = material.hex;
        }
    } catch {
        privateKey = '';
    }

    if (privateKey.length !== 64 || !/^[0-9a-f]+$/.test(privateKey)) {
        (window as any).showToast(t.invalid, 'error');
        return;
    }

    try {
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = t.submitting;
        }
        const account = await getActiveAccount();
        if (!account) {
            (window as any).showToast('账户未找到', 'error');
            (window as any).navigateTo('welcome');
            return;
        }

        const publicKey = getPublicKeyFromPrivate(privateKey);
        const address = generateAddress(publicKey);
        const { x: pubXHex, y: pubYHex } = getPublicKeyHexFromPrivate(privateKey);
        const normalizedAddress = address.toLowerCase();

        const groupResult = await queryAddressGroupInfo(normalizedAddress);
        if (!groupResult.success) {
            (window as any).showToast(groupResult.error || '查询失败', 'error');
            return;
        }

        const groupId = groupResult.data?.groupId || '0';
        const addressType = importedAddressType ?? groupResult.data?.type ?? 0;

        const org = await getOrganization(account.accountId);
        const inOrg = !!org?.groupId;
        const onboardingStep = await getOnboardingStep(account.accountId);
        const isOnboarding = onboardingStep !== 'complete';

        if (isInGuarGroup(groupId)) {
            if (!inOrg) {
                (window as any).showToast(`该地址归属于担保组织 ${groupId}，请先加入组织后导入`, 'error');
                return;
            }
            if (org?.groupId !== groupId) {
                (window as any).showToast(`该地址归属于担保组织 ${groupId}，当前组织为 ${org?.groupId || '未知'}`, 'error');
                return;
            }
        }

        if (normalizedAddress === account.mainAddress.toLowerCase()) {
            (window as any).showToast('该私钥为账户私钥，不能作为子钱包', 'error');
            return;
        }

        const exists = !!account.addresses[normalizedAddress];

        if (inOrg && !exists && !isOnboarding) {
            const session = getSessionKey();
            if (!session || session.accountId !== account.accountId) {
                (window as any).showToast('请先解锁账户私钥', 'error');
                return;
            }

            const syncResult = await createNewAddressOnBackendWithPriv(
                account.accountId,
                normalizedAddress,
                pubXHex,
                pubYHex,
                addressType,
                session.privKey,
                org,
                privateKey
            );

            if (!syncResult.success) {
                const msg = syncResult.error || '导入失败';
                if (!/already|exists/i.test(msg)) {
                    (window as any).showToast(msg, 'error');
                    return;
                }
            }
        }

        if (!inOrg && !exists && !isOnboarding) {
            const registerResult = await registerAddressOnComNode(
                normalizedAddress,
                pubXHex,
                pubYHex,
                privateKey,
                addressType
            );
            if (!registerResult.success) {
                const msg = registerResult.error || '导入失败';
                const boundMatch = msg.match(/address already bound to guarantor group (\d+)/i);
                if (boundMatch && boundMatch[1]) {
                    (window as any).showToast(`该地址已绑定担保组织 ${boundMatch[1]}，请先加入组织后导入`, 'error');
                } else {
                    (window as any).showToast(msg, 'error');
                }
                return;
            }
        }

        if (!exists) {
            account.addresses[normalizedAddress] = {
                address: normalizedAddress,
                type: addressType,
                balance: 0,
                utxoCount: 0,
                txCerCount: 0,
                source: 'imported',
                privHex: privateKey,
                addressRootSeedHex,
                signPublicKeyV2: groupResult.data?.signPublicKeyV2,
                seedAnchor: groupResult.data?.seedAnchor,
                seedChainStep: groupResult.data?.seedChainStep,
                defaultSpendAlgorithm: groupResult.data?.defaultSpendAlgorithm,
                pubXHex,
                pubYHex,
                utxos: {},
                txCers: {},
                value: { totalValue: 0, utxoValue: 0, txCerValue: 0 },
                estInterest: 0,
            };
        } else {
            account.addresses[normalizedAddress] = {
                ...account.addresses[normalizedAddress],
                pubXHex,
                pubYHex,
                type: addressType,
                privHex: privateKey,
                addressRootSeedHex: addressRootSeedHex || account.addresses[normalizedAddress].addressRootSeedHex,
                signPublicKeyV2: groupResult.data?.signPublicKeyV2 || account.addresses[normalizedAddress].signPublicKeyV2,
                seedAnchor: groupResult.data?.seedAnchor || account.addresses[normalizedAddress].seedAnchor,
                seedChainStep: groupResult.data?.seedChainStep || account.addresses[normalizedAddress].seedChainStep,
                defaultSpendAlgorithm: groupResult.data?.defaultSpendAlgorithm || account.addresses[normalizedAddress].defaultSpendAlgorithm,
                source: account.addresses[normalizedAddress].source || 'imported',
            };
        }

        if (!account.defaultAddress || !account.addresses[account.defaultAddress]) {
            account.defaultAddress = normalizedAddress;
        }

        await saveAccount(account);
        setSessionAddressKey(normalizedAddress, privateKey);
        const session = getSessionKey();
        if (session && session.accountId === account.accountId) {
            await persistAddressKey(account.accountId, normalizedAddress, privateKey, session.privKey);
        }

        (window as any).showToast(exists ? '地址已解锁' : '钱包导入成功', 'success');
        (window as any).navigateTo('walletManager');
    } catch (error) {
        console.error('[导入钱包] 失败:', error);
        (window as any).showToast('导入失败: ' + (error as Error).message, 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = t.submit;
        }
    }
}
