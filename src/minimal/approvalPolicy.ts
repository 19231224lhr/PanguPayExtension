export const APPROVAL_TIMEOUT_MS = 120_000;

export function remainingApprovalMs(createdAt: number, now = Date.now()): number {
    return Math.max(0, APPROVAL_TIMEOUT_MS - Math.max(0, now - createdAt));
}
