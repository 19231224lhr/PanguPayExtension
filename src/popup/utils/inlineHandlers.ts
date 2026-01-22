export type InlineHandlerMap = Record<string, (...args: unknown[]) => void>;

export function bindInlineHandlers(root: HTMLElement, handlers: InlineHandlerMap): void {
    const nodes = root.querySelectorAll<HTMLElement>('[onclick]');
    nodes.forEach((node) => {
        const raw = node.getAttribute('onclick');
        if (!raw) return;

        const match = raw.trim().match(/^([\w$]+)\s*\((.*)\)\s*$/);
        if (!match) return;

        const name = match[1];
        const args = parseArgs(match[2]);
        const handler = handlers[name];
        if (!handler) return;

        node.addEventListener('click', (event) => {
            event.preventDefault();
            handler(...args);
        });
        node.removeAttribute('onclick');
    });
}

function parseArgs(raw: string): unknown[] {
    const trimmed = raw.trim();
    if (!trimmed) return [];

    const normalized = `[${trimmed.replace(/'/g, '"')}]`;
    try {
        return JSON.parse(normalized) as unknown[];
    } catch {
        return trimmed
            .split(',')
            .map((part) => parsePrimitive(part.trim()))
            .filter((part) => part !== '');
    }
}

function parsePrimitive(value: string): unknown {
    if (!value) return '';
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
    return value.replace(/^['"]|['"]$/g, '');
}
