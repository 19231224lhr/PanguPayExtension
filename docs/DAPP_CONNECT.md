# PanguPay 钱包插件 DApp 接入文档

本指南面向第三方网页开发者，详细说明如何将 PanguPay 浏览器钱包集成到您的 Web 应用中。

---

## 快速开始

### 前置条件

用户需要已安装 PanguPay 浏览器扩展，并且：
1.  已创建或导入钱包账户。
2.  已完成钱包初始化流程（包含创建地址、加入担保组织等）。
3.  钱包处于解锁状态（输入过密码）。

### 安装检测

PanguPay 扩展会在页面加载时向 `window` 对象注入 `pangu` 全局对象，并触发 `panguReady` 事件。

```javascript
// 方式一：直接检测（适用于页面加载较慢的场景）
if (window.pangu) {
    console.log('PanguPay 已就绪');
}

// 方式二：事件监听（推荐，确保不会错过注入时机）
function ensurePangu() {
    if (window.pangu) return Promise.resolve();
    return new Promise((resolve) => {
        window.addEventListener('panguReady', () => resolve(), { once: true });
    });
}

// 使用示例
await ensurePangu();
console.log('PanguPay 已就绪，可以调用 API');
```

> **提示**：如果用户未安装插件，`window.pangu` 将为 `undefined`，您可以在此时引导用户安装。

---

## API 参考

### `window.pangu.connect()`

请求连接钱包。如果用户尚未授权当前站点，将弹出插件界面让用户选择要授权的地址。

**调用方式**：
```javascript
const result = await window.pangu.connect();
```

**返回值**：
| 字段 | 类型 | 说明 |
|:---|:---|:---|
| `accountId` | `string` | 用户账户 ID（8位数字） |
| `address` | `string` | 用户选择授权的钱包地址（40位十六进制） |
| `origin` | `string` | 当前站点 Origin（如 `https://example.com`） |

**返回示例**：
```json
{
    "accountId": "12345678",
    "address": "fa61fa2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f",
    "origin": "https://your-dapp.com"
}
```

**异常情况**：
| 错误信息 | 说明 |
|:---|:---|
| `请先登录钱包` | 用户未登录或钱包已锁定 |
| `请先完成钱包初始化` | 用户尚未完成初始化流程 |
| `用户拒绝连接` | 用户在弹窗中点击了"拒绝" |
| `用户未响应连接请求` | 超时（默认 120 秒） |

---

### `window.pangu.connectSigned(options)`

签名连接模式。除了授权地址外，还会要求用户使用私钥对消息进行签名，用于证明用户真正控制该地址。适用于需要身份验证的场景（如登录、绑定）。

**参数**：
| 字段 | 类型 | 必填 | 说明 |
|:---|:---|:---|:---|
| `message` | `string` | 否 | 自定义签名消息，若不传则使用默认格式 |
| `nonce` | `string` | 否 | 随机数，用于防止重放攻击，建议使用时间戳或 UUID |

**调用方式**：
```javascript
const result = await window.pangu.connectSigned({
    nonce: String(Date.now()),
    message: 'Login to MyDApp'  // 可选，建议传入
});
```

**返回值**：
| 字段 | 类型 | 说明 |
|:---|:---|:---|
| `accountId` | `string` | 用户账户 ID |
| `address` | `string` | 签名使用的地址 |
| `origin` | `string` | 当前站点 Origin |
| `message` | `string` | 实际签名的完整消息内容 |
| `signature` | `object` | ECDSA 签名，包含 `R` 和 `S` 两个十六进制字符串 |
| `publicKey` | `object` | 签名地址的公钥，包含 `x` 和 `y` 两个十六进制字符串 |

**返回示例**：
```json
{
    "accountId": "12345678",
    "address": "fa61fa2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f",
    "origin": "https://your-dapp.com",
    "message": "PanguPay Sign-In\nOrigin: https://your-dapp.com\nNonce: 1706345678901\nIssued At: 2026-01-27T10:00:00.000Z",
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

> **后端验签**：收到签名后，您的后端应使用 P-256 (secp256r1) 曲线验证签名。验签通过则证明用户确实控制该地址。

---

### `window.pangu.getAccount()`

获取当前站点已授权的地址信息。如果当前站点未连接，返回 `null`。

**调用方式**：
```javascript
const info = await window.pangu.getAccount();
if (info) {
    console.log('已连接地址:', info.address);
} else {
    console.log('尚未连接');
}
```

**返回值**：
| 字段 | 类型 | 说明 |
|:---|:---|:---|
| `accountId` | `string` | 用户账户 ID |
| `address` | `string` | 已授权的地址 |
| `origin` | `string` | 当前站点 Origin |
| `balance` | `object` | 余额信息（可选），格式为 `{ 0: number, 1: number, 2: number }`，分别对应 PGC/BTC/ETH |
| `organization` | `string \| null` | 用户加入的担保组织名称（可选） |

---

### `window.pangu.isConnected()`

快速检查当前站点是否已连接钱包。

**调用方式**：
```javascript
const connected = await window.pangu.isConnected();
if (connected) {
    // 显示已连接状态
} else {
    // 显示连接按钮
}
```

**返回值**：`boolean`

---

### `window.pangu.disconnect()`

断开当前站点与钱包的连接。断开后，`getAccount()` 将返回 `null`，需重新调用 `connect()` 授权。

**调用方式**：
```javascript
await window.pangu.disconnect();
console.log('已断开连接');
```

---

### `window.pangu.on(event, callback)`

注册事件监听器。

**支持的事件**：
| 事件名 | 触发时机 | 回调参数 |
|:---|:---|:---|
| `disconnect` | 用户在插件中断开了当前站点 | `{ origin: string }` |
| `accountChanged` | 用户在插件中切换了账户 | `string`（新地址） |

**使用示例**：
```javascript
// 监听断开事件
window.pangu.on('disconnect', (payload) => {
    console.log('已断开连接:', payload.origin);
    // 更新 UI，重置状态
});

