# BL-20261117-03：应用侧 Unix 编译修正与范围约束

## 时间与基线

- 记录时间：2026-11-17 01:34:16 +08:00，Asia/Shanghai。
- 应用版本：1.0.6，未修改版本号、依赖和最低系统要求。
- 基线提交：`ad22816`，开始修改时工作区干净。
- 提交关联标识：`Change-Record: BL-20261117-03`。

## 原因及前一记录的验证边界纠正

用户报告 Linux 全应用打包在 `src-tauri/src/core/service.rs` 失败：`Path::metadata` 需要 `&Path`，代码却传入了 `&str`。该行由上一修复引入，位于 Unix 条件分支，因此 macOS 同样受影响，Windows 编译不会发现它。

BL-20261117-02 的服务模块交叉检查实际通过，但只覆盖独立服务 crate，未检查应用侧 Unix 分支；Windows 的全应用 Clippy 同样不会编译该分支。本轮承认这一漏检，保留原始记录，并增加针对实际应用代码的定向编译检查，不再把服务模块的结果视为应用侧代码已检查。

用户同时明确：TUN 安装异常目前只在 macOS 发现，Windows/Linux 的 TUN 无异常，不应扩大改动到其运行逻辑。

## 产品代码修改：严格限于编译问题

1. `src-tauri/src/core/service.rs`：将 `Path::metadata(IPC_PATH)?` 改为 `Path::new(IPC_PATH).metadata()?`。只是把现有字符串地址转换为正确类型；路径、750 毫秒可用性超时、15 秒安装后等待、握手和错误处理均不变。Windows 不编译此行。
2. `src-tauri/src/config/config.rs`：在 Linux 条件分支明确忽略无须清理的 `config` 参数，消除未使用变量警告，仍保持 Linux 配置原样，不增删入站选项。

不修改任何平台的服务安装/卸载、TUN 开关、提权、服务名、IPC 地址、权限、启动顺序和代理/线路逻辑；不回退或重构此前已发布的其他修复。后续 macOS 专属问题继续按平台限定，不以未经实测的共享运行逻辑改动处理。

## 回归检查

- 新增 `scripts/tests/platform-service-check.mjs`：从真实应用源码提取 `is_service_available`、`remove_config_key`、`sanitize_platform_inbounds`，并直接引用真实 `service_diagnostics.rs`，用实际 Rust 依赖编译，不模拟 Path、Tokio、IPC、YAML 或日志 API。
- 检查 crate 仅在新建的临时目录生成，复制当前 Cargo.lock、固定直接依赖版本，复用已有 target 缓存，不修改项目清单或锁文件，不执行检查出的函数或调用服务安装/启停，也不发起面板请求。
- 检查 crate 使用 `deny(warnings)`，同时捕捉类型错误及目标平台的未使用变量警告；成功检查仍不代表完整 Tauri 应用已构建或运行。
- `--verify-regression` 仅在临时检查文件中恢复旧的错误 Path 调用，要求编译器明确返回 E0308，验证本次检查确实能拦截历史缺陷。不会改动原始应用文件。
- Auto Build/Release 的常规和 WebView2 作业增加该检查；按现有 matrix.target 检查后仍继续原有完整打包。允许 CI 下载缺少的依赖；本机使用 `--offline` 验证，不升级仓库依赖。
- `scripts/tests/service-architecture.test.mjs` 增加工作流接线断言，确保所有打包作业包含应用侧检查。

## 实际验证

以下均在 Windows 本机执行，未以交叉检查代替实机结论：

- `node scripts/tests/platform-service-check.mjs x86_64-unknown-linux-gnu --offline --verify-regression`：真实应用函数/诊断模块的 Linux 类型检查通过；临时恢复旧写法后，按预期因 E0308 失败。
- `node scripts/tests/platform-service-check.mjs x86_64-apple-darwin --offline --verify-regression`：Intel macOS 定向类型检查通过；旧写法按预期因 E0308 失败。
- `node scripts/tests/platform-service-check.mjs aarch64-apple-darwin --offline`：ARM macOS 定向类型检查通过。
- `node scripts/tests/platform-service-check.mjs x86_64-pc-windows-msvc --offline`：Windows 定向类型检查通过。
- `cargo clippy --offline --locked -p bluelayer --all-targets --all-features -- -D warnings`：Windows 应用检查通过。
- 原有四个 JS 回归文件联合 `node --test`：48 项通过，包括新增工作流断言。
- 新脚本及修改的 JS 测试严格 ESLint：通过；使用既有 Biome 格式化规则。

本机 WSL 不具备运行环境，未安装或修改 WSL 组件。未执行完整 macOS/Linux 应用原生构建、安装包打包或三端 TUN 实机测试；这些仍需 CI 和对应系统的新包验证。本次不把用户此前报告 Windows/Linux 正常当作本轮运行测试结果。

## 涉及文件与回滚

产品修改仅为上述两个 Rust 文件；其余为检查脚本、检查接线测试、Auto Build/Release 的附加检查步骤、Changelog 和变更记录。

通过 `git log --all --fixed-strings --grep="Change-Record: BL-20261117-03" --format="%h %aI %s"` 定位提交。若已发布，使用 `git revert` 回滚，不重写共享历史、不清理用户配置；回滚将重新引入 Unix 编译错误，不能作为 macOS TUN 故障的解决办法。
