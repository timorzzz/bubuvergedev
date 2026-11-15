# BL-20261115-02：订阅激活与线路就绪诊断

## 时间与基线

- 记录时间：2026-11-15 22:49:31 +08:00（Asia/Shanghai）。
- 主版本：1.0.6，未修改版本号。
- 当前代码基线：`9848412`。
- 用户提供的正常安装包：`Bluelayer_1.0.5+autobuild.0421.a83dc92_x64-setup`。
- 对照提交：`a83dc9278e89dffef96d9164fcb57c70d23257fa`，原提交时间为 2026-04-21 00:03:51 +08:00。
- 提交关联标识：`Change-Record: BL-20261115-02`；本记录建立时尚未提交。

## 用户反馈与阶段定位

用户已在 `profiles` 中看到正确且包含线路的订阅 YAML，但登录仍提示“线路尚未加载完成”。这条提示在文件下载与保存之后出现，表示程序未能确认内核已经返回可用线路，不能据此判断订阅文件有误。

流程为：下载订阅、保存文件、激活当前配置、生成与验证运行配置、应用到内核、查询内核中的线路。文件正确只能证实前面的步骤。

## 与正常版本的比较

- 对比 Git 源码，`a83dc92` 与 `2545970` 的 `waitForProxyReady`、`ensureManagedProfile` 实现相同。
- 对 `calcuProxies`、`calcuProxyProviders` 做 TypeScript 语法树比较，`a83dc92` 与 `9848412` 相同，差异为格式化。
- 配置管理器的 300 毫秒防抖在正常版本中也存在。因此，不能将短等待、防抖或辅助提供者查询称为近期新增的确定回归原因。
- 正常版本之后的实际功能改动包括 Bluelayer 服务隔离、默认运行端口调整、运行配置端口同步、面板请求改为后端 HTTP，以及认证退出时关闭代理等。
- 仅凭正确的订阅文件与静态源码，尚不能确认用户机器上具体哪项变化触发问题。新增的脱敏日志用于区分真实失败阶段，不把推测当作已验证根因。

## 已确认的代码缺陷与修改

1. 旧就绪检查只查询四次，每次预先等待 600 毫秒，并吞掉查询异常。改为立即查询，最长等待 15 秒；单次查询最长等待 2 秒，检查之间间隔 500 毫秒。正常就绪不需等待完整时限。
2. 旧检查调用 `calcuProxies`，同时依赖内核线路与辅助 provider API；辅助查询失败也会阻止登录。改为只使用内核 `getProxies` 判断线路是否就绪；不修改现有线路页的数据整理函数。
3. 原程序忽略 `patchProfilesConfig` 返回的 `false`。现在明确检查结果，激活未成功时显示对应提示并记录 `activation_rejected`。
4. 配置防抖可能跳过刚导入的订阅加载但仍返回成功。为管理订阅激活增加显式 `force` 参数，通过现有配置生成、验证、应用流程立即加载；其他调用默认仍保留原有行为。
5. 去掉激活后紧接着进行的重复 `enhanceProfiles` 调用。内核中仅有 DIRECT 等内置目标时，不再误判为已加载出真实线路。
6. 超时提示区分“内核尚未加载出可用线路”与“暂时无法读取内核线路”，同时说明订阅已经保存。

## 脱敏日志

新增日志通过现有日志组件写入 `logs/latest.log`，保留现有轮转设置。Windows 正式版默认位置为：

```text
%APPDATA%\uk.bluelayer.client\logs\latest.log
```

开发版使用对应的 `.dev` 数据目录；便携模式仍遵循应用现有数据目录规则。

- 统一前缀：`[BluelayerDiag]`。
- 记录范围：面板探测失败、登录失败、会话恢复失败、订阅下载失败、配置保存失败、配置激活失败、内核线路就绪失败，以及重试后恢复。
- 前端仅传固定枚举和数字计数；后端使用 `deny_unknown_fields` 拒绝额外字段。
- 新增诊断不记录账号、邮箱、密码、Cookie、Token、请求/响应正文、完整 URL、订阅地址、节点名、配置文件内容和本地用户路径。此约束针对本次新增诊断，未对历史所有日志做重写。
- HTTP 失败仅记录固定操作类别、直连或系统代理、失败类别、状态码与耗时；成功 HTTP 请求不逐条输出。

