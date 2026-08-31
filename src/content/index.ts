import { isPublicPageMessage } from '../minimal/messages';

const PAGE_RESPONSE_TYPE = 'PANGU_RESPONSE';
const PAGE_EVENT_TYPE = 'PANGU_EVENT';

function injectProvider(): void {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('src/content/inject.js');
    script.type = 'module';
    (document.head || document.documentElement).appendChild(script);
    script.addEventListener('load', () => script.remove(), { once: true });
}

injectProvider();

window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source !== window || !isPublicPageMessage(event.data)) return;
    const message = event.data;

    void chrome.runtime.sendMessage(message).then((response) => {
        window.postMessage({
            type: PAGE_RESPONSE_TYPE,
            requestId: message.requestId,
            ...(response || { success: false, error: 'PanguPay did not respond' }),
        }, window.location.origin);
    }).catch((error: unknown) => {
        window.postMessage({
            type: PAGE_RESPONSE_TYPE,
            requestId: message.requestId,
            success: false,
            error: error instanceof Error ? error.message : 'PanguPay communication failed',
        }, window.location.origin);
    });
});

chrome.runtime.onMessage.addListener((message: unknown) => {
    if (!message || typeof message !== 'object') return;
    const event = message as Record<string, unknown>;
    if (event.type !== PAGE_EVENT_TYPE) return;
    if (typeof event.origin === 'string' && event.origin !== window.location.origin) return;
    if (!['accountChanged', 'disconnect', 'txStatus'].includes(String(event.event))) return;
    window.postMessage(event, window.location.origin);
});

export {};