// 监听账户切换事件
window.pangu.on('accountChanged', (newAddress) => {
    console.log('账户已切换:', newAddress);
    // 重新加载用户数据
});
```

---

### `window.pangu.off(event, callback)`

移除事件监听器。

**使用示例**：
```javascript
const handler = (payload) => console.log(payload);
window.pangu.on('disconnect', handler);

// 稍后移除
window.pangu.off('disconnect', handler);
```

---

## 完整接入示例

以下是一个完整的接入代码示例，可直接复制到您的项目中使用：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>DApp 接入示例</title>
</head>
<body>
    <button id="connectBtn">连接钱包</button>
    <button id="signConnectBtn">签名登录</button>
    <button id="disconnectBtn">断开连接</button>
    <div id="status">未连接</div>

    <script>
        const statusEl = document.getElementById('status');

        // 确保 PanguPay 已注入
        function ensurePangu() {
            if (window.pangu) return Promise.resolve();
            return new Promise((resolve) => {
                window.addEventListener('panguReady', () => resolve(), { once: true });
            });
        }

        // 初始化事件监听
        async function init() {
            await ensurePangu();

            // 检查是否已连接
            const connected = await window.pangu.isConnected();
            if (connected) {
                const info = await window.pangu.getAccount();
                statusEl.textContent = `已连接: ${info.address.slice(0, 10)}...`;
            }

            // 监听断开事件
            window.pangu.on('disconnect', () => {
                statusEl.textContent = '已断开连接';
            });

            // 监听账户切换
            window.pangu.on('accountChanged', (newAddress) => {
                statusEl.textContent = `账户已切换: ${newAddress.slice(0, 10)}...`;
            });
        }

        // 连接钱包
        document.getElementById('connectBtn').addEventListener('click', async () => {
            try {
                await ensurePangu();
                const result = await window.pangu.connect();
                statusEl.textContent = `连接成功: ${result.address.slice(0, 10)}...`;
            } catch (err) {
                statusEl.textContent = `连接失败: ${err.message}`;
            }
        });

        // 签名登录
        document.getElementById('signConnectBtn').addEventListener('click', async () => {
            try {
                await ensurePangu();
                const result = await window.pangu.connectSigned({
                    nonce: String(Date.now()),
                    message: 'Login to MyDApp'
                });
                statusEl.textContent = `登录成功: ${result.address.slice(0, 10)}...`;
                console.log('签名结果:', result.signature);
                console.log('公钥:', result.publicKey);
                // 将 result 发送到后端进行验签
            } catch (err) {
                statusEl.textContent = `登录失败: ${err.message}`;
            }
        });

        // 断开连接
        document.getElementById('disconnectBtn').addEventListener('click', async () => {
            await ensurePangu();
            await window.pangu.disconnect();
            statusEl.textContent = '已断开连接';
        });

        init();
    </script>
</body>
</html>
```

---

## 常见问题

### Q: 如何判断用户是否安装了 PanguPay？
A: 检查 `window.pangu` 是否存在。如果不存在，可以提示用户安装插件。

### Q: 连接一次后，下次还需要再连接吗？
A: 用户授权后，该站点会被记住。下次调用 `connect()` 会直接返回已授权的地址，无需再次弹窗（除非用户手动断开）。

### Q: 签名使用的是什么算法？
A: ECDSA P-256 (secp256r1)。签名内容为 `message` 字符串的 SHA-256 哈希值。

### Q: 如何在后端验证签名？
A: 使用返回的 `publicKey.x` 和 `publicKey.y` 构造 P-256 公钥，然后验证 `signature.R` 和 `signature.S` 对 `sha256(message)` 的签名。

### Q: 用户在哪里管理已连接的网站？
A: 在插件的 **设置 → 已连接网站** 中可以查看和断开已授权的站点。

---

## 注意事项

1.  **用户必须解锁钱包**：所有 API 调用都需要用户先解锁钱包（输入密码），否则会返回错误。
2.  **签名需要私钥可用**：`connectSigned` 仅支持主账户地址或已解锁的子钱包地址。
3.  **超时时间**：连接请求默认 120 秒超时，超时后会返回错误。
4.  **Origin 隔离**：每个站点的授权是独立的，`https://a.com` 的授权不会影响 `https://b.com`。
