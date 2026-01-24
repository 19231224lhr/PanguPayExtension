/**
 * Big Integer JSON Parser
 *
 * 使用 json-bigint 解析包含大整数的 JSON，避免精度丢失。
 */

// @ts-ignore - json-bigint 没有类型定义
import JSONBig from 'json-bigint';

const JSONBigString = JSONBig({ storeAsString: true });

export function parseBigIntJson<T = unknown>(text: string): T {
    return JSONBigString.parse(text) as T;
}

export function stringifyBigIntJson(obj: unknown): string {
    return JSONBigString.stringify(obj);
}

export async function parseResponseBigInt<T = unknown>(response: Response): Promise<T> {
    const text = await response.text();
    return parseBigIntJson<T>(text);
}