日志阶段说明：

| 阶段/类别 | 含义 |
| --- | --- |
| `subscription_download` | 下载失败或订阅内容不完整。 |
| `profile_save` | 保存或读取配置列表失败。 |
| `profile_activate` / `activation_rejected` | 配置切换被拒绝、验证未通过或更新失败。 |
| `core_ready` / `empty_proxies` | 内核能响应，但没有返回可用线路。 |
| `core_ready` / `ipc`、`timeout` | 读取内核线路发生通信错误或超时。 |
| `subscription_sync` / `retry` | 正在进行已有的第二次订阅同步尝试。 |
| `http_failed` | 后端 HTTP 请求异常；附带状态码或固定失败类别。 |

## 涉及文件

- `src/services/bluelayer.ts`：阶段诊断、激活返回值检查、线路就绪检查与分阶段错误提示。
- `src/services/cmds.ts`：脱敏日志命令和可选的强制激活参数。
- `src/utils/bluelayer-diagnostics.ts`：固定错误分类、线路计数与有时限的就绪检查。
- `src-tauri/src/cmd/bluelayer_diagnostics.rs`：只接受枚举和数字的日志命令，以及 HTTP 错误摘要。
- `src-tauri/src/cmd/app.rs`：失败 HTTP 请求接入脱敏诊断。
- `src-tauri/src/cmd/mod.rs`、`src-tauri/src/lib.rs`：命令注册。
- `src-tauri/src/cmd/profile.rs`、`src-tauri/src/core/manager/config.rs`：管理订阅立即激活，继续执行原有配置验证和应用。
- `scripts/tests/bluelayer-diagnostics.test.mjs`：12 项就绪与隐私回归测试。
- `Changelog.md`、本记录及记录索引：保存本次用户更新说明和回溯资料。

## 已完成验证

- `node --test scripts/tests/bluelayer-payload.test.mjs scripts/tests/bluelayer-diagnostics.test.mjs`：19 项通过。
- `cargo test -p bluelayer --lib cmd::bluelayer_diagnostics::tests --features clippy`：2 项通过，验证后端拒绝自由文本与未知类别、仅保留枚举和计数。
- `pnpm typecheck`：通过。
- 修改过的 TypeScript 和测试文件严格 ESLint 检查：通过。
- `pnpm web:build`：TypeScript 检查和 Vite 生产构建通过。
- `cargo clippy --all-targets --all-features -- -D warnings`：通过。
- `git diff --check`：通过。
- 上述正常版本对比直接读取 Git 历史，并对关键函数进行了语法树比较。

用户机器复现、真实账号登录、三端安装包验证仍待完成；不能用本地单元测试替代这些结果。

## 回溯

```powershell
git log --all --fixed-strings --grep="Change-Record: BL-20261115-02" --format="%h %aI %s"
git diff a83dc92 9848412 -- src-tauri/src/core/manager/config.rs src-tauri/src/constants.rs
```

提交后需要撤销本次修改时，先保存本地工作，按记录编号定位提交，再执行 `git revert`。需要检查正常版本时可独立检出：

```powershell
git worktree add --detach ../bluelayer-inspect-a83dc92 a83dc92
```

不要直接覆盖现有配置目录或清除用户的订阅、服务、系统代理设置，以免破坏比较依据。

## 提交准备

- 2026-11-15 22:52:59 +08:00：用户要求提交并推送本次修复，供安装包编译测试。提交正文使用上述记录编号关联；实际提交时间与哈希以 Git 历史为准。
- 已完成的检查见本记录；推送前继续执行仓库既有提交检查与推送检查，不跳过钩子。用户机器上的真实登录验证仍待完成。
