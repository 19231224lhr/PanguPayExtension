# PanguPay 开发者接入指南

本文档面向希望将 PanguPay 钱包集成到网站中的开发者，介绍如何接入插件、测试连接功能。

---

## 目录

1. [环境准备](#1-环境准备)
2. [构建与加载插件](#2-构建与加载插件)
3. [使用 Demo 测试连接](#3-使用-demo-测试连接)
4. [网页接入钱包](#4-网页接入钱包)
5. [常见问题](#5-常见问题)

---

## 1. 环境准备

确保已安装：
- **Node.js** 18+（推荐 20.x）
- **Chrome** 或 **Edge** 浏览器

---

## 2. 构建与加载插件

### 2.1 安装依赖

```bash
cd PanguPayExtension
npm install
```

### 2.2 构建

```bash
# 开发模式（文件变化自动重构建）
npm run dev

# 生产构建
npm run build
```

构建产物输出到 `dist/` 目录。

### 2.3 加载到 Chrome

1. 打开 `chrome://extensions/`
2. 开启右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择 `dist/` 目录
5. 插件图标将出现在浏览器工具栏

### 2.4 创建测试钱包

首次使用需创建钱包：

1. 点击工具栏的 PanguPay 图标
2. 选择 **创建新钱包** 或 **导入已有钱包**
3. 设置密码
4. 完成初始化流程（创建地址、加入担保组织）

---

## 3. 使用 Demo 测试连接

我们提供了一个演示页面用于测试 DApp 连接功能。

### 3.1 打开 Demo 页面

直接在浏览器中打开以下文件：

```
PanguPayExtension/demo/dapp-demo.html
```

或使用本地服务器：

```bash
# 使用 Python
python -m http.server 8000

# 然后访问 http://127.0.0.1:8000/demo/dapp-demo.html
```

### 3.2 测试流程

Demo 页面提供三个按钮：

| 按钮 | 功能 | 说明 |
|:-----|:-----|:-----|
| **连接钱包** | `connect()` | 请求授权，用户选择地址 |
| **签名连接** | `connectSigned()` | 请求签名验证身份 |
| **获取地址** | `getAccount()` | 查询当前授权的地址 |

**测试步骤**：

1. 确保钱包已解锁
2. 点击 **连接钱包**
3. 插件弹出连接请求页面
4. 选择要授权的地址，点击 **确认连接**
5. Demo 页面显示连接成功和地址信息

### 3.3 测试签名连接

1. 点击 **签名连接**
2. 插件弹出签名请求页面，显示待签名消息
3. 选择地址（需已解锁私钥）
4. 点击 **签名并连接**
5. Demo 页面显示签名结果（`signature` 和 `publicKey`）

---

## 4. 网页接入钱包

### 4.1 检测插件

PanguPay 会向页面注入 `window.pangu` 对象，并触发 `panguReady` 事件。

```javascript
// 推荐：等待插件就绪
function ensurePangu() {
    if (window.pangu) return Promise.resolve();
    return new Promise((resolve) => {
        window.addEventListener('panguReady', () => resolve(), { once: true });
    });
}

// 使用
await ensurePangu();
console.log('PanguPay 已就绪');
```

如果 `window.pangu` 为 `undefined`，说明用户未安装插件，可引导用户安装。

### 4.2 连接钱包

```javascript
try {
    const result = await window.pangu.connect();
    console.log('地址:', result.address);
    console.log('账户ID:', result.accountId);
} catch (err) {
    console.error('连接失败:', err.message);
}
```

首次连接会弹出插件让用户选择授权地址。授权后该站点会被记住，下次调用直接返回。

### 4.3 签名登录

当需要验证用户确实控制该地址时，使用签名连接：

```javascript
const result = await window.pangu.connectSigned({
    nonce: String(Date.now()),  // 随机数防重放
    message: 'Login to MyDApp'   // 可选自定义消息
});

// 将签名发送到后端验证
console.log('签名:', result.signature);
console.log('公钥:', result.publicKey);
```

### 4.4 获取当前地址

```javascript
const info = await window.pangu.getAccount();
if (info) {
    console.log('已连接:', info.address);
} else {
    console.log('未连接');
}
```

### 4.5 监听事件

```javascript
// 用户在插件中断开连接
window.pangu.on('disconnect', () => {
    console.log('已断开');
});

// 用户切换账户
window.pangu.on('accountChanged', (newAddress) => {
    console.log('新地址:', newAddress);
});
```

### 4.6 断开连接

```javascript
await window.pangu.disconnect();
```

---

## 5. 常见问题

### Q: `window.pangu` 是 undefined

**原因**：插件未安装或未加载

**解决**：
1. 确认插件已正确加载到浏览器
2. 使用 `ensurePangu()` 等待就绪事件

### Q: 连接时报错 "请先登录钱包"

**原因**：钱包处于锁定状态

**解决**：点击插件图标，输入密码解锁

### Q: 签名时报错 "请先解锁该地址私钥"

**原因**：选择的地址是子钱包地址，未解锁

**解决**：在插件中解锁对应子钱包

### Q: 加载插件时报错 "Manifest file is missing"

**原因**：选择了错误的目录

**解决**：确保选择 `dist/` 目录，而非 `src/`

### Q: 如何查看已连接的网站？

在插件中进入 **设置 → 已连接网站**，可查看和断开已授权站点。

---

## 更多资料

- [DApp 连接技术文档](DAPP_CONNECT.md) - 完整 API 参考
- [Demo 源码](../demo/dapp-demo.html) - 可参考的接入示例

---

> 如有问题，请联系 PanguPay 开发团队。
