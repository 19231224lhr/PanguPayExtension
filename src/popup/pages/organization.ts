/**
 * 组织管理页面 - 加入/退出担保组织
 */

import {
    getActiveAccount,
    getOrganization,
    clearOrganization,
    saveOrganization,
    saveAccount,
    getOnboardingStep,
    setOnboardingStep,
    type OrganizationChoice,
} from '../../core/storage';
import {
    API_BASE_URL,
    API_ENDPOINTS,
    apiClient,
    buildAggrNodeUrl,
    buildApiUrl,
    buildAssignNodeUrl,
    getGroupInfo,
    getGroupList,
    type GroupListItem,
    type GroupListResponse,
} from '../../core/api';
import { registerAddressesOnMainEntry } from '../../core/address';
import { joinGuarantorGroup, leaveGuarantorGroup } from '../../core/group';
import { startTxStatusSync, stopTxStatusSync } from '../../core/txStatus';
import { getActiveLanguage } from '../utils/appSettings';
import { bindInlineHandlers } from '../utils/inlineHandlers';
import { bindNavigation, renderHeaderBar } from '../utils/ui';

interface UiGroup {
    groupId: string;
    groupName: string;
    assignNodeUrl: string;
    aggrNodeUrl: string;
    assignAPIEndpoint: string;
    aggrAPIEndpoint: string;
    pledgeAddress: string;
    memberCount: number;
}

interface GroupDetailInfo {
    groupId: string;
    groupName: string;
    assignNode: string;
    aggrNode: string;
    assignAPIEndpoint: string;
    aggrAPIEndpoint: string;
    pledgeAddress: string;
}

type OrgViewMode = 'list' | 'detail';
type OrgSearchState = 'empty' | 'loading' | 'result' | 'notfound';

let orgViewMode: OrgViewMode = 'list';
let orgSearchState: OrgSearchState = 'empty';
let orgSearchInput = '';
let orgSearchResult: GroupDetailInfo | null = null;

