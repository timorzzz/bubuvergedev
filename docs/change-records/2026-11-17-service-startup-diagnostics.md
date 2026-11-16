# BL-20261117-02：服务启动就绪修复与三端失败诊断

## 时间与基线

- 记录时间：2026-11-17 01:13:12 +08:00，Asia/Shanghai。
- 应用版本：1.0.6，未升级依赖、内核或最低系统版本。
- 基线提交：`9ee8c10`；开始修改前工作区干净。
- 提交关联标识：`Change-Record: BL-20261117-02`。

## 用户反馈与确认范围

用户反馈安装虚拟网卡服务时提示 `Install Service failed: IPC path not ready`，客户端日志未包含进一步原因。用户随后确认仍发生在 macOS Intel；本轮未取得完整安装包文件名或这次故障的详细运行日志。

该提示来自安装器结束后的 IPC 就绪检查，不等于原先的可执行文件架构错误再次发生，也不能据此认定权限、系统安全策略或某一条系统命令是用户机器上的最终根因。以下为本轮源码确认的缺陷及修复，最终仍须新包实测。

## 已确认的代码缺陷

1. macOS 安装器忽略 `chmod`、`chown` 和多条 `launchctl` 命令的失败，系统注册或启动失败后仍可能退出为成功。
2. macOS 安装器先覆盖已安装服务文件，之后才卸载旧服务，安装顺序不稳妥。
3. Unix 服务把异步 socket 创建当作固定 50 毫秒内完成；超时机型可能在设置 socket 权限时返回 NotFound，导致服务退出。
4. GUI 的最终等待错误只保留 `IPC path not ready`；命令返回错误没有统一收集系统服务状态，也没有捕获 launchd 丢弃的服务启动标准错误。
5. Windows 命名管道被放入文件路径存在性检查，可能在实际连接之前误判服务不可用。

## 行为变化

- macOS：先查询并卸载已注册的 Bluelayer 服务，再替换文件。权限、所有权、启用、bootstrap 和注册检查均传播失败；保留阶段上下文及底层错误。首次没有注册服务允许继续。使用既有 RunAtLoad 启动，不重复 kickstart，不卸载其他软件的服务。
- macOS/Linux：服务 socket 权限设置改为最多等待 5 秒的异步就绪检测；只重试 NotFound，权限错误立即报告，监听任务提前退出时返回其错误，而不是无条件睡眠 50 毫秒。
- 三端：安装、重装和修复后最多等待 15 秒的真实 IPC 握手；每次连接最多 750 毫秒。服务可用性查询也有 750 毫秒上限，Unix 仍快速检查本地 socket，Windows 不再用文件元数据代替命名管道连接。保留最后一次有意义的失败，不在期限结束后再发起一次零时长查询覆盖它。
- 三端：统一服务操作失败日志入口，既覆盖 UI 安装命令，也覆盖后台重装。`[ServiceDiag]` 记录操作、平台、架构、完整脱敏错误链、重试次数和耗时、IPC 元数据错误码；Unix 另记 UID/GID/权限。
- 系统状态仅查询 Bluelayer：macOS 的 `uk.bluelayer.client.service`、Windows 的 `bluelayer_mihomo_service`、Linux 的 `bluelayer-mihomo-service.service`。只读取固定状态字段，不写入完整环境变量、命令配置或其他应用信息；状态命令最多 3 秒并在超时取消。
- macOS：launchd 的 StandardErrorPath 指向 `/Library/Logs/Bluelayer/service-startup.log`。安装时重置该文件，目录为 root:wheel 0755，文件为 root:调用者主组 0640；拒绝目录/文件符号链接。不收集会输出核心配置的标准输出。失败时最多读取文件末尾 8 KiB、最多 12 行，脱敏后写入客户端现有 `logs/latest.log`。此系统 stderr 文件用于启动故障排查，不替代内核流量日志，不存储登录凭证。
- 脱敏覆盖当前用户主目录、常见用户路径、URL、邮箱及凭证赋值；限制长度，不把请求响应、订阅内容、账户或环境变量整段写入诊断。
- Auto Build/Release 的常规三端及 WebView2 构建都增加本机服务启动与安装失败处理单元测试。macOS/Linux 会额外运行延迟创建真实 Unix socket 的测试。

不修改登录、七天 session、订阅、线路选择、代理规则、TUN 配置内容、UI、窗口尺寸、原版 Clash Verge 隔离名称和既有服务安装资源架构校验。Windows/Linux 的提权、安装/卸载命令不变；仅增加失败输出脱敏及共同的连接就绪检测。

## 涉及文件

