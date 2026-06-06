# PanguPay DApp 连接 API 技术文档

本文档详细说明 `window.pangu` API 的技术规范，包括接口定义、参数、返回值和错误码。

> **快速接入**：请先阅读 [开发者接入指南](GUIDE.md) 了解整体流程。

---

## API 概览

| 方法 | 说明 |
|:-----|:-----|
| `connect()` | 请求连接，用户选择授权地址 |
| `connectSigned(options)` | 签名连接，验证地址所有权 |
| `getAccount()` | 获取当前授权的地址信息 |
| `sendTransaction(params)` | 请求插件构造并提交链上交易 |
| `isConnected()` | 检查是否已连接 |
| `disconnect()` | 断开连接 |
| `on(event, callback)` | 注册事件监听 |
| `off(event, callback)` | 移除事件监听 |

---

## 接口详情

### `connect()`

请求连接钱包。如果当前站点未授权，会弹出插件让用户选择地址。

**签名**：
```typescript
connect(): Promise<ConnectResult>
```

**返回值 `ConnectResult`**：
| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| `accountId` | `string` | 用户账户 ID（8位数字） |
| `address` | `string` | 授权的钱包地址（40位十六进制，无 0x 前缀） |
| `origin` | `string` | 当前站点 Origin |

**示例**：
```javascript
const result = await window.pangu.connect();
// { accountId: "12345678", address: "fa61fa2b...", origin: "https://example.com" }
```

**错误**：
| 错误信息 | 说明 |
|:-----|:-----|
| `请先登录钱包` | 钱包未登录或已锁定 |
| `请先完成钱包初始化` | 用户未完成初始化流程 |
| `用户拒绝连接` | 用户点击了拒绝 |
| `用户未响应连接请求` | 超时（120秒） |

---

### `connectSigned(options)`

签名连接模式。用户需使用私钥对消息进行签名，证明地址所有权。

**签名**：
```typescript
connectSigned(options?: SignOptions): Promise<SignConnectResult>
```

**参数 `SignOptions`**：
| 字段 | 类型 | 必填 | 说明 |
|:-----|:-----|:-----|:-----|
| `message` | `string` | 否 | 自定义签名消息 |
| `nonce` | `string` | 否 | 随机数，防止重放攻击 |

若不传参数，插件会自动生成包含 Origin、Nonce、时间戳的标准消息。

**返回值 `SignConnectResult`**：
| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| `accountId` | `string` | 用户账户 ID |
| `address` | `string` | 签名使用的地址 |
| `origin` | `string` | 当前站点 Origin |
| `message` | `string` | 实际签名的完整消息 |
| `signature` | `{ R: string, S: string }` | ECDSA 签名（十六进制） |
| `publicKey` | `{ x: string, y: string }` | P-256 公钥（十六进制） |

**示例**：
```javascript
const result = await window.pangu.connectSigned({
    nonce: String(Date.now()),
    message: 'Login to MyDApp'
});
```

**返回示例**：
```json
{
    "accountId": "12345678",
    "address": "fa61fa2b3c4d5e6f...",
    "origin": "https://example.com",
    "message": "PanguPay Sign-In\nOrigin: https://example.com\nNonce: 1706345678\nIssued At: 2026-01-27T10:00:00.000Z",
    "signature": {
        "R": "a1b2c3d4e5f6...",
        "S": "f6e5d4c3b2a1..."
    },
    "publicKey": {
        "x": "1234567890abcdef...",
        "y": "fedcba0987654321..."
    }
}
```

**后端验签**：

使用 P-256 (secp256r1) 曲线验证：
1. 使用 `publicKey.x` 和 `publicKey.y` 构造公钥
2. 对 `message` 字符串计算 SHA-256 哈希
3. 使用 `signature.R` 和 `signature.S` 验证签名

---

### `getAccount()`

获取当前站点已授权的地址信息。

**签名**：
```typescript
getAccount(): Promise<AccountInfo | null>
```

**返回值 `AccountInfo`**：
| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| `accountId` | `string` | 用户账户 ID |
| `address` | `string` | 已授权的地址 |
| `origin` | `string` | 当前站点 Origin |
| `balance` | `{ 0: number, 1: number, 2: number }` | 余额（0=PGC, 1=BTC, 2=ETH） |
| `organization` | `string \| null` | 所属担保组织名称 |

