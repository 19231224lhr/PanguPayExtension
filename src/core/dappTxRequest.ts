import type { DappTransactionRequest } from './storage';

function readDappStringField(raw: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
        const value = raw[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
    return undefined;
}

function readDappNumberField(raw: Record<string, unknown>, keys: string[]): number | undefined {
    for (const key of keys) {
        const value = raw[key];
        if (value === null || value === undefined || value === '') continue;
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return numeric;
    }
    return undefined;
}

function readDappPublicKey(raw: Record<string, unknown>): string | undefined {
    const value = raw.publicKey ?? raw.PublicKey ?? raw.recipientPublicKey ?? raw.RecipientPublicKey;
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object') {
        const key = value as Record<string, unknown>;
        const x = readDappStringField(key, ['x', 'X', 'xHex', 'XHex']);
        const y = readDappStringField(key, ['y', 'Y', 'yHex', 'YHex']);
        if (x && y) return `${x},${y}`;
    }
    return undefined;
}

function readDappSeedAnchor(raw: Record<string, unknown>): number[] | string | undefined {
    const value = raw.seedAnchor ?? raw.SeedAnchor;
    if (Array.isArray(value)) {
        const bytes = value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
        return bytes.length > 0 ? bytes : undefined;
    }
    if (typeof value === 'string' && value.trim()) return value.trim();
    return undefined;
}

export function normalizeDappTxRequest(payload: unknown): DappTransactionRequest {
    const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
    const rootPublicKey = readDappPublicKey(raw);
    const rootOrgId = readDappStringField(raw, [
        'orgId',
        'orgID',
        'groupId',
        'groupID',
        'recipientOrgId',
        'recipientOrgID',
        'GuarGroupID',
    ]);
    const rootTransferGas = readDappNumberField(raw, ['transferGas', 'interest', 'estInterest', 'EstInterest']);
    const rootSeedAnchor = readDappSeedAnchor(raw);
    const rootSeedChainStep = readDappNumberField(raw, ['seedChainStep', 'SeedChainStep']);
    const rootDefaultSpendAlgorithm = readDappStringField(raw, ['defaultSpendAlgorithm', 'DefaultSpendAlgorithm']);
    const rootCoinType = readDappNumberField(raw, ['coinType', 'type', 'Type']);
    const rootToAddress = readDappStringField(raw, ['to', 'toAddress', 'address']);
    const rootAmount = readDappNumberField(raw, ['amount', 'value']);
    const recipients = Array.isArray(raw.recipients)
        ? raw.recipients
              .map((item) => {
                  const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
                  const coinType = readDappNumberField(entry, ['coinType', 'type', 'Type']);
                  const transferGas = readDappNumberField(entry, ['transferGas', 'interest', 'estInterest', 'EstInterest']);
                  return {
                      to: readDappStringField(entry, ['to', 'toAddress', 'address']) || '',
                      amount: Number(readDappNumberField(entry, ['amount', 'value']) ?? 0),
                      coinType: Number(coinType ?? rootCoinType ?? 0),
                      publicKey: readDappPublicKey(entry),
                      orgId: readDappStringField(entry, [
                          'orgId',
                          'orgID',
                          'groupId',
                          'groupID',
                          'recipientOrgId',
                          'recipientOrgID',
                          'GuarGroupID',
                      ]),
                      transferGas,
                      seedAnchor: readDappSeedAnchor(entry),
                      seedChainStep: readDappNumberField(entry, ['seedChainStep', 'SeedChainStep']),
                      defaultSpendAlgorithm: readDappStringField(entry, [
                          'defaultSpendAlgorithm',
                          'DefaultSpendAlgorithm',
                      ]),
                  };
              })
              .filter((item) => item.to && item.amount > 0)
        : [];

    if (recipients.length === 0 && rootToAddress && Number(rootAmount || 0) > 0) {
        recipients.push({
            to: rootToAddress,
            amount: Number(rootAmount || 0),
            coinType: Number(rootCoinType ?? 0),
            publicKey: rootPublicKey,
            orgId: rootOrgId,
            transferGas: rootTransferGas,
            seedAnchor: rootSeedAnchor,
            seedChainStep: rootSeedChainStep,
            defaultSpendAlgorithm: rootDefaultSpendAlgorithm,
        });
    }

    const modeValue = readDappStringField(raw, ['mode', 'transferMode']);
    const mode = modeValue === 'cross' || modeValue === 'quick' || modeValue === 'normal' ? modeValue : 'normal';

    return {
        to: rootToAddress,
        amount: rootAmount,
        coinType: Number(rootCoinType ?? 0),
        mode,
        gas: Number(readDappNumberField(raw, ['gas', 'Gas']) ?? 0),
        extraGas: Number(readDappNumberField(raw, ['extraGas', 'howMuchPayForGas', 'HowMuchPayForGas']) ?? 0),
        publicKey: rootPublicKey,
        orgId: rootOrgId,
        transferGas: rootTransferGas,
        seedAnchor: rootSeedAnchor,
        seedChainStep: rootSeedChainStep,
        defaultSpendAlgorithm: rootDefaultSpendAlgorithm,
        recipients,
    };
}
