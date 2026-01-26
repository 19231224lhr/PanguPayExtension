# PanguPay 网页接入指南（最小版）

本指南用于网页开发者快速接入 PanguPay 浏览器钱包插件，实现：
- 检测插件
- 连接钱包
- 获取当前站点选定的地址

> 插件支持“每个网站单独选一个地址”。首次连接会弹出插件，由用户选择地址并授权。

## 1. 检测插件

插件注入 `window.pangu`，并触发 `panguReady` 事件。

```js
function isPanguAvailable() {
  return typeof window.pangu !== 'undefined';
}

if (!isPanguAvailable()) {
  window.addEventListener('panguReady', () => {
    console.log('PanguPay ready');
  });
}
```

## 2. 连接钱包（弹出授权）

```js
async function connectPangu() {
  try {
    const result = await window.pangu.connect();
    // result: { accountId, address, origin }
    console.log('Connected:', result);
    return result;
  } catch (err) {
    console.error('Connect failed:', err.message);
    throw err;
  }
}
```

> 若该站点未授权，插件会打开连接页面，用户选择地址后返回。

## 3. 获取地址信息

```js
async function getPanguAccount() {
  const info = await window.pangu.getAccount();
  // info: { accountId, address, origin, balance?, organization? }
  return info;
}
```

## 4. 断开连接（可选）

```js
async function disconnectPangu() {
  await window.pangu.disconnect();
}
```

## 5. 最小接入流程建议

1. 页面加载检测 `window.pangu`
2. 用户点击“连接钱包”
3. 调用 `connect()`
4. 连接成功后调用 `getAccount()` 显示地址

## 6. 注意事项

- 需要用户在插件中选择地址授权后，网站才能访问地址。
- 如果用户未解锁钱包，会提示“请先解锁钱包”。
- 如果钱包尚未完成初始化（未创建地址/未加入组织），会提示完成初始化。
