# 账本

一个纯静态的个人记账 PWA：无框架、无构建步骤，数据存在浏览器本地（IndexedDB），添加到 iPhone 主屏幕后可完全离线使用。

## 文件

```
ledger/
├── index.html            页面结构
├── app.js                全部逻辑（IndexedDB、记账、图表、备份）
├── style.css             样式（Claude 暖色 / 深色模式 / 安全区）
├── manifest.webmanifest  PWA 清单
├── sw.js                 Service Worker（离线缓存）
├── icons/
│   ├── icon-180.png      iOS 主屏图标（apple-touch-icon）
│   ├── icon-192.png
│   └── icon-512.png
├── tools/
│   └── make-icons.js     重新生成图标：node tools/make-icons.js
└── README.md
```

`tools/` 只在本地用，部署时可以不管。

## 本地预览

Service Worker 和 IndexedDB 需要 http(s)，**不要直接双击 index.html**。

```bash
cd ledger
python -m http.server 8123
# 打开 http://localhost:8123
```

或者 `npx serve .`。

## 部署到 GitHub Pages

### 方式 A：网页上传（不用 git）

1. 登录 GitHub，新建仓库，例如 `ledger`，选 **Public**。
2. 进入仓库，点 **Add file → Upload files**，把 `index.html`、`app.js`、`style.css`、`manifest.webmanifest`、`sw.js`、`.nojekyll` 和 `icons/` 文件夹拖进去，提交。
3. 仓库 **Settings → Pages**：
   - Source 选 **Deploy from a branch**
   - Branch 选 **main**，文件夹选 **/ (root)**
   - 点 **Save**
4. 等 1～2 分钟，访问 `https://你的用户名.github.io/ledger/`

### 方式 B：git 命令

```bash
cd D:\Claude\ledger
git init
git add .
git commit -m "init ledger"
git branch -M main
git remote add origin https://github.com/你的用户名/ledger.git
git push -u origin main
```

然后同样在仓库 **Settings → Pages** 里选择 `main` / `(root)`。

> 所有资源都用相对路径，部署在 `用户名.github.io/ledger/` 这种子路径下也能正常工作。

## 部署到 Cloudflare Pages

### 方式 A：直接上传（最快）

1. 登录 Cloudflare Dashboard → **Workers & Pages → Create → Pages → Upload assets**。
2. 项目名填 `ledger`，把整个 `ledger` 文件夹（不含 `tools` 也行）拖进去。
3. 点 **Deploy**，得到 `https://ledger-xxx.pages.dev`。

### 方式 B：连接 Git 仓库

1. 先把代码推到 GitHub（同上）。
2. Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git**，选择仓库。
3. 设置：
   - Framework preset：**None**
   - Build command：**留空**
   - Build output directory：**/**
4. 点 **Save and Deploy**。

Cloudflare Pages 的域名可以直接使用；也可以绑定自己的域名（需要 HTTPS，PWA 必需）。

## 在 iPhone 上安装

1. 用 **Safari** 打开部署后的网址（微信内置浏览器、Chrome iOS 都不支持添加到主屏的独立模式）。
2. 点底部工具栏的 **分享** 按钮（方框加向上箭头）。
3. 选择 **添加到主屏幕**。
4. 名称保持「账本」，点 **添加**。
5. 回到主屏幕，打开「账本」图标。**首次打开时保持联网**，等页面加载完，Service Worker 会把应用外壳缓存下来。
6. 验证离线：开飞行模式，再从主屏打开「账本」，应能正常进入。

> **重要**：先添加到主屏幕，再开始记账。iOS 上 Safari 标签页里的数据与主屏 Web App 的数据是分开存放的，在 Safari 里记的账不会出现在主屏应用里。

## 备份与恢复

数据只存在这台设备上，删掉应用或换手机就没了。

- **导出**：设置 → 导出 JSON / 导出 CSV。
  - 会优先弹出 iOS 分享面板，可以选「存储到文件」、发给自己的微信、AirDrop 到电脑等。
  - 不支持分享的环境会自动退回到普通下载。
  - 导出的 JSON 包含全部账目和自定义分类，是完整备份。
  - CSV 带 UTF-8 BOM，用 Excel / Numbers 打开中文不会乱码。
- **恢复**：设置 → 导入 JSON 备份，选择之前导出的 JSON。按记录 `id` 合并去重，重复记录不会重复导入。
- 超过 **7 天**没有导出，打开应用时顶部会出现醒目提醒。

建议：每次记完一个月的账，或者每月 1 号，导出一次 JSON，存到「文件」或网盘。

## 用 Claude 分析账目

设置 → **复制分析提示词**。会把最近三个月的账目明细、分类汇总和一段分析指令拼好复制到剪贴板，打开 Claude App 粘贴即可。

## 更新应用

1. 修改文件后，把 `sw.js` 顶部的 `VERSION = 'v1'` 改成新值（例如 `v2`）。
2. 重新部署。
3. 手机上重新打开应用，会提示「已更新」，关掉再打开即可用新版本。

**不更新 `VERSION` 的话，已安装的 PWA 会继续用旧缓存。**

## 说明

- 数据存于 IndexedDB，不使用 localStorage。
- 启动时请求 `navigator.storage.persist()`（iOS 支持有限，浏览器会自动管理）。
- 不连接任何第三方服务、不上报数据、不调用 API。
- 深色模式跟随系统。
- 需要 HTTPS（`localhost` 除外），GitHub Pages 和 Cloudflare Pages 默认都是 HTTPS。
