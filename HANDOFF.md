# 离火品宣工作台（marketing-platform）· 交接文件

> 最后更新：2026-10-13
> 写给第一次接手的开发者 / AI（Codex、Claude 等）。**先读本文件。**
> **维护规则：每次新增/修改功能，同步更新本文件（尤其「更新日志」），和代码一起提交。**

---

## 1. 一页看懂

- **是什么**：公司内部达人营销 / 品宣运营工作台（内部叫"离火"），管理达人、样品、内容排期、内容发布、结算、素材、ROI 和复盘。
- **线上**：https://pinxuan.shiganneibu.com （PWA）。brand-ops-platform 的「达人营销」菜单用 iframe 嵌入的就是它。
- **仓库**：https://github.com/banglongchen6-star/marketing-platform
- **路径**：`/Users/Admin/达人营销pinxuan.shiganneibu.com`
- **衍生产品**：`/Users/Admin/达人品宣工作台，打算多公司使用（对外）` 是从本项目 fork 的多公司 SaaS 版，**两者代码和数据完全独立**，本项目的重要修复（如防覆盖）通常需要同步过去。

## 2. 技术栈与结构

- 前端：**原生 HTML/CSS/JS 单页应用，无框架**。主体是 `extracted/media-workbench/index.html`（约 6300 行，内联样式和大量脚本），模块化 JS 在 `extracted/media-workbench/js/schedule/*.js`（排期、预算、达人库、Excel 导入导出、回收站、复盘日志等）
- 后端：`server.js`（Express，端口 3002）+ `sync-merge.js`（三方合并 + 操作日志）
- 存储：**单文件 JSON**：`db.json`（全部业务数据）、`logs.json`（操作日志，滚动 3000 条）、`backups/data-YYYY-MM-DD.json`（每日备份，保留 7 份）、`email-config.json`（备份邮件配置）。db.json / logs.json 在 .gitignore 里，**线上数据只在服务器上**
- 依赖：express、node-cron（定时邮件备份）、nodemailer；前端用 Chart.js、SheetJS

**菜单模块**：品宣ROI（dashboard）/ 数据看板（monthly-plan）/ 复盘总结（review-log）/ 样品管理 / 内容排期 / 内容发布 / 达人结算 / 素材管理 / 达人库 / 系统设置（仅管理员）

**接口**：`/api/login-options` `/api/login` `/api/data`(GET/POST，整库读写+合并) `/api/logs` `/api/backups` `/api/email-config` `/api/email-test`

## 3. 部署与运行

- **自动部署**：推 `main` → GitHub Actions SSH 到香港阿里云 `8.218.189.74` → `/root/marketing-platform` 里 `git pull` + `npm install` → root pm2 `marketing-platform` 重启 → 同一脚本幂等配置 nginx + HTTPS
- Secrets：`SSH_HOST` `SSH_USER` `SSH_PRIVATE_KEY`；运行时环境变量：`PORT` `ADMIN_PASS` `AUTH_TOKEN`
- **缓存版本号**：改 `index.html` 内联脚本无需处理；改 `js/schedule/*.js` 要在 index.html 里把引用的 `?v=N` 加 1
- 本地：`npm install && node server.js` → http://localhost:3002（本地没有线上 db.json）
- 同服务器还有 brand-ops(3000)、baoxiao-expense(3003) 等，**别动其它 pm2 进程**
- 部署验证坑：push 后马上 `gh run list --limit 1` 可能拿到上一次的 run，要核对 headSha 等于本次 commit

## 4. 铁律：多端保存绝不整包覆盖

- 背景：原来保存是整包覆盖，多人同时用会互相冲掉。2026-08-05 改为**三方合并**：GET 带 `_rev`，客户端保存回传 `_baseRev`，服务器用 base/server/client 按 id/字段合并（`sync-merge.js` 的 merge3）。
- **2026-09-02 事故**：一个开了很久的旧页面保存，基准超出快照窗口，旧代码退化成整包覆盖，把同事一上午的工作冲掉（已靠操作日志恢复）。
- **现行规则（任何人不得改回）**：服务器已有数据时，不带 `_baseRev` / 版本超出快照窗口 / 合并出错 → 一律 `409 + stale:true` 拒绝；客户端会带自己记住的基准 `_base` 重交，由服务器 merge3 自救合并，失败才提示刷新。快照窗口 100。页面唤醒/切回/联网时立即拉取；有未同步改动时只显示预警横幅不拉取。
- 副作用（正常）：pm2 重启后 rev 归 1，已打开页面下次保存会被要求刷新一次。

## 5. 其它约定

- 用户无编程基础：**改代码前先说明方案，用户回复单独的 `0` 才动手**；回复简短；界面电脑和手机都要照顾
- PWA 图标：maskable 图里"品"字占 56%（用户实测定的），主图标不动；换图标后已安装的 PWA 要删了重装才刷新
- 本机没有 PIL/ImageMagick，做图用浏览器 Canvas + sips

## 6. 已知问题 / 待办

- **安全**：`server.js` 里 `ADMIN_PASS`、`AUTH_TOKEN` 有硬编码的默认值，仓库里可见。线上应确认已用环境变量覆盖，并把默认值去掉
- **待用户拍板**：删除内容后刷新又"复活"——根因是 `data.js` 的 `autoPublishPastSchedules()` 会给"过期+已发布+无内容"的排期自动补建空内容。方案 A 删除时可选连排期一起删（推荐）/ B 标记删过不再补建 / C 关掉自动补建
- 仓库里残留不少调试文件（fix*.ps1、check-*.js、debug*.html、index.html.backup），已在 .gitignore，可清理

## 7. 更新日志（新的在上）

- 2026-10-13：新增本交接文件
- 2026-10-12：内容排期卡片重排；计划中排期可标记「已确认」（蓝边框）
- 2026-10-08~09：月历月份/星期栏吸顶；只显示本月日期
- 2026-09-28：月历显示去重达人数量
- 2026-09-14：maskable 图标定为 56%
- 2026-09-02：防覆盖铁律 + 路线 A（见第 4 节）
- 2026-08-05：三方合并 + 操作日志
- 2026-08-03：复盘总结自动带出每月核心四项数据（取自品宣ROI）
- 2026-07-30：数据看板、复盘总结、公司账号、达人结算多项调整
- 更早：见 git log
