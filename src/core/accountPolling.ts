import { API_BASE_URL, buildNodeUrl } from './api';

let eventSource: EventSource | null = null;
let eventSourceUserId: string | null = null;
let eventSourceGroupId: string | null = null;

export function isAccountPollingActive(): boolean {
    return eventSource !== null && eventSource.readyState === EventSource.OPEN;
}

export function startAccountPolling(
    userId: string,
    groupId: string,
    assignNodeUrl?: string
): void {
    if (!userId || !groupId) return;
    if (typeof EventSource === 'undefined') {
        console.warn('[AccountSSE] EventSource not supported');
        return;
    }

    if (eventSource) {
        if (
            eventSourceUserId === userId &&
            eventSourceGroupId === groupId &&
            eventSource.readyState !== EventSource.CLOSED
        ) {
            return;
        }
        stopAccountPolling();
    }

    eventSourceUserId = userId;
    eventSourceGroupId = groupId;

    const baseUrl = assignNodeUrl ? buildNodeUrl(assignNodeUrl) : API_BASE_URL;
    const url = `${baseUrl}/api/v1/${groupId}/assign/account-update-stream?userID=${userId}`;

    try {
        eventSource = new EventSource(url);

        eventSource.onopen = () => {
            console.info('[AccountSSE] Connected');
        };

        eventSource.onerror = (err) => {
            console.error('[AccountSSE] Connection error:', err);
        };

        eventSource.addEventListener('tx_status_change', (event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data);
                const customEvent = new CustomEvent('pangu_tx_status', {
                    detail: data,
                });
                window.dispatchEvent(customEvent);
            } catch (error) {
                console.error('[AccountSSE] Failed to parse tx_status_change:', error);
            }
        });
    } catch (error) {
        console.error('[AccountSSE] Failed to create EventSource:', error);
        stopAccountPolling();
    }
}

export function stopAccountPolling(): void {
    if (!eventSource) return;
    eventSource.close();
    eventSource = null;
    eventSourceUserId = null;
    eventSourceGroupId = null;
}
