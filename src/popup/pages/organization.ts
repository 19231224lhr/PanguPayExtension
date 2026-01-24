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
import { bindInlineHandlers } from '../utils/inlineHandlers';

interface UiGroup {
    groupId: string;
    groupName: string;
    assignNodeUrl: string;
    aggrNodeUrl: string;
    pledgeAddress: string;
    memberCount: number;
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
          <div style="font-weight: 600; margin-bottom: 6px;">步骤 4 / 4 · 选择担保组织</div>
          <div style="font-size: 12px; color: var(--text-secondary);">
            加入组织可使用快速转账；也可暂不加入，稍后在设置中修改
          </div>
        </div>
        `
        : '';
    const footerBlock = isOnboarding
        ? `
      <div class="onboarding-actions">
        <button class="btn btn-secondary btn-block" onclick="skipOnboarding()">
          暂不加入
        </button>
        <button class="btn btn-primary btn-block" onclick="completeOnboarding()">
          进入主界面
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
          <span>首页</span>
        </button>
        <button class="nav-item" onclick="navigateTo('history')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <span>历史</span>
        </button>
        <button class="nav-item active" onclick="navigateTo('organization')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="9" cy="7" r="4"></circle>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path>
          </svg>
          <span>组织</span>
        </button>
        <button class="nav-item" onclick="navigateTo('settings')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>
          </svg>
          <span>设置</span>
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
            groupLoadError = result.error || '组织列表获取失败，请稍后重试';
        }
    } catch (error) {
        groupLoadError = '组织列表获取失败，请稍后重试';
    }

    app.innerHTML = `
    <div class="page">
      <header class="header">
        <button class="header-btn" onclick="navigateTo('${isOnboarding ? 'walletManager' : 'home'}')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <span style="font-weight: 600;">担保组织</span>
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
                ${currentOrg ? currentOrg.groupName : '未加入组织'}
              </div>
              <div style="font-size: 12px; color: var(--text-muted);">
                ${currentOrg ? '享受快速转账服务' : '加入组织以启用快速转账'}
              </div>
            </div>
            ${currentOrg ? `
            <button class="btn btn-ghost btn-sm" onclick="leaveOrganization()" style="color: var(--error);">
              退出
            </button>
            ` : ''}
          </div>
        </div>

        <!-- 组织列表 -->
        <div class="list-section">
          <div class="list-title">可用担保组织</div>
          
          ${groups.length ? groups.map(group => `
            <div class="org-card ${currentOrg?.groupId === group.groupId ? 'active' : ''}">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                <div>
                  <div class="org-name">
                    ${group.groupName}
                    ${currentOrg?.groupId === group.groupId ? '<span class="org-badge">已加入</span>' : ''}
                  </div>
                  <div class="org-info">ID: ${group.groupId}</div>
                </div>
                ${currentOrg?.groupId !== group.groupId ? `
                <button class="btn btn-primary btn-sm" onclick="joinOrganization('${group.groupId}', '${group.groupName}', '${group.assignNodeUrl}', '${group.aggrNodeUrl}', '${group.pledgeAddress}')">
                  加入
                </button>
                ` : ''}
              </div>
              <div class="org-node-meta">
                <span>Assign 节点IP: ${formatNodeAddress(group.assignNodeUrl)}</span>
                <span>Aggre 节点IP: ${formatNodeAddress(group.aggrNodeUrl)}</span>
              </div>
            </div>
          `).join('') : `
            <div class="empty-state" style="padding: 24px 12px;">
              <div class="empty-title">暂无组织数据</div>
              <div class="empty-desc">${groupLoadError || '请检查网络或稍后重试'}</div>
            </div>
          `}
        </div>

        <!-- 说明 -->
        <div class="card" style="margin-top: 16px;">
          <div style="font-size: 13px; font-weight: 500; margin-bottom: 8px;">💡 关于担保组织</div>
          <ul style="font-size: 12px; color: var(--text-secondary); padding-left: 16px; margin: 0;">
            <li style="margin-bottom: 4px;">加入担保组织后可使用快速转账</li>
            <li style="margin-bottom: 4px;">转账即时到账，无需等待区块确认</li>
            <li>组织会收取少量服务费</li>
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

    (window as any).showToast('正在加入担保组织...', 'info');
    const result = await joinGuarantorGroup(account, org);
    if (!result.success) {
        (window as any).showToast(result.error || '加入担保组织失败', 'error');
        return;
    }

    const finalOrg = result.org || org;
    await saveOrganization(account.accountId, finalOrg);
    (window as any).showToast(`已加入 ${finalOrg.groupName || groupName}`, 'success');
    void startTxStatusSync(account.accountId);

    if (wasOnboarding) {
        await setOnboardingStep(account.accountId, 'complete');
        (window as any).navigateTo('home');
        return;
    }

    renderOrganization();
}

async function leaveOrganization(): Promise<void> {
    const account = await getActiveAccount();
    if (!account) return;

    const currentOrg = await getOrganization(account.accountId);
    if (!currentOrg) return;

    (window as any).showToast('正在退出担保组织...', 'info');
    const result = await leaveGuarantorGroup(account, currentOrg);
    if (!result.success) {
        (window as any).showToast(result.error || '退出担保组织失败', 'error');
        return;
    }

    await clearOrganization(account.accountId);
    stopTxStatusSync();
    (window as any).showToast('已退出组织', 'info');
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
