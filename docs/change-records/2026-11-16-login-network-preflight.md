# BL-20261116-01：启动登录服务检测与可操作的网络提示

## 时间与基线

- 记录时间：2026-11-16 00:51:53 +08:00（Asia/Shanghai）。
- 验证补充时间：2026-11-16 00:55:03 +08:00（Asia/Shanghai）。
- 应用版本：1.0.6，未提升版本，未改动依赖锁定版本。
- 基线提交：`f956a23`。
- 提交关联标识：`Change-Record: BL-20261116-01`。
- 用户报告：上一轮修复后的 Windows 版本可以正常登录和使用。这是用户实测反馈，不代表 macOS/Linux 已实测通过。

## 原因

启动后的背景面板解析失败会被静默忽略；面板与 UI 配置缓存命中也不代表当前能实际连通服务。用户在尚未联网、DNS 故障、超时或面板服务异常时只能看到笼统的登录失败。`Promise.any` 的聚合错误还可能丢失具体原因，Reqwest 外层字符串则可能隐藏 DNS/TLS 原因。

原有临时备用地址会被保存为 30 分钟的正常地址列表缓存，也不利于恢复联网后重新发现面板。

## 行为变化

1. 未登录时先展示可输入的登录页，在后台请求真实 `/v1/config`，而不是仅依赖缓存、接口地址存在或 WebView 的在线标记。
2. 显示“正在检测登录服务连接”“登录服务连接正常”，或按离线线索、DNS、安全连接、超时、服务状态、异常内容等原因给出建议。检测服务异常不等同于账号密码错误。
3. 检测失败时提供“重新检测”；手动检测刷新远程面板地址列表。登录页监听网络状态事件，并在检测失败后每 15 秒自动重试。登录成功后停止该重试。
4. 实际服务请求成功优先于 WebView 的离线提示；只有请求失败时才结合该提示，不因某个平台的在线标记不准确而直接禁止登录。
5. 检测期间重复调用复用同一请求。登录复用最近 30 秒的成功结果；过期、失败或仍在进行时重新检查或等待已有检查。检查后才断网也返回网络说明，而不是账号错误。
6. 验证配置的必要结构，避免把网页认证、非面板 JSON 或其他异常内容当成服务正常；保留原有可选空配置和空 UI 字段的支持。此判断只提示网络“可能”需要网页认证，不声称已经确定具体网络故障。
7. 不再将临时备用地址写入 30 分钟的正常列表缓存；远程刷新失败时仍可保留有效的已有配置或尝试原有备用地址。
8. 区分服务端明确的账号拒绝与传输错误，保留账号密码错误原文；没有服务端说明时提供可操作的验证未完成提示，不猜测为密码错误。新传输错误仅返回固定分类码；深入检查错误链和 `io::Error` 包装以保留 TLS 原因。
9. 登录表单允许内部滚动，避免新增说明挤掉固定窗口内的登录、注册或客服入口。
10. 在现有 `logs/latest.log` 中增加 `network_check` 的成功/失败、固定原因和耗时；不记录原始异常、域名、账户、密码、Cookie、令牌或订阅内容。

检测仅使用已有配置源和面板，不增加第三方测速站点，不更改系统网络接口、DNS、防火墙或代理设置。原有 7 天会话、登录订阅、内核线路、系统代理与 TUN 开关逻辑不变。

## 涉及文件

- `src/services/bluelayer.ts`：后台预检、真实配置探测、缓存与登录衔接。
- `src/utils/bluelayer-diagnostics.ts`：连接状态、固定提示、聚合错误分类及预检请求复用。
- `src/components/bluelayer/bluelayer-gate.tsx`：状态显示、重新检测、网络事件与重试、表单滚动。
- `src/services/cmds.ts`：诊断阶段类型。
- `src-tauri/src/cmd/app.rs`、`src-tauri/src/cmd/bluelayer_diagnostics.rs`：固定传输错误、跨平台原因分类及诊断枚举。
- `scripts/tests/bluelayer-network.test.mjs`：纯函数和实际服务模块的隔离回归测试；原生 HTTP、存储与账户数据均使用内存替身。
- `.github/workflows/autobuild.yml`、`.github/workflows/release.yml`：三端矩阵和 Windows WebView2 打包前运行登录网络回归测试。
- `.github/workflows/frontend-check.yml`：增加同一测试，并将 `.mjs` 纳入变更检测。
- `Changelog.md`、变更记录索引和本记录。

## 已执行验证

- `node --test scripts/tests/bluelayer-payload.test.mjs scripts/tests/bluelayer-diagnostics.test.mjs scripts/tests/bluelayer-network.test.mjs`：36 项通过。其中新增 14 项覆盖缓存不能代替实际探测、离线恢复、地址刷新、单个面板可用、账号拒绝、登录前后网络变化、异常配置、合法空配置和重复请求复用。
- `cargo test --offline --locked -p bluelayer --lib cmd::bluelayer_diagnostics::tests`：5 项通过，包括固定分类、诊断隐私、回环连接失败和本机受控 TLS 失败。Windows 回环端口关闭可表现为连接失败或超时，测试按实际传输结果验证，不强行归为一种。
- `pnpm typecheck`、修改文件的严格 ESLint、`pnpm web:build`、`cargo clippy --offline --all-targets --all-features -- -D warnings`：通过。
- `cargo test --offline --locked -p bluelayer-core-snapshot --lib`：原有 7 项通过；实际内核测试默认忽略，由下列脚本运行。
- `node scripts/tests/core-snapshot-smoke.mjs x86_64-pc-windows-msvc`：真实隔离内核读取测试通过，测试内核已由脚本关闭并清理临时目录；未访问用户账户或改动系统代理。
- `cargo check --offline --locked -p bluelayer-core-snapshot --all-targets --target <target>`：macOS ARM、macOS Intel、Linux x64 均通过。这仅检查原有独立 IPC 模块及其测试，不是完整客户端或本轮原生 HTTP 模块的跨平台运行证明。
- 使用 `js-yaml` 解析三个修改的工作流并检查打包关卡，结果通过。
- 保留已有子包 profile 位置和 Browserslist 数据过旧警告，不为消除警告升级依赖。

新增前端与原生分类逻辑没有 Windows 专属命令，沿用三端共用的 Reqwest/Rustls 和 WebView API。三端的网络回归测试已接入打包流程，但本轮未在 macOS/Linux 实机启动完整客户端，也未用真实账号测试。上面的隔离故障测试不能替代用户机器的网络复测或安装包验证。

## 查看与回溯

Windows 正式版仍在 `%APPDATA%\uk.bluelayer.client\logs\latest.log` 查看 `[BluelayerDiag]`：

- `network_check`：启动或重新检测的结果与耗时。
- `panel_resolve`：全部候选面板解析失败的固定原因。
- `http_failed`：固定操作类别、传输方式、原因及状态码；新增 DNS/TLS 分类。

```powershell
git log --all --fixed-strings --grep="Change-Record: BL-20261116-01" --format="%h %aI %s"
git diff f956a23 HEAD -- src/services/bluelayer.ts src/utils/bluelayer-diagnostics.ts src/components/bluelayer/bluelayer-gate.tsx
```

记录建立时尚未提交或推送。提交时使用上述关联标识；如后续需撤销已发布的提交，先保存本地工作，再对匹配编号的提交使用 `git revert`，不要删除账户、配置或订阅文件。
