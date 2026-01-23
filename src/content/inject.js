/**
 * Inject Script
 * 
 * 注入到页面中，提供 window.pangu API 给第三方网站使用
 */

// 生成唯一请求 ID
function generateRequestId() {
    return `pangu_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 发送消息并等待响应
function sendMessage(type, payload) {
    return new Promise((resolve, reject) => {
        const requestId = generateRequestId();

        const handler = (event) => {
            if (event.source !== window) return;
            if (!event.data || event.data.type !== 'PANGU_RESPONSE') return;
            if (event.data.requestId !== requestId) return;

            window.removeEventListener('message', handler);

            if (event.data.success) {
                resolve(event.data.data);
            } else {
                reject(new Error(event.data.error || '未知错误'));
            }
        };

        window.addEventListener('message', handler);

        window.postMessage({
            type,
            payload,
            requestId,
        }, '*');

        // 超时处理
        setTimeout(() => {
            window.removeEventListener('message', handler);
            reject(new Error('请求超时'));
        }, 30000);
    });
}

// 事件监听器
const eventListeners = {
    accountChanged: [],
    disconnect: [],
};

// 创建 PanguPay 钱包对象
const pangu = {
    async connect() {
        return sendMessage('PANGU_CONNECT');
    },

    async disconnect() {
        return sendMessage('PANGU_DISCONNECT');
    },

    async getAccount() {
        try {
            return await sendMessage('PANGU_GET_ACCOUNT');
        } catch {
            return null;
        }
    },

    async sendTransaction(params) {
        return sendMessage('PANGU_SEND_TRANSACTION', params);
    },

    async isConnected() {
        try {
            const account = await this.getAccount();
            return !!account;
        } catch {
            return false;
        }
    },

    on(event, callback) {
        if (eventListeners[event]) {
            eventListeners[event].push(callback);
        }
    },

    off(event, callback) {
        if (eventListeners[event]) {
            const index = eventListeners[event].indexOf(callback);
            if (index > -1) {
                eventListeners[event].splice(index, 1);
            }
        }
    },
};

// 注入到 window 对象
Object.defineProperty(window, 'pangu', {
    value: pangu,
    writable: false,
    enumerable: true,
    configurable: false,
});

// 触发 pangu ready 事件
window.dispatchEvent(new Event('panguReady'));

console.log('[PanguPay] 钱包已注入 window.pangu');
