# PanguPay Extension 使用指南

本文档说明如何构建、加载和测试 PanguPay 浏览器钱包扩展。

---

## 目录

1. [开发环境准备](#1-开发环境准备)
2. [安装依赖](#2-安装依赖)
3. [构建扩展](#3-构建扩展)
4. [加载到浏览器](#4-加载到浏览器)
5. [功能测试](#5-功能测试)
6. [常见问题](#6-常见问题)

---

## 1. 开发环境准备

确保已安装：
- **Node.js** 18+ (推荐 20.x)
- **npm** 或 **pnpm**
- **Chrome** 或 **Edge** 浏览器

---

## 2. 安装依赖

在扩展项目目录下运行：

```bash
cd C:\Users\18360\Desktop\Code\PanguPayExtension
npm install
```

---

## 3. 构建扩展

### 开发模式（实时编译）

```bash
npm run dev
```

这将持续监听文件变化并自动重新构建。

### 生产构建

```bash
npm run build
```

构建产物输出到 `dist/` 目录。

---

## 4. 加载到浏览器

### Chrome 浏览器

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角 **"开发者模式"**
3. 点击 **"加载已解压的扩展程序"**
4. 选择 `dist/` 文件夹（或直接选择项目根目录，如果使用 crxjs）
5. 扩展将出现在工具栏中

![加载扩展示意图](https://developer.chrome.com/static/docs/extensions/get-started/tutorial/hello-world/image/extensions-page-e702601.png)

### Edge 浏览器

1. 打开 Edge，访问 `edge://extensions/`
2. 开启 **"开发人员模式"**
3. 点击 **"加载解压缩的扩展"**
4. 选择 `dist/` 文件夹

---

## 5. 功能测试

### 5.1 创建钱包

1. 点击浏览器工具栏的 PanguPay 图标
2. 点击 **"创建新钱包"**
3. 查看生成的地址（点击可显示私钥）
4. 设置密码并确认
5. 完成后自动跳转到首页

### 5.2 导入钱包

1. 在欢迎页点击 **"导入已有钱包"**
2. 输入 64 字符的十六进制私钥
3. 设置密码
4. 完成导入

### 5.3 查看余额

首页显示：
- 总资产（PGC 计价）
- 钱包地址（可复制）
- PGC、BTC、ETH 分类余额

### 5.4 发送交易

1. 点击 **"发送"** 按钮
2. 选择转账模式：
   - **快速转账**：组织内即时到账（需先加入组织）
   - **普通转账**：散户聚合交易
   - **跨链**：BTC/ETH 跨链转账
3. 输入金额和收款地址
4. 确认发送

### 5.5 接收资产

1. 点击 **"接收"** 按钮
2. 显示收款地址和二维码
3. 支持 PGC、BTC、ETH 三种资产

### 5.6 交易历史

- 查看所有发送/接收记录
- 显示交易状态和时间

### 5.7 担保组织

1. 进入 **"组织"** 页面
2. 查看可用的担保组织列表
3. 点击 **"加入"** 加入组织
4. 加入后可使用快速转账功能

### 5.8 设置

- 切换语言（中文/英文）
- 切换主题（深色/浅色）
- 锁定钱包
- 删除钱包

---

## 6. 常见问题

### Q: 加载扩展时报错 "Manifest file is missing"

确保选择的是 `dist/` 目录，而不是 `src/` 目录。

### Q: 图标不显示

检查 `public/icons/` 目录是否存在 SVG 图标文件。

### Q: 页面空白

1. 打开 Chrome 开发者工具（F12）
2. 切换到 Console 面板查看错误信息
3. 尝试重新构建：`npm run build`

### Q: Chrome 类型报错

运行 `npm install` 安装 `@types/chrome` 类型定义。

---

## 项目文件结构

```
PanguPayExtension/
├── manifest.json           # 扩展配置
├── package.json            # 依赖配置
├── vite.config.ts          # 构建配置
├── tsconfig.json           # TypeScript 配置
├── public/
│   └── icons/              # 扩展图标
├── src/
│   ├── background/         # Service Worker
│   ├── content/            # 内容脚本
│   ├── popup/              # 弹窗界面
│   │   ├── index.html
│   │   ├── main.ts
│   │   ├── styles/
│   │   └── pages/
│   └── core/               # 核心业务逻辑
│       ├── signature.ts
│       ├── keyEncryption.ts
│       ├── storage.ts
│       ├── api.ts
│       └── types.ts
└── dist/                   # 构建输出
```

---

## 网站对接示例

第三方网站可以通过 `window.pangu` 调用钱包功能：

```javascript
// 检测扩展是否安装
if (typeof window.pangu === 'undefined') {
  alert('请安装 PanguPay 钱包扩展');
  return;
}

// 连接钱包
const { address } = await window.pangu.connect();
console.log('已连接:', address);

// 发送交易
const result = await window.pangu.sendTransaction({
  to: '收款地址',
  amount: 10,
  coinType: 0, // 0=PGC, 1=BTC, 2=ETH
});
console.log('交易ID:', result.txId);
```

---

## 联系与支持

如有问题，请联系 PanguPay 开发团队。