如果当前站点未连接，返回 `null`。

---

### `sendTransaction(params)`

请求插件构造并提交链上交易。该接口复用插件内置转账构建逻辑，与前端转账页使用同一套后端协议字段和提交接口。

**签名**：
```typescript
sendTransaction(params: SendTransactionParams): Promise<SendTransactionResult>
```

**参数 `SendTransactionParams`**：
| 字段 | 类型 | 必填 | 说明 |
|:-----|:-----|:-----|:-----|
| `to` / `toAddress` / `address` | `string` | 单收款方必填 | 收款地址 |
| `amount` / `value` | `number` | 单收款方必填 | 转账金额 |
| `coinType` / `type` | `number` | 否 | 币种，`0=PGC`、`1=BTC`、`2=ETH` |
| `mode` / `transferMode` | `'normal' \| 'quick' \| 'cross'` | 否 | 转账模式，默认 `normal` |
| `gas` | `number` | 否 | 交易 Gas |
| `extraGas` / `howMuchPayForGas` | `number` | 否 | 额外 Gas 兑换金额 |
| `publicKey` / `recipientPublicKey` | `string \| {x,y}` | 否 | 收款方 P-256 公钥 |
| `orgId` / `recipientOrgId` / `groupId` | `string` | 否 | 收款方担保组织 ID |
| `transferGas` / `interest` | `number` | 否 | 快速交易支付给收款方的利息/Gas |
| `seedAnchor` / `SeedAnchor` | `number[] \| string` | 否 | 收款方 Seed 链锚点 |
| `seedChainStep` / `SeedChainStep` | `number` | 否 | 收款方 Seed 链步数 |
| `defaultSpendAlgorithm` / `DefaultSpendAlgorithm` | `string` | 否 | 默认花费算法 |
| `recipients` | `TransactionRecipient[]` | 多收款方必填 | 多收款方列表 |

多收款方交易中，每个 recipient 支持同样的 `toAddress/address`、`amount/value`、`coinType/type`、`publicKey`、`orgId/groupId`、`transferGas` 和 Seed 元数据字段。根级收款方元数据只作为单收款方请求的兜底；多收款方应把元数据放到各自 recipient 上。

**返回值 `SendTransactionResult`**：
| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| `txId` | `string` | 后端返回或本地构造的交易 ID |
| `mode` | `'normal' \| 'quick' \| 'cross'` | 实际提交模式 |
| `status` | `'submitted'` | 已提交到后端 |

**示例：单收款方**
```javascript
const result = await window.pangu.sendTransaction({
    toAddress: '0123456789abcdef0123456789abcdef01234567',
    amount: 10,
    coinType: 0,
    transferMode: 'quick',
    recipientPublicKey: 'pubXHex,pubYHex',
    recipientOrgId: '10000000',
    howMuchPayForGas: 0
});
```

**示例：多收款方**
```javascript
const result = await window.pangu.sendTransaction({
    transferMode: 'normal',
    coinType: 0,
    recipients: [
        { toAddress: 'first...', amount: 1, publicKey: 'x1,y1', orgId: '10000000' },
        { toAddress: 'second...', amount: 2, publicKey: 'x2,y2', orgId: '10000000' }
    ]
});
```

**状态通知**：

`sendTransaction()` 返回 `submitted` 后，组织交易会继续通过 `txStatus` 事件通知最终状态：

```javascript
window.pangu.on('txStatus', (event) => {
    console.log(event.txId, event.status, event.mode, event.error);
});
```

组织交易使用 `/api/v1/{groupID}/assign/tx-status/{txID}` 查询最终 `success` 或 `failed`。普通无组织交易使用 `/api/v1/com/submit-noguargroup-tx` 提交；当前后端没有提供对应最终状态查询接口，因此插件不会伪造最终成功事件。

---

### `isConnected()`

快速检查当前站点是否已连接。

**签名**：
```typescript
isConnected(): Promise<boolean>
```

---

### `disconnect()`

断开当前站点与钱包的连接。

**签名**：
```typescript
disconnect(): Promise<void>
```

断开后，`getAccount()` 返回 `null`，需重新调用 `connect()` 授权。

---

