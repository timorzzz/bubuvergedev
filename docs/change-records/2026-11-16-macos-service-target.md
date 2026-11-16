# BL-20261116-03：修复 Intel macOS 安装包内服务文件架构混装

## 时间与基线

- 记录时间：2026-11-16 23:51:13 +08:00（Asia/Shanghai）。
- 应用版本：1.0.6，未提升版本号，未升级依赖、内核或最低 macOS 版本。
- 基线提交：`eb9a5f9`。
- 用户测试版本：`1.0.6+autobuild.1116.eb9a5f9`。
- 提交关联标识：`Change-Record: BL-20261116-03`。

## 已确认的故障链

用户日志显示普通内核配置已应用，安装服务时提升权限执行 `service-bin/bluelayer-mihomo-service-install`，操作系统返回 `Bad CPU type in executable (126)`。失败点是服务安装器的可执行架构，而非 TUN 规则或线路配置验证。这里只记录脱敏事实，不保存用户目录、面板地址、账户或完整日志。

进一步通过 GitHub CLI 核对构建 `43866733030` 的 Intel macOS 作业 `133297389503`：

- runner 的 Rust host 为 `aarch64-apple-darwin`。
- 先执行 `node scripts/prebuild.mjs x86_64-apple-darwin`，生成三个 Intel 服务文件。
- 在打包阶段，`pnpm build --target ...` 又自动执行 `node scripts/prebuild.mjs`，这次没有目标参数；原脚本重新采用 ARM host 编译并复制三个服务文件。
- 最后主程序仍按 `x86_64-apple-darwin` 打包。主程序和带目标后缀的 Mihomo 可以运行，但无目标后缀的服务资源被后一次预构建覆盖，造成包内架构不一致。

现有 macOS 安装逻辑每次都会从应用资源重新复制暂存文件，因此仅清空暂存目录无法修复旧安装包的错误资源。必须重新构建并替换应用；新包的正确资源会在下次安装服务时重写暂存文件。

## 本次修改

1. Auto Build 与 Release Build 的三端常规矩阵及 Windows WebView2 作业统一设置 `BLUELAYER_BUILD_TARGET`，让显式和隐式预构建始终使用同一个安装包目标。
2. 提取构建目标解析：支持原有位置参数、force 参数，以及明确的 target 参数；读取固定构建目标、Tauri hook 目标或标准 Cargo 目标，无配置时仍按 Rust host 运行。本轮统一从最终目标推导下载平台和 CPU 架构，避免 Node 架构与 Rust host 不一致。
3. 显式参数、工作流目标与 Tauri hook 目标冲突时立即失败，不静默覆盖或混用资源。
4. macOS 预构建结束后，逐一检查服务程序、安装器、卸载器的 Mach-O 架构。Intel 必须包含 `x86_64`，Apple Silicon 必须包含 `arm64`，允许包含相应 slice 的通用文件。
5. 在 `beforeBundleCommand` 再次核验这三个资源，阻止后续生命周期脚本或其他步骤替换成错误文件后继续生成和上传安装包。Windows/Linux 分支不会调用 `lipo`，也不更改各自服务文件布局。
6. 将 12 项目标解析与架构防回归测试接入三端打包及前端检查。
7. 为 Node 构建脚本提供独立 `scripts/tsconfig.json`，继续使用现有类型相关 ESLint 规则；不关闭这些规则，不改变应用 TypeScript 配置。提交钩子按既有规范格式化修改的构建脚本。

没有修改 Rust 服务安装/卸载、进程监听名称、IPC 命名空间、权限提升、登录、代理/TUN 开关、窗口或 UI 逻辑，不要求用户删除配置或修改系统安全设置。

## 涉及文件

- `scripts/build-target.mjs`：构建目标解析和 host 查询。
- `scripts/prebuild.mjs`：使用固定目标，并在资源准备后检查 macOS 服务架构。
- `scripts/check-service-architecture.mjs`：独立架构检查和打包前入口。
- `src-tauri/tauri.conf.json`：增加打包前架构校验 hook。
- `.github/workflows/autobuild.yml`、`.github/workflows/release.yml`：为四类构建作业绑定目标，增加回归测试。
- `.github/workflows/frontend-check.yml`：增加架构与目标解析回归测试。
- `scripts/tests/service-architecture.test.mjs`：12 项测试，包括模拟混装、三个文件均检查、冲突拒绝、原生开发回退、两个非 macOS 目标的实际 CLI 无工具运行和配置接线检查。
- `scripts/tsconfig.json`、`eslint.config.ts`：构建脚本的类型检查上下文。
- `Changelog.md`、记录索引和本记录。

## 已执行验证

- `node --test scripts/tests/service-architecture.test.mjs scripts/tests/bluelayer-payload.test.mjs scripts/tests/bluelayer-diagnostics.test.mjs scripts/tests/bluelayer-network.test.mjs`：48 项通过，其中新增 12 项。
- 修改脚本、测试与 ESLint 配置的严格 ESLint 检查：通过，保留类型相关规则。
- `pnpm typecheck`、`pnpm web:build`：通过。
- `cargo clippy --offline --all-targets --all-features -- -D warnings`：通过。
- `cargo test --offline --locked -p bluelayer --lib cmd::bluelayer_diagnostics::tests`：5 项通过。
- `node --check scripts/prebuild.mjs`：通过。
- 在本机实际执行检查脚本的 Windows 默认目标和 Linux 显式目标，均返回 `checked=0`，不调用 macOS 工具。测试还在清空 PATH 的子进程中验证同一路径不会意外调用 `rustc` 或 `lipo`。
- 使用已安装 Tauri CLI 的配置 schema 确认支持 `beforeBundleCommand`；回归测试检查正式/自动构建两种工作流的作业级目标绑定，两个工作流及前端工作流均可被 YAML 解析。
- `git diff --check`：通过；构建仍有既存的子包 profile 与 Browserslist 数据过旧警告，未为消除警告升级依赖。

本机为 Windows。macOS 的架构检查用可控检查器模拟正向及负向文件组合，未在本机执行真实 `lipo` 或安装特权服务；也未把 Windows 上指定 Linux 目标的 CLI 检查写成 Linux 实机测试。修复后的 Intel/ARM 安装包、macOS 原生架构检查及 Intel TUN 安装仍须新构建和实机确认。日志中的其他 Hyper 错误未在本轮处理。

## 依据与回溯

- [Tauri hook 环境变量](https://tauri.app/reference/environment-variables/)说明 `TAURI_ENV_TARGET_TRIPLE` 为实际构建目标；本次使用它在打包前再次比对固定目标。
- [Apple 的 lipo 实现](https://github.com/apple-oss-distributions/cctools/blob/main/misc/lipo.c)支持 `-archs` 架构查询；脚本用参数数组调用，不通过 shell 拼接文件名。

```powershell
git log --all --fixed-strings --grep="Change-Record: BL-20261116-03" --format="%h %aI %s"
git diff eb9a5f9 HEAD -- scripts/prebuild.mjs scripts/build-target.mjs scripts/check-service-architecture.mjs src-tauri/tauri.conf.json .github/workflows
```

若撤销已发布修复，先保存本地工作，再对关联提交执行 `git revert`。撤销会恢复隐式预构建退回宿主架构的风险；不要通过删除用户配置、关闭权限检查或跳过架构校验来规避错误。
