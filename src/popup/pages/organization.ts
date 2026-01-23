/**
 * 组织管理页面 - 加入/退出担保组织
 */

import {
    getActiveAccount,
    getOrganization,
    saveOrganization,
    getOnboardingStep,
    setOnboardingStep,
    type OrganizationChoice,
} from '../../core/storage';
import { getGroupList, type GroupInfo } from '../../core/api';
import { bindInlineHandlers } from '../utils/inlineHandlers';

// 模拟组织列表数据
const mockGroups: GroupInfo[] = [
    {
        groupId: '10000000',
        groupName: '默认担保组织',
        assignNodeUrl: 'http://127.0.0.1:3002',
        aggrNodeUrl: 'http://127.0.0.1:3003',
        pledgeAddress: '5bd548d76dcb3f9db1d213db01464406bef5dd09',
        memberCount: 156,
    },
    {
        groupId: '20000000',
        groupName: '高性能担保组',
        assignNodeUrl: 'http://127.0.0.1:3004',
        aggrNodeUrl: 'http://127.0.0.1:3005',
        pledgeAddress: '6cd659e87edc4g0ec2e324ec12575517cef6ee1a',
        memberCount: 89,
    },
];

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

    // 尝试获取真实组织列表，失败则使用模拟数据
    let groups = mockGroups;
    try {
        const result = await getGroupList();
        if (result.success && result.data) {
            groups = result.data;
        }
    } catch (error) {
        console.log('[组织] 使用模拟数据');
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
          
          ${groups.map(group => `
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
              <div style="display: flex; gap: 16px; font-size: 12px; color: var(--text-muted);">
                <span>成员: ${group.memberCount}</span>
                <span>节点: 在线</span>
              </div>
            </div>
          `).join('')}
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

    await saveOrganization(account.accountId, org);
    (window as any).showToast(`已加入 ${groupName}`, 'success');

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

    // 清除组织信息（通过保存空组织）
    await saveOrganization(account.accountId, {
        groupId: '',
        groupName: '',
        assignNodeUrl: '',
        aggrNodeUrl: '',
        pledgeAddress: '',
    });

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
