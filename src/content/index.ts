/**
 * Content Script
 * 
 * 注入到网页中，提供 window.pangu API
 */

// 注入 inject.js 脚本到页面
function injectScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('src/content/inject.js');
    script.type = 'module';
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
}

// 在 document_start 时注入
injectScript();

// 监听来自页面的消息
window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (!event.data || !event.data.type) return;
    if (!event.data.type.startsWith('PANGU_')) return;

    const { type, payload, requestId } = event.data;
    const iconEl = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    const siteInfo = {
        origin: window.location.origin,
        href: window.location.href,
        title: document.title || window.location.hostname,
        icon: iconEl?.href || '',
    };

    try {
        // 转发消息到 background
        const response = await chrome.runtime.sendMessage({
            type,
            payload,
            requestId,
            site: siteInfo,
        });

        // 将响应发回页面
        window.postMessage({
            type: 'PANGU_RESPONSE',
            requestId,
            ...response,
        }, '*');
    } catch (error) {
        window.postMessage({
            type: 'PANGU_RESPONSE',
            requestId,
            success: false,
            error: error instanceof Error ? error.message : '扩展通信失败',
        }, '*');
    }
});

// 导出空对象使其成为模块
export { };
