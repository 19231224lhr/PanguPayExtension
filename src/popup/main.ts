/**
 * Popup 主入口
 */

import {
    getActiveAccount,
    getAllAccounts,
    getSessionKey,
    getOnboardingStep,
    hydrateSession,
    getDappPendingConnection,
    getDappSignPendingConnection,
} from '../core/storage';
import { startTxStatusSync } from '../core/txStatus';
import { renderWelcome } from './pages/welcome';
import { renderUnlock } from './pages/unlock';
import { renderSetPassword } from './pages/setPassword';
import { renderWalletManager } from './pages/walletManager';
import { renderWalletCreate } from './pages/walletCreate';
import { renderWalletImport } from './pages/walletImport';
import { renderHome } from './pages/home';
import { renderSend } from './pages/send';
import { renderReceive } from './pages/receive';
import { renderHistory } from './pages/history';
import { renderOrganization } from './pages/organization';
import { renderSettings } from './pages/settings';
import { renderCreate } from './pages/create';
import { renderImport } from './pages/import';
import { renderDappConnect } from './pages/dappConnect';
import { renderDappSignConnect } from './pages/dappSignConnect';
import type { PageName } from '../core/types';
import { applyStoredSettings } from './utils/appSettings';

// ========================================
// 路由状态
// ========================================

let currentPage: PageName | null = null;

type PageRenderer = () => void | Promise<void>;

// ========================================
// 页面渲染器映射
// ========================================

const pageRenderers: Record<PageName, PageRenderer> = {
    unlock: renderUnlock,
    setPassword: renderSetPassword,
    welcome: renderWelcome,
    create: renderCreate,
    import: renderImport,
    walletManager: renderWalletManager,
    walletCreate: renderWalletCreate,
    walletImport: renderWalletImport,
    home: renderHome,
    send: renderSend,
    receive: renderReceive,
    history: renderHistory,
    organization: renderOrganization,
    settings: renderSettings,
    dappConnect: renderDappConnect,
    dappSign: renderDappSignConnect,
};

// ========================================
// 导航函数（全局暴露）
// ========================================

async function renderWithTransition(renderer: PageRenderer): Promise<void> {
    const app = document.getElementById('app');

    // If the DOM isn't ready yet, just render without animation.
    if (!app) {
        await Promise.resolve(renderer());
        return;
    }

    const oldRoot = app.firstElementChild as HTMLElement | null;
    const oldClone = oldRoot ? (oldRoot.cloneNode(true) as HTMLElement) : null;

    await Promise.resolve(renderer());

    const newRoot = app.firstElementChild as HTMLElement | null;
    if (newRoot) {
        newRoot.classList.add('view', 'view-enter');
        newRoot.addEventListener(
            'animationend',
            () => {
                newRoot.classList.remove('view-enter');
            },
            { once: true }
        );
    }

    if (oldClone) {
        oldClone.classList.add('view', 'view-exit');
        oldClone.setAttribute('aria-hidden', 'true');
        app.appendChild(oldClone);

        const cleanup = () => oldClone.remove();
        oldClone.addEventListener('animationend', cleanup, { once: true });

        // Fallback for reduced-motion / cases where animation events don't fire.
        window.setTimeout(cleanup, 240);
    }
}

async function resolveTargetPage(page: PageName): Promise<PageName> {
    const account = await getActiveAccount();
    if (!account) return page;

    const step = await getOnboardingStep(account.accountId);
    if (step === 'complete') return page;

    const walletAllowed = new Set<PageName>([
        'welcome',
        'create',
        'import',
        'unlock',
        'setPassword',
        'walletManager',
        'walletCreate',
        'walletImport',
    ]);

    const orgAllowed = new Set<PageName>([
        'welcome',
        'create',
        'import',
        'unlock',
        'setPassword',
        'walletManager',
        'walletCreate',
        'walletImport',
        'organization',
    ]);

    if (step === 'wallet' && !walletAllowed.has(page)) {
        return 'walletManager';
    }

    if (step === 'organization' && !orgAllowed.has(page)) {
        return 'organization';
    }

    return page;
}

export async function navigateTo(page: PageName): Promise<void> {
    const targetPage = await resolveTargetPage(page);
    if (targetPage === currentPage) return;
    currentPage = targetPage;
    (window as any).__currentPage = currentPage;
    const renderer = pageRenderers[targetPage];
    if (renderer) {
        try {
            await renderWithTransition(renderer);
        } catch (error) {
            console.error('[PanguPay] 页面渲染失败:', error);
            showToast('页面加载失败', 'error');
        }
    }
}

// 暴露到全局
(window as any).navigateTo = navigateTo;
(window as any).transitionRender = renderWithTransition;

// ========================================
// Toast 提示
// ========================================

type ToastType = 'success' | 'error' | 'info' | 'warning';

