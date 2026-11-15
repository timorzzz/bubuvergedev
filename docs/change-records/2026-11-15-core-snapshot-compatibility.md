# BL-20261115-03：内核线路读取兼容与诊断修正

## 时间与基线

- 记录时间：2026-11-15 23:34:42 +08:00（Asia/Shanghai）。
- 三端验证与打包关卡补充时间：2026-11-15 23:52:56 +08:00（Asia/Shanghai）。
- 主版本：1.0.6，未提升主版本号。
- 基线提交：`9fe257e`。
- 用户测试版本：`1.0.6+autobuild.1115.9fe257e`。
- 提交关联标识：`Change-Record: BL-20261115-03`。

## 本轮日志证据

用户反馈上一轮修复后仍报错。本轮读取其提供的日志，确认：

- 23:17:12 与 23:17:34，两次配置验证都成功，随后均出现 `Configuration applied`。
- 两次激活后的线路检查在 15 秒内分别尝试约 29、30 次；先报告 `unknown`，后报告 `timeout`。
- 若只是内核返回正常但没有节点，现有代码会报告 `empty_proxies`。当前日志不支持“已确认内核实际返回零节点”的结论；零计数也可能只是查询失败、尚未更新计数。
- 因此，本轮问题集中在线路读取或解析链路，继续增加等待时间不足以解决它。
- 上轮诊断缺少对原生响应解码错误的分类；最后一个仅剩极短时间的查询还可能把前面有价值的错误覆盖成超时。

记录只保存上述脱敏事实，不复制用户完整日志、配置标识和本地个人目录。

## 兼容问题调查

当前 Mihomo 插件的线路模型会强制解析协议枚举、非必要元数据和窄范围的 `routing-mark`。构建脚本则会查询最新稳定内核。通过独立测试确认，缺失元数据、新增协议类型、较大路由标记都可能导致旧模型拒绝一个仍包含有效线路的响应。

这些测试证明兼容风险真实存在，但用户日志没有保留原始解码错误，尚不能断言其机器具体遇到了哪个字段变化，或排除插件调用、连接池等读取环节的异常。本轮修复绕开这一读取层，并保留更准确的固定错误分类供复测。

## 本次修改

1. 新增 `read_bluelayer_core_snapshot`，只接受 `proxies`、`providers` 两个固定类别，不接受任意 URL 或路径。
2. 使用 Bluelayer 现有 IPC 路径读取 `/proxies` 与 `/providers/proxies`。Windows 使用命名管道，macOS/Linux 使用 Unix socket；每次读取有两秒超时，并在完成或取消时清理连接任务。
3. 使用通用 JSON 解析、必要结构校验和字段补全。保留协议名、节点名、代理组目标和数值；不因旧枚举或缺少非必要元数据而丢弃全部线路。
4. 登录就绪检查与线路页共用新读取方式。原有节点选择、配置激活、代理和 TUN 控制逻辑保持现状。
5. 增加 `invalid_payload`、`permission_denied` 等明确分类，识别字符串和带 `message` 的错误对象。
6. 剩余时间不足时不再启动新的短查询，防止末次超时覆盖此前的解析错误。
7. 新增日志继续使用 `[BluelayerDiag]`，原生日志只输出固定操作、固定错误码和耗时，不输出原始响应、IPC 路径、订阅和账户信息。
8. 将通信和规范化实现拆成不依赖 GUI 的 `bluelayer-core-snapshot` 工作区模块，便于独立检查 Windows、macOS Intel/ARM 与 Linux x64 分支。沿用现有锁定依赖，不升级 Tauri、插件或内核版本。
9. Auto Build 和 Release Build 的常规三端矩阵及 Windows WebView2 作业均增加打包前关卡：宿主原生 IPC 测试、安装包目标编译检查、实际打包内核的隔离冒烟测试。任一关卡失败，当前作业停止打包。
10. 隔离冒烟脚本使用无账号配置、独立临时目录和独立 IPC 地址，不修改用户配置或系统代理。结束时关闭自己启动的内核，只清理自己创建并核验路径的临时目录。

## 涉及文件

