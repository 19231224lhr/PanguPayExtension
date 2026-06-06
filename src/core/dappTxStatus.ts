import { consumeDappTxWatches } from './storage';

export async function notifyDappTxStatus(
    accountId: string,
    txId: string,
    status: 'success' | 'failed',
    options: { error?: string } = {}
): Promise<void> {
    if (!accountId || !txId) return;
    const watches = await consumeDappTxWatches(accountId, txId);
    if (watches.length === 0) return;
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;

    for (const watch of watches) {
        try {
            await chrome.runtime.sendMessage({
                type: 'PANGU_DAPP_NOTIFY',
                payload: {
                    origin: watch.origin,
                    event: 'txStatus',
                    txId,
                    status,
                    mode: watch.mode || 'normal',
                    error: options.error || '',
                },
            });
        } catch {
            // The DApp tab may have closed; the watch has already been consumed.
        }
    }
}
