/**
 * 接收页面 - 显示收款地址和二维码
 */

import { getActiveAccount } from '../../core/storage';
import { bindInlineHandlers } from '../utils/inlineHandlers';

export async function renderReceive(): Promise<void> {
    const app = document.getElementById('app');
    if (!app) return;

    const account = await getActiveAccount();
    if (!account) {
        (window as any).navigateTo('home');
        return;
    }

    // 生成简单的文本二维码占位符（实际可用 QRCode 库生成）
    const address = account.mainAddress;

    app.innerHTML = `
    <div class="page">
      <header class="header">
        <button class="header-btn" onclick="navigateTo('home')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <span style="font-weight: 600;">接收</span>
        <div style="width: 32px;"></div>
      </header>
      
      <div class="page-content" style="text-align: center;">
        <!-- 二维码区域 -->
        <div class="card" style="padding: 24px; margin-bottom: 20px;">
          <div id="qrcode" style="
            width: 180px;
            height: 180px;
            margin: 0 auto 16px;
            background: white;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #333;
            font-size: 12px;
          ">
            <div style="text-align: center;">
              <div style="font-size: 48px; margin-bottom: 8px;">📱</div>
              <div>扫码支付</div>
            </div>
          </div>
          
          <div style="font-size: 14px; font-weight: 600; margin-bottom: 4px;">
            我的钱包地址
          </div>
          <div style="font-size: 11px; color: var(--text-secondary);">
            向他人分享此地址以接收资产
          </div>
        </div>

        <!-- 地址显示 -->
        <div class="card" style="margin-bottom: 20px;">
          <div style="
            font-family: monospace;
            font-size: 12px;
            word-break: break-all;
            padding: 12px;
            background: var(--bg-input);
            border-radius: 8px;
            margin-bottom: 12px;
          ">
            ${address}
          </div>
          
          <button class="btn btn-primary btn-block" onclick="copyReceiveAddress('${address}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            复制地址
          </button>
        </div>

        <!-- 支持的币种 -->
        <div class="card">
          <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 12px;">
            此地址支持接收
          </div>
          <div style="display: flex; justify-content: center; gap: 16px;">
            <div style="text-align: center;">
              <div style="
                width: 40px;
                height: 40px;
                margin: 0 auto 4px;
                background: linear-gradient(135deg, #4a6cf7, #6b8cff);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-size: 12px;
                font-weight: 700;
              ">PGC</div>
              <span style="font-size: 11px; color: var(--text-muted);">盘古币</span>
            </div>
            <div style="text-align: center;">
              <div style="
                width: 40px;
                height: 40px;
                margin: 0 auto 4px;
                background: linear-gradient(135deg, #f7931a, #ffb347);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-size: 12px;
                font-weight: 700;
              ">BTC</div>
              <span style="font-size: 11px; color: var(--text-muted);">比特币</span>
            </div>
            <div style="text-align: center;">
              <div style="
                width: 40px;
                height: 40px;
                margin: 0 auto 4px;
                background: linear-gradient(135deg, #627eea, #8fa8ff);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-size: 12px;
                font-weight: 700;
              ">ETH</div>
              <span style="font-size: 11px; color: var(--text-muted);">以太坊</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

    bindInlineHandlers(app, {
        navigateTo: (page: string) => (window as any).navigateTo(page),
        copyReceiveAddress,
    });

    // 尝试生成二维码
    try {
        const QRCode = (await import('qrcode')).default;
        const canvas = document.createElement('canvas');
        await QRCode.toCanvas(canvas, address, {
            width: 180,
            margin: 2,
            color: {
                dark: '#1d4ed8',
                light: '#ffffff',
            },
        });
        const qrContainer = document.getElementById('qrcode');
        if (qrContainer) {
            qrContainer.innerHTML = '';
            qrContainer.appendChild(canvas);
        }
    } catch (error) {
        console.log('[接收] 二维码生成失败，使用占位符');
    }
}

function copyReceiveAddress(address: string): void {
    navigator.clipboard.writeText(address).then(() => {
        (window as any).showToast('地址已复制到剪贴板', 'success');
    });
}
