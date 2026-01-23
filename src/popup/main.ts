/**
 * Popup 主入口
 */

import {
    getActiveAccount,
    getAllAccounts,
    getSessionKey,
    getOnboardingStep,
} from '../core/storage';
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
import type { PageName } from '../core/types';

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

export function showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
    const existing = document.querySelector('.toast');
    if (existing) {
        existing.remove();
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

(window as any).showToast = showToast;

// ========================================
// 初始化
// ========================================

async function init(): Promise<void> {
    try {
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
            const step = await getOnboardingStep(session.accountId);
            navigateTo(step === 'complete' ? 'home' : step === 'organization' ? 'organization' : 'walletManager');
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
document.addEventListener('DOMContentLoaded', init);