const TEXT = {
    'zh-CN': {
        header: '担保组织',
        tabList: '组织列表',
        tabDetail: '详情/搜索',
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
        myOrgTitle: '我的担保组织',
        myOrgEmptyTitle: '未加入担保组织',
        myOrgEmptyDesc: '加入担保组织可享受更安全的交易保障与更快确认',
        searchTitle: '查询担保组织',
        searchDesc: '输入 8 位组织编号查询详细信息',
        searchPlaceholder: '输入担保组织编号...',
        searchButton: '查询',
        searchEmptyTitle: '请输入组织编号',
        searchEmptyDesc: '查询结果将在这里展示',
        searchLoading: '正在查询组织信息...',
        searchNotFound: '未找到该担保组织',
        invalidOrgId: '请输入8位数字组织编号',
        detailGroupId: '组织 ID',
        detailAssignNode: 'Assign 节点',
        detailAggrNode: 'Aggre 节点',
        detailAssignApi: 'Assign API',
        detailAggrApi: 'Aggre API',
        detailPledge: '质押地址',
    },
    en: {
        header: 'Guarantor Organization',
        tabList: 'Organization List',
        tabDetail: 'Details/Search',
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
        myOrgTitle: 'My Organization',
        myOrgEmptyTitle: 'Not in organization',
        myOrgEmptyDesc: 'Join an organization to enjoy safer and faster transfers',
        searchTitle: 'Search Organization',
        searchDesc: 'Enter an 8-digit organization ID to search',
        searchPlaceholder: 'Enter organization ID...',
        searchButton: 'Search',
        searchEmptyTitle: 'Enter organization ID',
        searchEmptyDesc: 'Search results will appear here',
        searchLoading: 'Searching organization...',
        searchNotFound: 'Organization not found',
        invalidOrgId: 'Please enter an 8-digit organization ID',
        detailGroupId: 'Organization ID',
        detailAssignNode: 'Assign Node',
        detailAggrNode: 'Aggre Node',
        detailAssignApi: 'Assign API',
        detailAggrApi: 'Aggre API',
        detailPledge: 'Pledge Address',
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

function normalizeGroupDetail(groupId: string, raw: Record<string, any>): GroupDetailInfo {
    return {
        groupId: raw.GroupID || raw.group_id || raw.groupID || groupId,
        groupName: raw.GroupName || raw.group_name || raw.groupName || groupId,
        assignNode: raw.AssiID || raw.assignNode || raw.assign_node || '',
        aggrNode: raw.AggrID || raw.aggrNode || raw.aggr_node || '',
        assignAPIEndpoint: raw.AssignAPIEndpoint || raw.assign_api_endpoint || raw.assignAPIEndpoint || '',
        aggrAPIEndpoint: raw.AggrAPIEndpoint || raw.aggr_api_endpoint || raw.aggrAPIEndpoint || '',
        pledgeAddress: raw.PledgeAddress || raw.pledge_address || raw.pledgeAddress || '',
    };
}

function buildDetailFromOrg(org: OrganizationChoice): GroupDetailInfo {
    const assignEndpoint = org.assignAPIEndpoint || org.assignNodeUrl || '';
    const aggrEndpoint = org.aggrAPIEndpoint || org.aggrNodeUrl || '';
    const assignNodeUrl = assignEndpoint ? buildAssignNodeUrl(assignEndpoint) : org.assignNodeUrl;
    const aggrNodeUrl = aggrEndpoint ? buildAggrNodeUrl(aggrEndpoint) : org.aggrNodeUrl;
    return {
        groupId: org.groupId,
        groupName: org.groupName || org.groupId,
        assignNode: formatNodeAddress(assignNodeUrl || ''),
        aggrNode: formatNodeAddress(aggrNodeUrl || ''),
        assignAPIEndpoint: org.assignAPIEndpoint || org.assignNodeUrl || '',
        aggrAPIEndpoint: org.aggrAPIEndpoint || org.aggrNodeUrl || '',
        pledgeAddress: org.pledgeAddress || '',
    };
}

function renderDetailList(info: GroupDetailInfo, t: OrgText): string {
    const assignNode = info.assignNode || formatNodeAddress(info.assignAPIEndpoint);
    const aggrNode = info.aggrNode || formatNodeAddress(info.aggrAPIEndpoint);
    const items = [
        { label: t.detailGroupId, value: info.groupId || '--' },
        { label: t.detailAssignNode, value: assignNode || '--' },
        { label: t.detailAggrNode, value: aggrNode || '--' },
        { label: t.detailAssignApi, value: info.assignAPIEndpoint || '--' },
        { label: t.detailAggrApi, value: info.aggrAPIEndpoint || '--' },
        { label: t.detailPledge, value: info.pledgeAddress || '--' },
    ];

    return `
      <div class="org-node-list">
        ${items
            .map(
                (item) => `
          <div class="org-node-item">
            <span class="org-node-label">${item.label}</span>
            <span class="org-node-value">${item.value}</span>
          </div>
        `
            )
            .join('')}
      </div>
    `;
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
        <div class="card onboarding-card org-onboarding">
          <div class="org-onboarding-title">${t.stepTitle}</div>
          <div class="org-onboarding-desc">${t.stepDesc}</div>
        </div>
        `
        : '';
    const footerBlock = isOnboarding
        ? `
      <div class="onboarding-actions">
        <button class="btn btn-secondary btn-block" onclick="skipOnboarding()">
          ${t.skip}
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
                    const assignEndpoint =
                        (group as any).assign_api_endpoint || (group as any).assignNodeUrl || '';
                    const aggrEndpoint =
                        (group as any).aggr_api_endpoint || (group as any).aggrNodeUrl || '';
                    return {
                        groupId,
                        groupName,
                        assignAPIEndpoint: assignEndpoint,
                        aggrAPIEndpoint: aggrEndpoint,
                        assignNodeUrl: assignEndpoint ? buildAssignNodeUrl(assignEndpoint) : '',
                        aggrNodeUrl: aggrEndpoint ? buildAggrNodeUrl(aggrEndpoint) : '',
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

    const myOrgDetail = currentOrg ? buildDetailFromOrg(currentOrg) : null;
    const searchDisabled = !/^\d{8}$/.test(orgSearchInput);
    let searchStateBlock = '';

    if (orgSearchState === 'loading') {
        searchStateBlock = `
          <div class="loading-container org-loading-container">
            <div class="loading-spinner"></div>
            <div>${t.searchLoading}</div>
          </div>
        `;
    } else if (orgSearchState === 'result' && orgSearchResult) {
        searchStateBlock = `
          <div class="org-card">
            <div class="org-card-top">
              <div class="org-card-info">
                <div class="org-name">${orgSearchResult.groupName}</div>
                <div class="org-id">ID ${orgSearchResult.groupId}</div>
              </div>
            </div>
            ${renderDetailList(orgSearchResult, t)}
          </div>
        `;
    } else if (orgSearchState === 'notfound') {
        searchStateBlock = `
          <div class="empty-state empty-state--compact">
            <div class="empty-title">${t.searchNotFound}</div>
            <div class="empty-desc">${t.searchDesc}</div>
          </div>
        `;
    } else {
        searchStateBlock = `
          <div class="empty-state empty-state--compact">
            <div class="empty-title">${t.searchEmptyTitle}</div>
            <div class="empty-desc">${t.searchEmptyDesc}</div>
          </div>
        `;
    }

    app.innerHTML = `
    <div class="page">
      ${renderHeaderBar({ title: t.header, backPage: isOnboarding ? 'walletManager' : 'home' })}
      
      <div class="page-content">
        ${onboardingBanner}
        <div class="org-tabs" data-active="${orgViewMode}">
          <button class="org-tab ${orgViewMode === 'list' ? 'org-tab--active' : ''}" onclick="switchOrgView('list')">
            ${t.tabList}
          </button>
          <button class="org-tab ${orgViewMode === 'detail' ? 'org-tab--active' : ''}" onclick="switchOrgView('detail')">
            ${t.tabDetail}
          </button>
        </div>

        <div class="org-pane ${orgViewMode === 'list' ? 'is-active' : ''}">
          <div class="org-status-card">
            <div class="org-status-main">
              <div class="org-status-icon ${currentOrg ? 'org-status-icon--joined' : 'org-status-icon--empty'}">
                ${currentOrg ? '✓' : 'ORG'}
              </div>
              <div class="org-status-text">
                <div class="org-status-title">${currentOrg ? currentOrg.groupName : t.notJoined}</div>
                <div class="org-status-desc">${currentOrg ? t.joinedDesc : t.notJoinedDesc}</div>
              </div>
            </div>
            ${currentOrg ? `
            <button class="btn btn-ghost btn-sm org-status-action" onclick="leaveOrganization()">
              ${t.leave}
            </button>
            ` : ''}
          </div>

          <div class="list-section org-list-section">
            <div class="org-section-title">${t.available}</div>
            
            ${groups.length ? groups.map(group => `
              <div class="org-card ${currentOrg?.groupId === group.groupId ? 'active' : ''}">
                <div class="org-card-top">
                  <div class="org-card-info">
                    <div class="org-name">
                      ${group.groupName}
                      ${currentOrg?.groupId === group.groupId ? `<span class="org-badge">${t.joined}</span>` : ''}
                    </div>
                    <div class="org-id">ID ${group.groupId}</div>
                  </div>
                  <div class="org-card-actions">
                    ${currentOrg?.groupId !== group.groupId ? `
                    <button class="btn btn-primary btn-sm" onclick="joinOrganization('${group.groupId}', '${group.groupName}', '${group.assignAPIEndpoint}', '${group.aggrAPIEndpoint}', '${group.pledgeAddress}')">
                      ${t.join}
                    </button>
                    ` : ''}
                  </div>
                </div>
                <div class="org-node-list">
                  <div class="org-node-item">
                    <span class="org-node-label">${t.assignIp}</span>
                    <span class="org-node-value">${formatNodeAddress(group.assignNodeUrl)}</span>
                  </div>
                  <div class="org-node-item">
                    <span class="org-node-label">${t.aggrIp}</span>
                    <span class="org-node-value">${formatNodeAddress(group.aggrNodeUrl)}</span>
                  </div>
                </div>
              </div>
            `).join('') : `
              <div class="empty-state empty-state--compact">
                <div class="empty-title">${t.emptyTitle}</div>
                <div class="empty-desc">${groupLoadError || t.emptyDesc}</div>
              </div>
            `}
          </div>

          <div class="org-info-card">
            <div class="org-info-title">${t.infoTitle}</div>
            <ul class="org-info-list">
              <li>${t.info1}</li>
              <li>${t.info2}</li>
              <li>${t.info3}</li>
            </ul>
          </div>
        </div>

        <div class="org-pane ${orgViewMode === 'detail' ? 'is-active' : ''}">
          <div class="org-section-title">${t.myOrgTitle}</div>
          ${myOrgDetail ? `
            <div class="org-card">
              <div class="org-card-top">
                <div class="org-card-info">
                  <div class="org-name">${myOrgDetail.groupName}</div>
                  <div class="org-id">ID ${myOrgDetail.groupId}</div>
                </div>
                <div class="org-card-actions">
                  <button class="btn btn-ghost btn-sm org-status-action" onclick="leaveOrganization()">
                    ${t.leave}
                  </button>
                </div>
              </div>
              ${renderDetailList(myOrgDetail, t)}
            </div>
          ` : `
            <div class="empty-state empty-state--compact">
              <div class="empty-title">${t.myOrgEmptyTitle}</div>
              <div class="empty-desc">${t.myOrgEmptyDesc}</div>
            </div>
          `}

          <div class="org-section-title org-section-title--spaced">${t.searchTitle}</div>
          <div class="org-search-card">
            <div class="org-search-desc">${t.searchDesc}</div>
            <div class="org-search-row">
              <input class="input org-search-input" id="orgSearchInput" value="${orgSearchInput}" placeholder="${t.searchPlaceholder}">
              <button class="btn btn-primary btn-sm" id="orgSearchBtn" onclick="handleOrgSearch()" ${searchDisabled ? 'disabled' : ''}>
                ${t.searchButton}
              </button>
            </div>
          </div>
          <div class="org-search-result">
            ${searchStateBlock}
          </div>
        </div>
      </div>

      ${footerBlock}
    </div>
  `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
        joinOrganization,
        leaveOrganization,
        switchOrgView,
        handleOrgSearchInput,
        handleOrgSearch,
        skipOnboarding,
        completeOnboarding,
    });
    bindNavigation(app);

    const searchInputEl = document.getElementById('orgSearchInput') as HTMLInputElement | null;
    if (searchInputEl) {
        searchInputEl.addEventListener('input', handleOrgSearchInput);
        searchInputEl.addEventListener('change', handleOrgSearchInput);
    }
}

function switchOrgView(mode: OrgViewMode): void {
    if (orgViewMode === mode) return;
    orgViewMode = mode;
    renderOrganization();
}

function handleOrgSearchInput(): void {
    const input = document.getElementById('orgSearchInput') as HTMLInputElement | null;
    if (!input) return;
    let value = input.value || '';
    const digitsOnly = value.replace(/\D/g, '').slice(0, 8);
    if (digitsOnly !== value) {
        input.value = digitsOnly;
        value = digitsOnly;
    }
    orgSearchInput = value;
    const button = document.getElementById('orgSearchBtn') as HTMLButtonElement | null;
    if (button) {
        button.disabled = !/^\d{8}$/.test(value);
    }
    if (!value) {
        orgSearchState = 'empty';
        orgSearchResult = null;
        renderOrganization();
    }
}

async function handleOrgSearch(): Promise<void> {
    const t = getText();
    const groupId = orgSearchInput.trim();
    if (!/^\d{8}$/.test(groupId)) {
        (window as any).showToast(t.invalidOrgId, 'info');
        return;
    }

    orgSearchState = 'loading';
    orgSearchResult = null;
    renderOrganization();

    try {
        const account = await getActiveAccount();
        const currentOrg = account ? await getOrganization(account.accountId) : null;
        let payload: Record<string, any> | null = null;

        if (currentOrg?.groupId) {
            const endpoint = currentOrg.assignAPIEndpoint || currentOrg.assignNodeUrl || '';
            const base = endpoint ? buildAssignNodeUrl(endpoint) : API_BASE_URL;
            const url = buildApiUrl(
                base,
                `${API_ENDPOINTS.ASSIGN_GROUP_INFO(currentOrg.groupId)}?groupId=${encodeURIComponent(groupId)}`
            );
            try {
                const data = await apiClient.get<any>(url, { timeout: 5000, retries: 0, silent: true });
                payload = data?.group_msg || data?.GroupMsg || data?.data || data;
            } catch (error) {
                console.warn('[组织查询] AssignNode 查询失败，改用 BootNode:', error);
            }
        }

        if (!payload) {
            const result = await getGroupInfo(groupId);
            if (!result.success || !result.data) {
                orgSearchState = 'notfound';
                renderOrganization();
                return;
            }
            payload = (result.data as any)?.group_msg || (result.data as any)?.data || result.data;
        }

        if (!payload) {
            orgSearchState = 'notfound';
            renderOrganization();
            return;
        }

        orgSearchResult = normalizeGroupDetail(groupId, payload as Record<string, any>);
        orgSearchState = 'result';
        renderOrganization();
    } catch (error) {
        console.error('[组织查询] 失败:', error);
        orgSearchState = 'notfound';
        renderOrganization();
    }
}

async function joinOrganization(
    groupId: string,
    groupName: string,
    assignAPIEndpoint: string,
    aggrAPIEndpoint: string,
    pledgeAddress: string
) {
    const t = getText();
    const account = await getActiveAccount();
    if (!account) return;
    const step = await getOnboardingStep(account.accountId);
    const wasOnboarding = step === 'organization';

    const assignNodeUrl = assignAPIEndpoint ? buildAssignNodeUrl(assignAPIEndpoint) : '';
    const aggrNodeUrl = aggrAPIEndpoint ? buildAggrNodeUrl(aggrAPIEndpoint) : '';
    const org: OrganizationChoice = {
        groupId,
        groupName,
        assignNodeUrl,
        aggrNodeUrl,
        assignAPIEndpoint,
        aggrAPIEndpoint,
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
        await registerAddressesOnMainEntry(account);
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
    account.mainAddressRegistered = false;
    await saveAccount(account);
    stopTxStatusSync();
    await registerAddressesOnMainEntry(account);
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