const TOAST_DEFAULT_TITLES: Record<ToastType, string> = {
    success: '成功',
    error: '失败',
    info: '提示',
    warning: '注意',
};

const MAX_TOASTS = 3;

function getToastContainer(): HTMLElement {
    let container = document.querySelector<HTMLElement>('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    return container;
}

function removeToast(toast: HTMLElement): void {
    if (!toast || toast.classList.contains('toast--exiting')) return;
    toast.classList.add('toast--exiting');
    setTimeout(() => {
        toast.remove();
    }, 180);
}

export function showToast(
    message: string,
    type: ToastType = 'info',
    title = '',
    duration = 3000
): HTMLElement {
    const container = getToastContainer();

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    const safeTitle = title || TOAST_DEFAULT_TITLES[type] || TOAST_DEFAULT_TITLES.info;

    toast.innerHTML = `
      <div class="toast-dot"></div>
      <div class="toast-body">
        <div class="toast-title"></div>
        <div class="toast-message"></div>
      </div>
      <button class="toast-close" type="button" aria-label="关闭">x</button>
    `;

    const titleEl = toast.querySelector<HTMLElement>('.toast-title');
    if (titleEl) titleEl.textContent = safeTitle;
    const messageEl = toast.querySelector<HTMLElement>('.toast-message');
    if (messageEl) messageEl.textContent = message;

    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('toast--show');
    });

    const closeBtn = toast.querySelector<HTMLButtonElement>('.toast-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => removeToast(toast));
    }

    const active = Array.from(container.querySelectorAll<HTMLElement>('.toast'));
    if (active.length > MAX_TOASTS) {
        removeToast(active[0]);
    }

    if (duration > 0) {
        setTimeout(() => removeToast(toast), duration);
    }

    return toast;
}

export const showSuccessToast = (message: string, title = '', duration = 3000) =>
    showToast(message, 'success', title, duration);
export const showErrorToast = (message: string, title = '', duration = 3000) =>
    showToast(message, 'error', title, duration);
export const showInfoToast = (message: string, title = '', duration = 3000) =>
    showToast(message, 'info', title, duration);
export const showWarningToast = (message: string, title = '', duration = 3000) =>
    showToast(message, 'warning', title, duration);

(window as any).showToast = showToast;
(window as any).showSuccessToast = showSuccessToast;
(window as any).showErrorToast = showErrorToast;
(window as any).showInfoToast = showInfoToast;
(window as any).showWarningToast = showWarningToast;

(window as any).PanguPay = (window as any).PanguPay || {};
(window as any).PanguPay.ui = {
    ...(window as any).PanguPay.ui,
    showToast,
    showSuccessToast,
    showErrorToast,
    showInfoToast,
    showWarningToast,
};

const uiPort = chrome.runtime.connect({ name: 'pangu-ui' });

uiPort.onMessage.addListener((message) => {
    if (message?.type !== 'PANGU_UI_PENDING' && message?.type !== 'PANGU_UI_SIGN_PENDING') return;
    void (async () => {
        const account = await getActiveAccount();
        if (!account) return;
        if (message.accountId && message.accountId !== account.accountId) return;
        navigateTo(message.type === 'PANGU_UI_SIGN_PENDING' ? 'dappSign' : 'dappConnect');
    })();
});

chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'PANGU_UI_PENDING' && message?.type !== 'PANGU_UI_SIGN_PENDING') return;
    void (async () => {
        const account = await getActiveAccount();
        if (!account) return;
        if (message.accountId && message.accountId !== account.accountId) return;
        navigateTo(message.type === 'PANGU_UI_SIGN_PENDING' ? 'dappSign' : 'dappConnect');
    })();
});

// ========================================
// 初始化
// ========================================

async function init(): Promise<void> {
    try {
        await applyStoredSettings();
        await hydrateSession();

        // 检查是否有账户
        const accounts = await getAllAccounts();

        if (accounts.length === 0) {
            // 没有账户，显示欢迎页
            navigateTo('welcome');
            return;
        }

        // 检查是否已解锁
        const session = getSessionKey();
        if (session) {
            void startTxStatusSync(session.accountId);
            const step = await getOnboardingStep(session.accountId);
            if (step === 'complete') {
                const pendingSign = await getDappSignPendingConnection(session.accountId);
                if (pendingSign) {
                    navigateTo('dappSign');
                    return;
                }
                const pending = await getDappPendingConnection(session.accountId);
                if (pending) {
                    navigateTo('dappConnect');
                } else {
                    navigateTo('home');
                }
            } else {
                navigateTo(step === 'organization' ? 'organization' : 'walletManager');
            }
        } else {
            // 未解锁，显示解锁页
            navigateTo('unlock');
        }
    } catch (error) {
        console.error('[PanguPay] 初始化失败:', error);
        showToast('初始化失败', 'error');
    }
}

// 等待 DOM 加载完成
document.addEventListener('DOMContentLoaded', () => {
    init();
});