### `on(event, callback)`

注册事件监听器。

**签名**：
```typescript
on(event: EventName, callback: EventCallback): void
```

**支持的事件**：

| 事件名 | 触发时机 | 回调参数 |
|:-----|:-----|:-----|
| `disconnect` | 用户在插件中断开当前站点 | `{ origin: string }` |
| `accountChanged` | 用户在插件中切换账户 | `string`（新地址） |
| `txStatus` | DApp 交易状态变化 | `{ txId, status, mode, origin, error }` |

**示例**：
```javascript
window.pangu.on('disconnect', (payload) => {
    console.log('断开:', payload.origin);
});

window.pangu.on('accountChanged', (newAddress) => {
    console.log('切换:', newAddress);
});

window.pangu.on('txStatus', (event) => {
    console.log('交易状态:', event.status, event.txId);
});
```

---

### `off(event, callback)`

移除事件监听器。

**签名**：
```typescript
off(event: EventName, callback: EventCallback): void
```

需传入与 `on()` 相同的 callback 引用。

---

## 类型定义

```typescript
interface ConnectResult {
    accountId: string;
    address: string;
    origin: string;
}

interface SignOptions {
    message?: string;
    nonce?: string;
}

interface SignConnectResult extends ConnectResult {
    message: string;
    signature: { R: string; S: string };
    publicKey: { x: string; y: string };
}

interface AccountInfo extends ConnectResult {
    balance: Record<number, number>;
    organization: string | null;
}

type TransferMode = 'normal' | 'quick' | 'cross';

interface TransactionRecipient {
    to?: string;
    toAddress?: string;
    address?: string;
    amount?: number;
    value?: number;
    coinType?: number;
    type?: number;
    publicKey?: string | { x?: string; y?: string; X?: string; Y?: string };
    orgId?: string;
    groupId?: string;
    transferGas?: number;
    seedAnchor?: number[] | string;
    seedChainStep?: number;
    defaultSpendAlgorithm?: string;
}

interface SendTransactionParams extends TransactionRecipient {
    mode?: TransferMode;
    transferMode?: TransferMode;
    gas?: number;
    extraGas?: number;
    howMuchPayForGas?: number;
    recipientPublicKey?: string;
    recipientOrgId?: string;
    recipients?: TransactionRecipient[];
}

interface SendTransactionResult {
    txId?: string;
    mode: TransferMode;
    status: 'submitted';
}

interface TxStatusEvent {
    txId?: string;
    status?: 'submitted' | 'success' | 'failed';
    mode?: TransferMode;
    origin?: string;
    error?: string;
}

type EventName = 'disconnect' | 'accountChanged' | 'txStatus';
```

---

## 安全说明

1. **用户授权**：所有连接请求都需用户在插件弹窗中手动确认
2. **私钥隔离**：私钥仅在扩展沙盒中使用，不会暴露给网页
3. **Origin 校验**：后台严格校验请求来源，防止跨域欺诈
4. **Nonce 防重放**：签名连接建议使用 Nonce 防止签名被重放

---

## 超时与限制

| 项目 | 值 |
|:-----|:-----|
| 连接超时 | 120 秒 |
| 签名超时 | 120 秒 |
| 地址格式 | 40 位十六进制（无 0x 前缀） |
| 签名算法 | ECDSA P-256 (secp256r1) |
| 哈希算法 | SHA-256 |

---

## 错误码汇总

| 错误信息 | 说明 |
|:-----|:-----|
| `请先登录钱包` | 钱包未登录或已锁定 |
| `请先完成钱包初始化` | 用户未完成初始化流程 |
| `用户拒绝连接` | 用户点击了拒绝按钮 |
| `用户拒绝签名` | 用户在签名页点击了拒绝 |
| `用户未响应连接请求` | 连接超时 |
| `用户未响应签名请求` | 签名超时 |
| `User did not confirm transaction` | 交易确认超时 |
| `Site is not connected` | 调用 sendTransaction 前未 connect |
| `Transaction recipient is missing` | 交易缺少有效收款方 |
| `站点未授权，请先连接钱包` | 调用 getAccount 前未 connect |
| `请先解锁该地址私钥` | 签名的地址私钥未解锁 |
| `请求超时` | 通用超时错误 |
