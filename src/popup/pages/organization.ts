/**
 * 组织管理页面 - 加入/退出担保组织
 */

import {
    getActiveAccount,
    getOrganization,
    clearOrganization,
    saveOrganization,
    getOnboardingStep,
    setOnboardingStep,
    type OrganizationChoice,
} from '../../core/storage';
import { buildNodeUrl, getGroupList, type GroupListItem, type GroupListResponse } from '../../core/api';
import { joinGuarantorGroup, leaveGuarantorGroup } from '../../core/group';
import { startTxStatusSync, stopTxStatusSync } from '../../core/txStatus';
import { getActiveLanguage } from '../utils/appSettings';
import { bindInlineHandlers } from '../utils/inlineHandlers';

interface UiGroup {
    groupId: string;
    groupName: string;
    assignNodeUrl: string;
    aggrNodeUrl: string;
    pledgeAddress: string;
    memberCount: number;
}

const TEXT = {
    'zh-CN': {
        header: '担保组织',
        stepTitle: '步骤 4 / 4 · 选择担保组织',
        stepDesc: '加入组织可使用快速转账；也可暂不加入，稍后在设置中修改',
        skip: '暂不加入',
        enter: '进入主界面',
        navHome: '首页',
        navHistory: '历史',
        navOrg: '组织',
        navSettings: '设置',
        notJoined: '未加入组织',
        joinedDesc: '享受快速转账服务',
        notJoinedDesc: '加入组织以启用快速转账',
        leave: '退出',
        available: '可用担保组织',
        joined: '已加入',
        join: '加入',
        assignIp: 'Assign 节点IP',
        aggrIp: 'Aggre 节点IP',
        emptyTitle: '暂无组织数据',
        emptyDesc: '请检查网络或稍后重试',
        infoTitle: '💡 关于担保组织',
        info1: '加入担保组织后可使用快速转账',
        info2: '转账即时到账，无需等待区块确认',
        info3: '组织会收取少量服务费',
        groupLoadError: '组织列表获取失败，请稍后重试',
        toastJoin: '正在加入担保组织...',
        toastJoinFail: '加入担保组织失败',
        toastJoined: (name: string) => `已加入 ${name}`,
        toastLeave: '正在退出担保组织...',
        toastLeaveFail: '退出担保组织失败',
        toastLeft: '已退出组织',
    },
    en: {
        header: 'Guarantor Organization',
        stepTitle: 'Step 4 / 4 · Choose Organization',
        stepDesc: 'Join to enable fast transfers; you can skip and change later in settings',
        skip: 'Skip for now',
        enter: 'Enter Home',
        navHome: 'Home',
        navHistory: 'History',
        navOrg: 'Org',
        navSettings: 'Settings',
        notJoined: 'Not in organization',
        joinedDesc: 'Fast transfers enabled',
        notJoinedDesc: 'Join to enable fast transfers',
        leave: 'Leave',
        available: 'Available Organizations',
        joined: 'Joined',
        join: 'Join',
        assignIp: 'Assign Node IP',
        aggrIp: 'Aggr Node IP',
        emptyTitle: 'No organization data',
        emptyDesc: 'Check network or try again later',
        infoTitle: '💡 About guarantor organizations',
        info1: 'Join to use fast transfers',
        info2: 'Transfers settle instantly without block confirmation',
        info3: 'A small service fee may apply',
        groupLoadError: 'Failed to load organizations, please try again',
        toastJoin: 'Joining organization...',
        toastJoinFail: 'Failed to join organization',
        toastJoined: (name: string) => `Joined ${name}`,
        toastLeave: 'Leaving organization...',
        toastLeaveFail: 'Failed to leave organization',
        toastLeft: 'Left organization',
    },
};

type OrgText = (typeof TEXT)['zh-CN'];

function getText(): OrgText {
    return getActiveLanguage() === 'en' ? TEXT.en : TEXT['zh-CN'];
}