- `crates/clash-verge-service-ipc/src/bin/install_service.rs`、`src/bin/install_service/macos.rs`：macOS 安装顺序、严格错误处理与可注入测试。
- `crates/clash-verge-service-ipc/src/core/readiness.rs`、`src/core/server.rs`、`src/core/mod.rs`：异步 socket 启动就绪检测及测试。
- `crates/clash-verge-service-ipc/resources/launchd.plist.tmpl`、`src/lib.rs`：启动错误文件、共享路径常量及模板测试。
- `src-tauri/src/core/service.rs`、`service_diagnostics.rs`、`mod.rs`、`src-tauri/src/cmd/service.rs`：限时真实连接、统一诊断和脱敏错误显示。
- `.github/workflows/autobuild.yml`、`release.yml`、`scripts/tests/service-architecture.test.mjs`：三端原生测试及工作流接线校验。
- `Changelog.md`、变更索引与本记录。

## 已执行验证

本机 Windows，以下是实际命令结果，不是 macOS/Linux 实机运行结果：

- `cargo test --offline --locked -p clash_verge_service_ipc --features standalone --lib --bin bluelayer-mihomo-service-install`：9 项通过，包括慢就绪、超时、权限、监听异常、安装各步骤失败和日志模板。另 1 项真实 Unix socket 延迟创建测试仅在 Unix 编译与执行，本机未执行。
- `cargo test --offline --locked -p bluelayer --lib core::service_diagnostics::tests`：5 项通过，包括阶段/退出码保留、个人信息脱敏、多词凭证过滤、三端状态字段与长度上限。
- `cargo test --offline --locked -p clash_verge_service_ipc --features standalone,client,test --test test_start_and_parse`：2 项通过；实际使用隔离的 Windows 测试命名管道完成服务连接和版本读取，未安装或操作系统服务。
- `cargo test --offline --locked -p bluelayer-core-snapshot --lib`：12 项通过，1 项实际内核测试按设计忽略；随后 `node scripts/tests/core-snapshot-smoke.mjs x86_64-pc-windows-msvc` 的真实 Mihomo 测试通过。
- 原有四个 JS 回归文件联合 `node --test`：48 项通过；架构测试现同时检查 Auto Build/Release 的所有打包作业都接入服务回归测试。
- `cargo check --offline --locked -p clash_verge_service_ipc --features standalone --bins --target <target>`：Intel macOS、ARM macOS、Windows x64、Linux x64 四目标均通过，涵盖三个生产服务可执行文件。
- `cargo clippy --offline --locked -p clash_verge_service_ipc --features standalone,client,test --all-targets [--target <target>] -- -D warnings`：Windows 宿主、Intel macOS、ARM macOS、Linux x64 均通过，包含 Unix 专用测试的交叉编译检查。
- `cargo clippy --offline --locked -p bluelayer --all-targets --all-features -- -D warnings`：通过。
- 修改 JS 测试的严格 ESLint、修改 Rust 文件的 rustfmt 检查、`git diff --check`：通过。

最初以仅 `standalone` 加 `--all-targets` 检查既有集成测试时，发现测试本身还需要 `client,test` 功能；改用完整测试功能组合后检查通过，未为此增加依赖或更改生产特性。既存的子包 profile 警告未在本轮修改。

尚未执行：macOS/Linux 全应用原生构建、macOS Intel/ARM 的权限提升安装及 TUN 联网实测、Linux 系统服务安装实测、最终安装包测试。Unix socket 测试和 launchd 诊断采集必须在新 CI/新包中进一步确认；不能把交叉编译检查写成三端运行保证。

## 实测与回滚

- 新包需要重新安装/修复服务，更新已安装的服务程序和 launchd plist；仅覆盖应用后继续运行旧服务，不能验证本轮完整修复。
- 若仍失败，获取新运行的 `logs/latest.log` 中 `[ServiceDiag]` 段，区分命令失败、未注册、启动退出、socket 不存在及权限拒绝。不要要求用户删除订阅、账户配置或关闭系统安全机制。
- 记录对应提交可用 `git log --all --fixed-strings --grep="Change-Record: BL-20261117-02" --format="%h %aI %s"` 查询。
- 已发布后使用 `git revert` 回滚关联提交，不重写共享历史、不丢弃无关本地修改。回滚后重新构建并修复服务以更新已安装的 plist/服务文件；保留日志用于排查，不自动删除用户配置或系统日志目录。回滚会恢复原先的宽松安装结果和固定等待隐患。

参考：[Apple launchd 创建与诊断说明](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)，包括系统服务目录、RunAtLoad/KeepAlive 和 StandardErrorPath。具体故障原因仍以本轮新诊断为准。
