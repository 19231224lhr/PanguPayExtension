import type { PageName } from '../../core/types';
import { COIN_NAMES } from '../../core/types';
import type { ExtensionSettings } from '../../core/storage';

export type UiTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
export type Language = ExtensionSettings['language'];

const NAV_LABELS: Record<Language, Record<'home' | 'history' | 'organization' | 'settings', string>> = {
    'zh-CN': {
        home: '首页',
        history: '历史',
        organization: '组织',
        settings: '设置',
    },
    en: {
        home: 'Home',
        history: 'History',
        organization: 'Org',
        settings: 'Settings',
    },
};

const ICONS: Record<string, string> = {
    back: '<path d="M19 12H5"></path><path d="M12 19l-7-7 7-7"></path>',
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><path d="M9 22V12h6v10"></path>',
    history: '<circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path>',
    organization: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>',
    settings: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.31.22.65.22 1H21a2 2 0 1 1 0 4h-.09c-.36 0-.7.08-1.01.22z"></path>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
    close: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
    wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"></path><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"></path><path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z"></path>',
    send: '<path d="M22 2 11 13"></path><path d="m22 2-7 20-4-9-9-4 20-7Z"></path>',
    receive: '<path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path>',
    refresh: '<path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"></path><path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14"></path>',
    alert: '<path d="M10.3 3.3 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>',
    check: '<path d="M20 6 9 17l-5-5"></path>',
    key: '<circle cx="7.5" cy="15.5" r="3.5"></circle><path d="M10.5 15.5H22"></path><path d="m18 12 4 4-4 4"></path>',
    globe: '<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18"></path><path d="M12 3a15 15 0 0 1 0 18"></path><path d="M12 3a15 15 0 0 0 0 18"></path>',
    shield: '<path d="M12 3 5 6v6c0 4.4 3 8.4 7 9 4-1.6 7-5.6 7-9V6l-7-3Z"></path><path d="m9 12 2 2 4-4"></path>',
    plus: '<path d="M12 5v14"></path><path d="M5 12h14"></path>',
    trash: '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle>',
};