function formatNodeAddress(url: string): string {
    const raw = String(url || '').trim();
    if (!raw) return '--';
    try {
        const parsed = new URL(raw);
        const port = parsed.port ? `:${parsed.port}` : '';
        return `${parsed.hostname}${port}`;
    } catch {
        return raw.replace(/^https?:\/\//, '').replace(/\/$/, '');
    }
}

export async function renderOrganization(): Promise<void> {
    const app = document.getElementById('app');
    if (!app) return;

    const t = getText();

    const account = await getActiveAccount();
    if (!account) {
        (window as any).navigateTo('home');
        return;
    }

    const currentOrg = await getOrganization(account.accountId);
    const step = await getOnboardingStep(account.accountId);
    const isOnboarding = step === 'organization';
    const onboardingBanner = isOnboarding
        ? `
        <div class="card onboarding-card" style="margin-bottom: 16px;">
          <div style="font-weight: 600; margin-bottom: 6px;">${t.stepTitle}</div>
          <div style="font-size: 12px; color: var(--text-secondary);">
            ${t.stepDesc}
          </div>
        </div>
        `
        : '';
    const footerBlock = isOnboarding
        ? `
      <div class="onboarding-actions">
        <button class="btn btn-secondary btn-block" onclick="skipOnboarding()">
          ${t.skip}
        </button>
        <button class="btn btn-primary btn-block" onclick="completeOnboarding()">
          ${t.enter}
        </button>
      </div>
      `
        : `
      <!-- 底部导航 -->
      <nav class="bottom-nav">
        <button class="nav-item" onclick="navigateTo('home')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
            <polyline points="9 22 9 12 15 12 15 22"></polyline>
          </svg>
          <span>${t.navHome}</span>
        </button>
        <button class="nav-item" onclick="navigateTo('history')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <span>${t.navHistory}</span>
        </button>
        <button class="nav-item active" onclick="navigateTo('organization')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="9" cy="7" r="4"></circle>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path>
          </svg>
          <span>${t.navOrg}</span>
        </button>
        <button class="nav-item" onclick="navigateTo('settings')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
          <span>${t.navSettings}</span>
        </button>
      </nav>
      `;

    // 获取真实组织列表
    let groups: UiGroup[] = [];
    let groupLoadError = '';
    try {
        const result = await getGroupList();
        if (result.success && result.data) {
            const payload = result.data as GroupListResponse | GroupListItem[];
            const rawGroups = Array.isArray(payload) ? payload : payload.groups || [];
            groups = rawGroups
                .map((group) => {
                    const groupId = (group as GroupListItem).group_id || (group as any).groupId || '';
                    if (!groupId) return null;
                    const groupName = (group as any).group_name || (group as any).groupName || groupId;
                    const assignEndpoint = (group as any).assign_api_endpoint || (group as any).assignNodeUrl || '';
                    const aggrEndpoint = (group as any).aggr_api_endpoint || (group as any).aggrNodeUrl || '';
                    return {
                        groupId,
                        groupName,
                        assignNodeUrl: assignEndpoint ? buildNodeUrl(assignEndpoint) : '',
                        aggrNodeUrl: aggrEndpoint ? buildNodeUrl(aggrEndpoint) : '',
                        pledgeAddress: (group as any).pledge_address || (group as any).pledgeAddress || '',
                        memberCount: (group as any).member_count || (group as any).memberCount || 0,
                    } as UiGroup;
                })
                .filter((item): item is UiGroup => !!item);
        } else {
            groupLoadError = result.error || t.groupLoadError;
        }
    } catch (error) {
        groupLoadError = t.groupLoadError;
    }

    app.innerHTML = `
    <div class="page">
      <header class="header">
        <button class="header-btn" onclick="navigateTo('${isOnboarding ? 'walletManager' : 'home'}')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <span style="font-weight: 600;">${t.header}</span>
        <div style="width: 32px;"></div>
      </header>
      
      <div class="page-content">
        ${onboardingBanner}
        <!-- 当前组织状态 -->
        <div class="card" style="margin-bottom: 20px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="
              width: 48px;
              height: 48px;
              background: ${currentOrg ? 'linear-gradient(135deg, var(--success), #34d399)' : 'var(--bg-input)'};
              border-radius: 12px;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 24px;
            ">
              ${currentOrg ? '✓' : '👥'}
            </div>
            <div style="flex: 1;">
              <div style="font-weight: 600; margin-bottom: 2px;">
                ${currentOrg ? currentOrg.groupName : t.notJoined}
              </div>
              <div style="font-size: 12px; color: var(--text-muted);">
                ${currentOrg ? t.joinedDesc : t.notJoinedDesc}
              </div>
            </div>
            ${currentOrg ? `
            <button class="btn btn-ghost btn-sm" onclick="leaveOrganization()" style="color: var(--error);">
              ${t.leave}
            </button>
            ` : ''}
          </div>
        </div>

        <!-- 组织列表 -->
        <div class="list-section">
          <div class="list-title">${t.available}</div>
          
          ${groups.length ? groups.map(group => `
            <div class="org-card ${currentOrg?.groupId === group.groupId ? 'active' : ''}">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                <div>
                  <div class="org-name">
                    ${group.groupName}
                    ${currentOrg?.groupId === group.groupId ? `<span class="org-badge">${t.joined}</span>` : ''}
                  </div>
                  <div class="org-info">ID: ${group.groupId}</div>
                </div>
                ${currentOrg?.groupId !== group.groupId ? `
                <button class="btn btn-primary btn-sm" onclick="joinOrganization('${group.groupId}', '${group.groupName}', '${group.assignNodeUrl}', '${group.aggrNodeUrl}', '${group.pledgeAddress}')">
                  ${t.join}
                </button>
                ` : ''}
              </div>
              <div class="org-node-meta">
                <span>${t.assignIp}: ${formatNodeAddress(group.assignNodeUrl)}</span>
                <span>${t.aggrIp}: ${formatNodeAddress(group.aggrNodeUrl)}</span>
              </div>
            </div>
          `).join('') : `
            <div class="empty-state" style="padding: 24px 12px;">
              <div class="empty-title">${t.emptyTitle}</div>
              <div class="empty-desc">${groupLoadError || t.emptyDesc}</div>
            </div>
          `}
        </div>

        <!-- 说明 -->
        <div class="card" style="margin-top: 16px;">
          <div style="font-size: 13px; font-weight: 500; margin-bottom: 8px;">${t.infoTitle}</div>
          <ul style="font-size: 12px; color: var(--text-secondary); padding-left: 16px; margin: 0;">
            <li style="margin-bottom: 4px;">${t.info1}</li>
            <li style="margin-bottom: 4px;">${t.info2}</li>
            <li>${t.info3}</li>
          </ul>
        </div>
      </div>

      ${footerBlock}
    </div>
  `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
        joinOrganization,
        leaveOrganization,
        skipOnboarding,
        completeOnboarding,
    });
}

