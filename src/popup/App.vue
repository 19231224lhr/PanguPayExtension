<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import type { PendingRequest } from '../minimal/approvalStore';
import { importWalletBundle, unlockWallet } from '../minimal/walletStore';

interface PanguAccount {
    accountId: string;
    address: string;
}

interface UiState {
    hasWallet: boolean;
    unlocked: boolean;
    account: PanguAccount | null;
    pending: PendingRequest | null;
}

interface RuntimeResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
}

const state = reactive<UiState>({
    hasWallet: false,
    unlocked: false,
    account: null,
    pending: null,
});
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const bundleJson = ref('');
const importPassword = ref('');
const importPasswordAgain = ref('');
const unlockPassword = ref('');

const screen = computed(() => {
    if (!state.hasWallet) return 'import';
    if (!state.unlocked) return 'unlock';
    if (state.pending) return 'approval';
    return 'overview';
});

async function sendUi<T>(type: string, payload?: unknown): Promise<T> {
    const response = await chrome.runtime.sendMessage({ type, payload }) as RuntimeResponse<T>;
    if (!response?.success) throw new Error(response?.error || '扩展后台没有响应');
    return response.data as T;
}

async function refreshState(): Promise<void> {
    try {
        const next = await sendUi<UiState>('PANGU_UI_GET_STATE');
        Object.assign(state, next);
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '无法读取钱包状态';
    } finally {
        loading.value = false;
    }
}

function resetMessage(): void {
    error.value = '';
    notice.value = '';
}

async function importWallet(): Promise<void> {
    resetMessage();
    if (importPassword.value !== importPasswordAgain.value) {
        error.value = '两次输入的密码不一致';
        return;
    }
    busy.value = true;
    try {
        const bundle = JSON.parse(bundleJson.value) as unknown;
        await importWalletBundle(bundle, importPassword.value);
        importPassword.value = '';
        importPasswordAgain.value = '';
        notice.value = '测试钱包已安全导入，请解锁';
        await refreshState();
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '钱包 JSON 无效';
    } finally {
        busy.value = false;
    }
}

async function unlock(): Promise<void> {
    resetMessage();
    busy.value = true;
    try {
        await unlockWallet(unlockPassword.value);
        unlockPassword.value = '';
        notice.value = '钱包已解锁，有效期 15 分钟';
        await refreshState();
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '解锁失败';
    } finally {
        busy.value = false;
    }
}

async function lock(): Promise<void> {
    resetMessage();
    busy.value = true;
    try {
        const next = await sendUi<UiState>('PANGU_UI_LOCK');
        Object.assign(state, next);
        notice.value = '钱包已锁定';
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '锁定失败';
    } finally {
        busy.value = false;
    }
}

async function decide(approved: boolean): Promise<void> {
    if (!state.pending) return;
    resetMessage();
    busy.value = true;
    try {
        await sendUi(approved ? 'PANGU_UI_APPROVE' : 'PANGU_UI_REJECT', {
            requestId: state.pending.requestId,
        });
        notice.value = approved ? '请求已批准' : '请求已拒绝';
        await refreshState();
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '审批失败';
        await refreshState();
    } finally {
        busy.value = false;
    }
}

function handleStorageChange(): void {
    void refreshState();
}

onMounted(() => {
    chrome.storage.onChanged.addListener(handleStorageChange);
    void refreshState();
});

onUnmounted(() => {
    chrome.storage.onChanged.removeListener(handleStorageChange);
});
</script>

<template>
    <main class="wallet-shell">
        <header class="brand-row">
            <div class="brand-mark" aria-hidden="true">P</div>
            <div>
                <strong>PanguPay</strong>
                <p>本地快速交易钱包</p>
            </div>
        </header>

        <p v-if="error" class="message error" role="alert">{{ error }}</p>
        <p v-if="notice" class="message notice" role="status">{{ notice }}</p>

        <section v-if="loading" class="center-card" data-testid="screen-loading">
            <h1>正在读取钱包</h1>
        </section>

        <section v-else-if="screen === 'import'" class="card" data-testid="screen-import">
            <p class="eyebrow">第一步</p>
            <h1>导入测试钱包</h1>
            <p class="description">粘贴 WalletBundleV1 JSON。密钥会加密后保存在本机。</p>
            <label>
                钱包 JSON
                <textarea
                    v-model="bundleJson"
                    data-testid="bundle-input"
                    rows="9"
                    spellcheck="false"
                    placeholder="{ &quot;version&quot;: 1, ... }"
                />
            </label>
            <label>
                设置密码
                <input v-model="importPassword" data-testid="import-password" type="password" minlength="8" autocomplete="new-password">
            </label>
            <label>
                再次输入密码
                <input v-model="importPasswordAgain" data-testid="import-confirm" type="password" minlength="8" autocomplete="new-password">
            </label>
            <button data-testid="import-button" :disabled="busy" @click="importWallet">
                {{ busy ? '正在加密…' : '导入钱包' }}
            </button>
        </section>

        <section v-else-if="screen === 'unlock'" class="card" data-testid="screen-unlock">
            <p class="eyebrow">钱包已锁定</p>
            <h1>解锁钱包</h1>
            <p class="description">明文密钥只在浏览器会话中保留 15 分钟。</p>
            <label>
                钱包密码
                <input
                    v-model="unlockPassword"
                    data-testid="unlock-password"
                    type="password"
                    autocomplete="current-password"
                    @keyup.enter="unlock"
                >
            </label>
            <button data-testid="unlock-button" :disabled="busy" @click="unlock">
                {{ busy ? '正在解锁…' : '解锁' }}
            </button>
        </section>

        <section v-else-if="screen === 'approval' && state.pending" class="card" data-testid="screen-approval">
            <p class="eyebrow">来自 {{ state.pending.origin }}</p>
            <h1>{{ state.pending.kind === 'connect' ? '允许连接钱包？' : '批准快速转账？' }}</h1>

            <dl class="details">
                <template v-if="state.pending.kind === 'connect'">
                    <dt>账户</dt>
                    <dd>{{ state.account?.accountId }}</dd>
                    <dt>公开地址</dt>
                    <dd class="mono">{{ state.account?.address }}</dd>
                </template>
                <template v-else>
                    <dt>收款地址</dt>
                    <dd class="mono">{{ state.pending.request.toAddress }}</dd>
                    <dt>金额</dt>
                    <dd>{{ state.pending.request.amount }}</dd>
                    <dt>路径</dt>
                    <dd>Quick · 币种 0</dd>
                </template>
            </dl>

            <div class="button-row">
                <button class="secondary" data-testid="reject-button" :disabled="busy" @click="decide(false)">拒绝</button>
                <button data-testid="approve-button" :disabled="busy" @click="decide(true)">
                    {{ busy ? '处理中…' : '批准' }}
                </button>
            </div>
        </section>

        <section v-else class="card" data-testid="screen-overview">
            <p class="eyebrow online">钱包已解锁</p>
            <h1>实验钱包就绪</h1>
            <dl class="details">
                <dt>账户</dt>
                <dd>{{ state.account?.accountId }}</dd>
                <dt>默认地址</dt>
                <dd class="mono">{{ state.account?.address }}</dd>
                <dt>交易模式</dt>
                <dd>Quick · 币种 0</dd>
            </dl>
            <button class="secondary" data-testid="lock-button" :disabled="busy" @click="lock">锁定钱包</button>
        </section>

        <footer>仅允许 localhost 与 127.0.0.1</footer>
    </main>
</template>
