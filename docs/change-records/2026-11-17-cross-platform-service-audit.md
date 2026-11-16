# BL-20261117-01：服务架构修复的三端兼容性复核

## 时间与范围

- 开始复核：2026-11-16 23:59:23 +08:00（Asia/Shanghai）。
- 记录时间：2026-11-17 00:07:30 +08:00（Asia/Shanghai）。
- 应用版本：1.0.6。
- 基线与被检查的源码提交：`cf6ab1b`。
- 提交关联标识：`Change-Record: BL-20261117-01`。
- 原因：用户要求进一步确认服务架构修复不会破坏 macOS ARM、Windows 和 Linux。

本轮未发现需要新增修改的功能代码，仅新增验证记录。没有更改应用、工作流或测试脚本，因此不新增用户 Changelog 条目。

## 实际脚本隔离审计

读取当前 `scripts/prebuild.mjs`，用 TypeScript 转换后在独立 VM 中执行初始化与三个服务预构建函数。禁止末尾全任务入口执行；下载、编译和文件复制均由内存替身接管，不访问账户、不执行安装器、不修改系统代理或服务。

每个目标均检查“显式 target 预构建”和“无参数生命周期预构建”两阶段。两阶段共捕获 6 次 Cargo 命令，并核对最终资源内容的目标标识与目录、名称：

| 目标 | 目标平台/架构 | 服务输出布局 | 结果 |
| --- | --- | --- | --- |
| macOS ARM | `aarch64-apple-darwin`，`darwin/arm64` | `resources/`，三个服务文件无后缀 | 通过 |
| ARM 宿主构建 Intel macOS | `x86_64-apple-darwin`，`darwin/x64` | `resources/`，三个服务文件无后缀 | 通过，两阶段均为 Intel |
| Windows x64 | `x86_64-pc-windows-msvc`，`win32/x64` | `resources/`，三个文件均保留 `.exe` | 通过 |
| Linux x64 | `x86_64-unknown-linux-gnu`，`linux/x64` | `sidecar/`，三个文件均保留目标三元组后缀 | 通过 |

上述为内存中的脚本控制流审计，不是四个系统的实际编译、Mach-O/PE/ELF 执行或特权服务安装测试。

## 补跑的检查

- `node --test scripts/tests/service-architecture.test.mjs scripts/tests/bluelayer-payload.test.mjs scripts/tests/bluelayer-diagnostics.test.mjs scripts/tests/bluelayer-network.test.mjs`：48 项通过。
- `cargo test --offline --locked -p bluelayer-core-snapshot --lib`：12 项通过；实际内核测试默认忽略，由下述脚本运行。
- `node scripts/tests/core-snapshot-smoke.mjs x86_64-pc-windows-msvc`：本机隔离真实内核读取通过，测试进程及临时目录已由脚本清理。
- `cargo check --locked -p clash_verge_service_ipc --features standalone --bins --target <target>`：macOS ARM、Intel 与 Linux x64 均通过。
- `cargo check --offline --locked -p clash_verge_service_ipc --features standalone --bins --target x86_64-pc-windows-msvc`：通过。
- 最初三个非 Windows 目标的离线检查因缺少已锁定的 Cargo 缓存而失败；联网补齐现有锁定版本后通过，未升级依赖、未修改 `Cargo.lock`，不把缺少缓存记为源码编译错误或离线检查通过。
- 修改涉及的构建脚本、架构测试及 ESLint 配置的严格 ESLint：通过。
- `pnpm typecheck`：通过。
- `git diff --exit-code eb9a5f9 cf6ab1b -- src src-tauri/src crates Cargo.toml Cargo.lock src-tauri/Cargo.toml package.json`：退出码 0，确认该修复没有修改三端应用/服务 Rust 运行代码、前端功能代码或依赖版本。

服务 crate 的目标检查包含 `standalone` 服务主程序、安装器和卸载器的条件编译分支；`cargo check` 不执行最终链接、不产生已验证的安装包，也不代替实机测试。

## CI 状态快照

检查新构建 `43902175606`，源码为 `cf6ab1b`：

- Windows x64、Windows WebView2、Linux x64 的资源准备、48 项回归及真实内核通信检查均已成功，完整打包作业仍在进行。
- macOS ARM 与 Intel 作业仍在排队，尚无本轮原生架构检查或打包结果。

因此，本轮可确认未发现静态/隔离测试范围内的兼容性回归，但不能宣称三个系统已经全部完成新安装包验证。没有因为排队而跳过 macOS 检查、删除校验关卡或改动 runner 矩阵。

## 回溯

```powershell
git log --all --fixed-strings --grep="Change-Record: BL-20261117-01" --format="%h %aI %s"
git show cf6ab1b -- scripts/prebuild.mjs scripts/build-target.mjs scripts/check-service-architecture.mjs .github/workflows/autobuild.yml .github/workflows/release.yml
```

本记录仅补充验证证据，不替换原修复记录 `BL-20261116-03`。若需撤销已发布的功能修复，应先保存本地工作，再对原修复提交使用 `git revert`；撤销本记录的文档提交不会更改安装包或运行行为。