export function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function escapeAttr(value: unknown): string {
    return escapeHtml(value).replace(/`/g, '&#96;');
}

export function safeImageSrc(value: unknown): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        const parsed = new URL(raw);
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return raw;
    } catch {
        // Fall through.
    }
    if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(raw)) return raw;
    return '';
}

export function icon(name: string, size = 18, className = ''): string {
    const body = ICONS[name] || ICONS.alert;
    const cls = className ? ` class="${escapeAttr(className)}"` : '';
    return `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function shortAddress(value: string, head = 10, tail = 6): string {
    const raw = String(value || '');
    if (!raw) return '--';
    if (raw.length <= head + tail + 3) return raw;
    return `${raw.slice(0, head)}...${raw.slice(-tail)}`;
}

export function coinLabel(type: number): string {
    return COIN_NAMES[type as keyof typeof COIN_NAMES] || 'PGC';
}

export function coinClass(typeOrLabel: number | string): string {
    const label = typeof typeOrLabel === 'number' ? coinLabel(typeOrLabel) : String(typeOrLabel || 'PGC');
    return label.toLowerCase();
}

export function renderCoinBadge(type: number, compact = false): string {
    const label = coinLabel(type);
    return `<span class="coin-badge coin-badge--${coinClass(label)} ${compact ? 'coin-badge--compact' : ''}">${escapeHtml(label)}</span>`;
}

export function renderStatusBadge(label: string, tone: UiTone = 'neutral'): string {
    return `<span class="status-badge status-badge--${tone}">${escapeHtml(label)}</span>`;
}

export function renderHeaderBar(options: {
    title: string;
    backPage?: PageName | '';
    logoUrl?: string;
    rightHtml?: string;
    className?: string;
}): string {
    const left = options.logoUrl
        ? `<div class="header-logo"><img src="${escapeAttr(options.logoUrl)}" alt="PanguPay" /><span>PanguPay</span></div>`
        : options.backPage
          ? `<button class="header-btn" type="button" data-nav="${escapeAttr(options.backPage)}" aria-label="Back">${icon('back', 20)}</button>`
          : '<div class="header-slot"></div>';
    const right = options.rightHtml || '<div class="header-slot"></div>';
    return `
      <header class="header ${options.className || ''}">
        <div class="header-side header-side--left">${left}</div>
        <div class="header-title">${escapeHtml(options.title)}</div>
        <div class="header-side header-side--right">${right}</div>
      </header>
    `;
}

export function renderBottomNav(active: PageName, language: Language = 'zh-CN'): string {
    const labels = NAV_LABELS[language] || NAV_LABELS['zh-CN'];
    const items: Array<{ page: PageName; iconName: string; label: string }> = [
        { page: 'home', iconName: 'home', label: labels.home },
        { page: 'history', iconName: 'history', label: labels.history },
        { page: 'organization', iconName: 'organization', label: labels.organization },
        { page: 'settings', iconName: 'settings', label: labels.settings },
    ];
    return `
      <nav class="bottom-nav" aria-label="Primary">
        ${items
            .map(
                (item) => `
          <button class="nav-item ${active === item.page ? 'active' : ''}" type="button" data-nav="${item.page}" aria-label="${escapeAttr(item.label)}">
            ${icon(item.iconName, 22)}
            <span>${escapeHtml(item.label)}</span>
          </button>`
            )
            .join('')}
      </nav>
    `;
}

export function renderCopyRow(label: string, value: string, copyHandler: string, extraClass = ''): string {
    return `
      <div class="copy-row ${extraClass}">
        <div class="copy-row-main">
          <div class="copy-row-label">${escapeHtml(label)}</div>
          <div class="copy-row-value">${escapeHtml(value || '--')}</div>
        </div>
        <button class="icon-btn icon-btn--outline" type="button" onclick="${copyHandler}" aria-label="${escapeAttr(label)}">
          ${icon('copy', 16)}
        </button>
      </div>
    `;
}

export function renderNotice(tone: UiTone, title: string, message: string): string {
    const iconName = tone === 'success' ? 'check' : tone === 'info' || tone === 'primary' ? 'shield' : 'alert';
    return `
      <div class="notice-card notice-card--${tone}">
        <div class="notice-card-icon">${icon(iconName, 16)}</div>
        <div class="notice-card-body">
          <div class="notice-card-title">${escapeHtml(title)}</div>
          <div class="notice-card-desc">${escapeHtml(message)}</div>
        </div>
      </div>
    `;
}

export function renderEmptyState(options: {
    title: string;
    description: string;
    iconName?: string;
    actionsHtml?: string;
    compact?: boolean;
}): string {
    return `
      <div class="empty-state ${options.compact ? 'empty-state--compact' : ''}">
        <div class="empty-icon">${icon(options.iconName || 'wallet', 44)}</div>
        <div class="empty-title">${escapeHtml(options.title)}</div>
        <div class="empty-desc">${escapeHtml(options.description)}</div>
        ${options.actionsHtml ? `<div class="empty-actions">${options.actionsHtml}</div>` : ''}
      </div>
    `;
}

export function renderDappSiteCard(options: {
    title: string;
    origin: string;
    iconUrl?: string;
    hint?: string;
    badge?: string;
}): string {
    const src = safeImageSrc(options.iconUrl);
    const iconHtml = src
        ? `<img src="${escapeAttr(src)}" alt="${escapeAttr(options.title || options.origin)}" />`
        : `<span>${icon('globe', 20)}</span>`;
    return `
      <div class="card dapp-site-card">
        <div class="dapp-site-info">
          <div class="dapp-site-icon">${iconHtml}</div>
          <div class="dapp-site-text">
            <div class="dapp-site-title" title="${escapeAttr(options.title)}">${escapeHtml(options.title || options.origin)}</div>
            <div class="dapp-site-origin" title="${escapeAttr(options.origin)}">${escapeHtml(options.origin)}</div>
          </div>
          ${options.badge ? `<div class="dapp-site-badge">${escapeHtml(options.badge)}</div>` : ''}
        </div>
        ${options.hint ? `<div class="dapp-site-hint">${escapeHtml(options.hint)}</div>` : ''}
      </div>
    `;
}

export function bindNavigation(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>('[data-nav]').forEach((node) => {
        const page = node.dataset.nav as PageName | undefined;
        if (!page) return;
        node.addEventListener('click', (event) => {
            event.preventDefault();
            (window as any).navigateTo?.(page);
        });
    });
}

