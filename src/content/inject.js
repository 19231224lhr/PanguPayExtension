const RESPONSE_TYPE = 'PANGU_RESPONSE';
const EVENT_TYPE = 'PANGU_EVENT';
const REQUEST_TIMEOUT_MS = 120_000;
const listeners = new Map([
    ['accountChanged', new Set()],
    ['disconnect', new Set()],
    ['txStatus', new Set()],
]);
const pending = new Map();

function request(type, payload) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
            pending.delete(requestId);
            reject(new Error('PanguPay request timed out'));
        }, REQUEST_TIMEOUT_MS);
        pending.set(requestId, { resolve, reject, timeoutId });
        window.postMessage({ type, requestId, payload }, window.location.origin);
    });
}

function emit(event, payload) {
    for (const listener of listeners.get(event) || []) {
        try {
            listener(payload);
        } catch (error) {
            console.error('[PanguPay] DApp listener failed:', error);
        }
    }
}

window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const message = event.data;
    if (!message || typeof message !== 'object') return;

    if (message.type === RESPONSE_TYPE) {
        const entry = pending.get(message.requestId);
        if (!entry) return;
        window.clearTimeout(entry.timeoutId);
        pending.delete(message.requestId);
        if (message.success) entry.resolve(message.data);
        else entry.reject(new Error(message.error || 'PanguPay request failed'));
        return;
    }

    if (message.type !== EVENT_TYPE || !listeners.has(message.event)) return;
    if (message.event === 'accountChanged') {
        emit('accountChanged', message.account || null);
    } else if (message.event === 'disconnect') {
        emit('disconnect');
    } else {
        emit('txStatus', {
            txId: message.txId,
            mode: 'quick',
            status: message.status,
            ...(message.error ? { error: message.error } : {}),
        });
    }
});

const provider = Object.freeze({
    connect: () => request('PANGU_CONNECT'),
    getAccount: () => request('PANGU_GET_ACCOUNT'),
    sendTransaction: (transaction) => request('PANGU_SEND_TRANSACTION', transaction),
    isConnected: async () => Boolean(await request('PANGU_GET_ACCOUNT')),
    disconnect: () => request('PANGU_DISCONNECT'),
    on(event, listener) {
        if (!listeners.has(event) || typeof listener !== 'function') {
            throw new Error(`Unsupported PanguPay event: ${event}`);
        }
        listeners.get(event).add(listener);
        return provider;
    },
    off(event, listener) {
        listeners.get(event)?.delete(listener);
        return provider;
    },
});

Object.defineProperty(window, 'pangu', {
    value: provider,
    configurable: false,
    enumerable: true,
    writable: false,
});
window.dispatchEvent(new Event('panguReady'));
