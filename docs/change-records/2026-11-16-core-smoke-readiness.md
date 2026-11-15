# BL-20261116-02：修正真实内核测试的启动就绪判断

## 时间与基线

- 记录时间：2026-11-16 01:16:16 +08:00（Asia/Shanghai）。
- 应用版本：1.0.6，不提升版本、不升级依赖或内核。
- 基线提交：`ef0a7a6`。
- 提交关联标识：`Change-Record: BL-20261116-02`。

## 故障证据与原因

用户反馈 Intel macOS 自动构建在 `Test packaged core IPC` 步骤失败。日志显示测试已经取得可解析的内核响应，但 `test-node.type` 为 `Null`，立即断言为 `Socks5` 失败；不是 Rust 编译器错误，也不是日志中的子包 profile 警告或 OpenSSL 链接错误。

检查发现 `reads_real_mihomo_snapshot` 只重试连接失败和超时，一旦取得任何有效 JSON 就退出等待，没有确认测试节点、代理组及选中目标是否已加载。用“先返回空线路或内置 DIRECT，后返回完整测试配置”的回归测试，在原等待逻辑上实际复现相同的 `Null / Socks5` 失败。

上游源码也存在相应时序窗口：[`hub.ApplyConfig`](https://github.com/MetaCubeX/mihomo/blob/0455d0d28c4526937380505153e65a843d8612e8/hub/hub.go#L51) 先创建控制接口，再应用执行器配置；[`ReCreateServer`](https://github.com/MetaCubeX/mihomo/blob/0455d0d28c4526937380505153e65a843d8612e8/hub/route/server.go#L87) 异步启动接口。此处引用固定上游提交，仅作为启动顺序依据；不据此假定用户构建恰好采用该内核版本。

另发现构建版本识别脚本未统计 `crates/` 和 `scripts/`，这类修复可能继续引用旧源码提交或被判断为无需更新。

## 本次修改

1. 仅在测试模块中增加有界就绪等待：确认 `test-node` 协议、`test-group`、当前选择和目标列表都与隔离配置一致后，才继续严格断言及 provider 读取。
2. 允许控制接口先就绪而配置尚未应用，也重试短暂连接失败；实际冒烟测试最多等待 20 秒、每 100 毫秒查询一次。
3. 整段等待有统一截止时间，单次读取挂起也不能绕过截止时间。超时报告固定缺失阶段与尝试次数，不打印原始响应、用户路径或账户数据。
4. 永久无节点、协议错误、代理组缺失、错误选择、错误目标仍失败；必要结构错误立即失败。不删除测试、不放宽最终结果、不让真正的错误通过。
5. 新增 5 项回归测试，分别覆盖配置延后就绪、暂时 IPC 错误、永久错误配置、错误响应不重试和挂起查询受截止时间限制。
6. 将 `crates/` 与 `scripts/` 纳入构建提交识别，保证此类修改可以对应新的构建标识。

`native_tests.rs` 仅通过 `cfg(test)` 编译。没有修改客户端 IPC 读取实现、登录、启动网络检测、订阅、代理/TUN、UI 或三端工作流矩阵；Windows、macOS Intel/ARM、Linux 共用同一项修正后的测试。

## 涉及文件

- `crates/bluelayer-core-snapshot/src/native_tests.rs`：等待测试配置、截止时间、负向回归和真实内核测试。
- `scripts-workflow/get_latest_tauri_commit.bash`：补充构建提交识别路径。
- `Changelog.md`、`docs/change-records/README.md` 及本记录。

## 已执行验证

- 修复前运行新增 `fixture_waits_for_config_after_api_becomes_available`：实际失败，错误为 `Null / Socks5`，复现过早断言。
- `cargo test --offline --locked -p bluelayer-core-snapshot --lib`：修复后 12 项通过，真实内核测试按设计默认忽略，由独立脚本执行。
- `node scripts/tests/core-snapshot-smoke.mjs x86_64-pc-windows-msvc`：本机隔离真实内核测试通过；由脚本关闭自己启动的内核并清理临时目录，未改动系统代理或用户数据。
- `cargo check --offline --locked -p bluelayer-core-snapshot --all-targets --target <target>`：macOS ARM、macOS Intel、Linux x64 均通过，包括新增测试的静态编译，不是这些系统的本轮运行测试。
- `cargo clippy --offline --all-targets --all-features -- -D warnings`：通过。
- `node --test scripts/tests/bluelayer-payload.test.mjs scripts/tests/bluelayer-diagnostics.test.mjs scripts/tests/bluelayer-network.test.mjs`：36 项通过。
- 使用 Git for Windows 的 Bash 执行构建识别脚本的 `-n` 语法检查及现有历史查询：通过。提交后仍需核对识别结果对应本次源码提交。系统默认 `bash` 实际指向未启用的 WSL，不将该命令失败记为脚本通过；未为此安装 WSL 或改动系统环境。
- `git diff --check`：通过。已有子包 profile 警告保留，未因此更改构建配置。

## CI 状态边界

通过 GitHub CLI 读取原失败构建 `43738383988`：Intel macOS 的实际内核测试失败；该构建中的 macOS ARM、Linux、Windows 及 Windows WebView2 的同一步骤已通过。这些是修复前构建的结果，不能写成本轮修复后的三端复测通过。

本轮修复后的 Intel macOS 运行结果仍待新构建确认。当前证据可确认测试就绪判断有缺陷，但不能仅凭本机模拟就宣称所有安装包实测通过，也不将这条测试失败直接认定为客户端运行不可用。

## 查看与回溯

```powershell
git log --all --fixed-strings --grep="Change-Record: BL-20261116-02" --format="%h %aI %s"
git diff ef0a7a6 HEAD -- crates/bluelayer-core-snapshot/src/native_tests.rs scripts-workflow/get_latest_tauri_commit.bash
```

发布后如需撤销，先保存本地工作，再对带上述记录编号的提交执行 `git revert`。撤销会恢复旧的过早断言及旧的提交过滤范围；不要删除用户配置、订阅或缓存来规避测试失败。