- `crates/bluelayer-core-snapshot/`：固定端点本地 IPC 读取、JSON 规范化、Windows/Unix 通信与结构回归测试。
- `src-tauri/src/cmd/core_snapshot.rs`：应用现有 IPC 地址接入、脱敏日志及与旧严格模型的对照测试。
- `src-tauri/src/cmd/mod.rs`、`src-tauri/src/lib.rs`：命令注册。
- `Cargo.toml`、`src-tauri/Cargo.toml`、`Cargo.lock`：注册独立模块；模块直接使用锁文件已有的 `hyper`、`hyper-util`、`http-body-util`，未升级这些库的锁定版本。
- `src/services/cmds.ts`：线路与 provider 数据读取接入新命令。
- `src/services/bluelayer.ts`：登录就绪检查共用上述入口。
- `src/utils/bluelayer-diagnostics.ts`、`src-tauri/src/cmd/bluelayer_diagnostics.rs`：错误分类与枚举同步。
- `scripts/tests/bluelayer-diagnostics.test.mjs`：增加解码错误、权限错误及末次超时不覆盖前因的回归测试。
- `scripts/tests/fixtures/mihomo-ipc-smoke.yaml`：无账号的隔离测试配置，关闭代理监听和 DNS 服务，仅包含本机测试节点。
- `scripts/tests/core-snapshot-smoke.mjs`：三端实际内核的独立启动、测试与清理。
- `.github/workflows/autobuild.yml`、`.github/workflows/release.yml`：增加上述原生、目标编译及实际内核测试关卡。
- `Changelog.md`、记录索引及本记录：更新发布说明与回溯依据。

## 验证

- `node --test scripts/tests/bluelayer-payload.test.mjs scripts/tests/bluelayer-diagnostics.test.mjs`：22 项通过。
- `cargo test --offline --locked -p bluelayer-core-snapshot --lib`：7 项通过，1 项实际内核测试按设计默认忽略、由下述脚本单独运行。覆盖 Windows 命名管道实际收发、分块 HTTP、两个固定端点、错误状态、结构校验、权限分类及有界超时。
- `node scripts/tests/core-snapshot-smoke.mjs x86_64-pc-windows-msvc`：真实内核测试 1 项通过；本机现有 Mihomo v1.19.22 的线路、代理组选择及 provider 数据均可读取。测试启动和关闭独立内核，不修改系统代理。
- `cargo test --offline --locked -p bluelayer --lib cmd:: -- --skip reads_real_mihomo_snapshot`：8 项通过，包含旧模型对照与两项诊断隐私测试。
- `cargo check --offline --locked -p bluelayer-core-snapshot --all-targets --target <target>`：分别对 `aarch64-apple-darwin`、`x86_64-apple-darwin`、`x86_64-unknown-linux-gnu` 通过；包括 Unix socket 测试分支的静态编译检查，不是对应系统的运行测试。
- `pnpm typecheck`、修改文件严格 ESLint（包含新增冒烟脚本）、`pnpm web:build`、`cargo clippy --offline --all-targets --all-features -- -D warnings`：通过。
- 使用 `js-yaml` 解析两个工作流并检查各自两个打包作业：YAML 合法，三个测试关卡均在打包步骤前。
- 测试与构建仍提示已有的子包 profile 位置和 Browserslist 数据过旧警告，均非本轮编译错误；未为消除提示而升级依赖。
- 不提交内核二进制、构建产物或运行缓存。冒烟脚本临时目录在测试后清理。

本次本机真实 IPC 测试仅覆盖 Windows 现有内核。macOS/Linux 的原生运行和相应打包内核测试已配置到 CI，尚未在本机执行；完整客户端启动、真实账户登录、用户机器与其他内核版本仍待安装包验证。不把交叉编译或模拟响应测试写成用户故障的完全复现，也不把 Windows 结果当作三端运行通过。

## 日志读取

Windows 正式版仍为 `%APPDATA%\uk.bluelayer.client\logs\latest.log`。

- `snapshot_failed`：新的本地读取失败。
- `core_snapshot:ipc`：建立或读取 IPC 连接失败。
- `core_snapshot:timeout`：本地读取超时。
- `core_snapshot:invalid_payload` / `invalid_shape`：JSON 或必要结构不符合要求。
- `core_snapshot:http`：本地控制接口返回非成功状态或请求构造失败。
- `core_snapshot:permission_denied`：本地 IPC 打开被操作系统拒绝。

## 回溯

```powershell
git log --all --fixed-strings --grep="Change-Record: BL-20261115-03" --format="%h %aI %s"
git diff 9fe257e HEAD -- src/services/cmds.ts src-tauri/src/cmd/core_snapshot.rs
```

需要撤销时先保存本地工作，找到带上述编号的提交后执行 `git revert`。该操作会恢复旧插件的线路读取方式；不应删除现有订阅文件或用户数据目录。
