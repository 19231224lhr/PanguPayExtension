# PanguPay 浏览器钱包扩展

> **盘古系统轻量级浏览器钱包插件**

---

## 项目简介

PanguPay 是盘古 UTXO 区块链系统的官方浏览器钱包扩展，参考 MetaMask、Rabby 等主流钱包的设计理念，为用户提供便捷的链上资产管理和 DApp 交互能力。

### 为什么需要浏览器扩展？

相比传统 Web 钱包，浏览器扩展具有以下优势：

- **随时可用**：无需打开独立网页，点击浏览器图标即可使用
- **DApp 连接**：第三方应用可通过标准 API 请求连接和签名
- **安全隔离**：私钥存储在扩展沙盒中，与网页环境完全隔离

### 核心功能

| 功能 | 说明 |
|:-----|:-----|
| 账户管理 | 创建/导入钱包，密码加密存储 |
| 资产查看 | PGC/BTC/ETH 多币种余额展示 |
| 快速转账 | 组织内即时确认（TXCer 特色） |
| 跨链交易 | BTC/ETH 跨链桥接转账 |
| 担保组织 | 加入/退出担保组织 |
| DApp 连接 | 标准 `window.pangu` API |

---

## 技术架构

采用 Chrome Manifest V3 标准，基于 Vite 构建：

```
浏览器环境
├─ Popup UI          # 弹窗界面（用户交互）
├─ Background        # Service Worker（核心逻辑）
├─ Content Script    # 消息桥接
└─ inject.js         # 注入 window.pangu（DApp API）
```

### 通信流程

```
网页 → Content Script → Background → Popup
        ↑                    ↓
        └────── 响应 ←────────┘
```

### 技术选型

| 项目 | 选择 | 理由 |
|:-----|:-----|:-----|
| UI 框架 | 原生 HTML+CSS+TS | 与主钱包一致，便于复用 |
| 构建工具 | Vite | 现代、快速 |
| 签名算法 | ECDSA P-256 | 与盘古系统一致 |
| 存储 | chrome.storage.local | 扩展专用安全存储 |

---

## 项目结构

```
PanguPayExtension/
├── manifest.json           # 扩展配置
├── package.json            # 依赖配置
├── vite.config.ts          # 构建配置
├── public/icons/           # 扩展图标
├── src/
│   ├── background/         # Service Worker
│   ├── content/            # Content Script + inject.js
│   ├── popup/              # 弹窗界面
│   │   ├── pages/          # 各页面组件
│   │   └── styles/         # 样式文件
│   └── core/               # 核心业务逻辑
│       ├── signature.ts    # 签名算法
│       ├── storage.ts      # 存储适配
│       ├── api.ts          # 后端通信
│       └── auth.ts         # 认证逻辑
├── demo/                   # DApp 演示页面
├── docs/                   # 文档
└── dist/                   # 构建产物
```

---

## 快速开始

### 1. 安装依赖

```bash
cd PanguPayExtension
npm install
```

### 2. 构建

```bash
# 开发模式（热更新）
npm run dev

# 生产构建
npm run build
```

### 3. 加载到浏览器

1. 打开 `chrome://extensions/`
2. 开启 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择 `dist/` 目录

---

## 文档导航

| 文档 | 说明 |
|:-----|:-----|
| [开发者接入指南](docs/GUIDE.md) | 网页如何接入钱包、如何使用 Demo 测试 |
| [DApp 连接技术文档](docs/DAPP_CONNECT.md) | 详细 API 参考、返回值、错误码 |

---

## 设计原则

1. **简洁优先**：只保留核心功能，界面简洁
2. **代码复用**：最大化复用主钱包 TransferAreaInterface 的核心逻辑
3. **安全第一**：私钥加密存储，交互式授权

---

## 参考项目

- [MetaMask Extension](https://github.com/MetaMask/metamask-extension)
- [Rabby Wallet](https://github.com/RabbyHub/Rabby)
- [Chrome 扩展开发文档](https://developer.chrome.com/docs/extensions/mv3/)

---

> **版本**: 1.0.0  
> **维护者**: PanguPay Team