async function joinOrganization(
    groupId: string,
    groupName: string,
    assignNodeUrl: string,
    aggrNodeUrl: string,
    pledgeAddress: string
) {
    const t = getText();
    const account = await getActiveAccount();
    if (!account) return;
    const step = await getOnboardingStep(account.accountId);
    const wasOnboarding = step === 'organization';

    const org: OrganizationChoice = {
        groupId,
        groupName,
        assignNodeUrl,
        aggrNodeUrl,
        pledgeAddress,
    };

    (window as any).showToast(t.toastJoin, 'info');
    const result = await joinGuarantorGroup(account, org);
    if (!result.success) {
        (window as any).showToast(result.error || t.toastJoinFail, 'error');
        return;
    }

    const finalOrg = result.org || org;
    await saveOrganization(account.accountId, finalOrg);
    (window as any).showToast(t.toastJoined(finalOrg.groupName || groupName), 'success');
    void startTxStatusSync(account.accountId);

    if (wasOnboarding) {
        await setOnboardingStep(account.accountId, 'complete');
        (window as any).navigateTo('home');
        return;
    }

    renderOrganization();
}

async function leaveOrganization(): Promise<void> {
    const t = getText();
    const account = await getActiveAccount();
    if (!account) return;

    const currentOrg = await getOrganization(account.accountId);
    if (!currentOrg) return;

    (window as any).showToast(t.toastLeave, 'info');
    const result = await leaveGuarantorGroup(account, currentOrg);
    if (!result.success) {
        (window as any).showToast(result.error || t.toastLeaveFail, 'error');
        return;
    }

    await clearOrganization(account.accountId);
    stopTxStatusSync();
    (window as any).showToast(t.toastLeft, 'info');
    renderOrganization();
}

async function skipOnboarding(): Promise<void> {
    const account = await getActiveAccount();
    if (!account) return;
    await setOnboardingStep(account.accountId, 'complete');
    (window as any).navigateTo('home');
}

async function completeOnboarding(): Promise<void> {
    const account = await getActiveAccount();
    if (!account) return;
    await setOnboardingStep(account.accountId, 'complete');
    (window as any).navigateTo('home');
}
