# BL-20261117-04：macOS IPC 监听权限选项兼容修复

## 时间与基线

- 记录时间：2026-11-17 11:04:05 +08:00，Asia/Shanghai。
- 应用版本：1.0.6，未升级依赖、内核或最低系统版本。
- 基线提交：`6f3ab41`，开始修改前工作区干净。
- 提交关联标识：`Change-Record: BL-20261117-04`。

## 用户反馈与故障定位

用户确认仍在 macOS Intel 安装服务失败。本轮新增诊断显示：系统服务已注册，launchd 返回 `spawn scheduled`、重复运行和退出码 1；IPC 目录存在，socket 始终未创建；服务启动 stderr 为 `Failed to bind server: unsupported`。

这次失败点已从安装器/架构问题收敛到服务监听器创建。不是通过延长 15 秒等待或重新下载订阅就能解决的问题。记录只保存必要错误、平台和阶段，不复制账户、个人目录或完整配置。

已核对锁定依赖及本机 Cargo 源码：

1. `kode-bridge 0.3.6` 的 `with_listener_mode` 设置 interprocess 的监听权限选项；`serve()` 调用 `ListenerOptions::create_tokio()`，把失败包装为 `Failed to bind server: ...`。
2. 锁定的 `interprocess 2.4.0` 在 bind 前对 socket 文件描述符执行 `fchmod`，遇到 InvalidInput 转换为 `ErrorKind::Unsupported`，显示为本次日志中的 `unsupported`。
3. 该选项的上游文档明确列出 Linux 等已知支持平台，并说明不支持时返回 Unsupported。项目此前对全部 Unix 目标无差别调用了该选项；macOS 的 socket API 不支持这种用法，因此在产生 socket 文件前就退出。

上游 2.4.0 发布源码对应提交为 `41facdd4e7517cae4b99a44b24671603bc65041e`，从依赖的 `.cargo_vcs_info.json` 核对：

- [监听权限功能说明](https://github.com/kotauskas/interprocess/blob/41facdd4e7517cae4b99a44b24671603bc65041e/src/os/unix/local_socket.rs)。
- [fchmod 与 Unsupported 转换实现](https://github.com/kotauskas/interprocess/blob/41facdd4e7517cae4b99a44b24671603bc65041e/src/os/unix/c_wrappers.rs)。

## 限定范围的修改

- 产品行为变更仅在 `target_os = "macos"`：创建监听器时不再传入触发 pre-bind fchmod 的 listener mode。
- 保留既有的受限 IPC 目录、服务创建时 `umask(0o007)`、socket 就绪后的权限处理、认证头、服务名和 IPC 地址。没有更改权限数值或放开目录访问。
- Linux 保留原有 `with_listener_mode` 及其 mode 计算，Windows 保留相同的 SDDL 安全描述符。未改动它们的服务安装、提权、启停、TUN、代理或线路逻辑。
- 将私有 IPC 构建函数接受的路径作为参数，以便用正式构建器测试独立端点；生产调用仍明确传入原来的 `crate::IPC_PATH`，不读取新环境变量，不改变任何平台的地址。
- 新增真实 IPC 监听回归测试：使用正式构建器和正式路由，在唯一临时 Unix socket/命名管道上绑定，发送带认证的版本请求，并验证响应。不会安装服务、修改生产 IPC 目录、调用核心/TUN 或连接面板。
- Auto Build/Release 的 macOS 作业增加 `--target ${{ matrix.target }}` 的精确测试，分别构建和运行 Intel/ARM 版本的 IPC 监听测试，而不只使用 runner 原生架构。此额外步骤不在 Windows/Linux 运行；现有原生测试仍会验证新增的隔离监听测试。
- 不降低或升级 interprocess、kode-bridge 及其他依赖，未修改 Cargo.lock。macOS ARM 与 Intel 使用同一系统 API 分支；本次兼容修复适用于两个 macOS 目标，不是把操作系统 API 差异错误地当作 CPU 架构差异。

## 涉及文件

- `crates/clash-verge-service-ipc/src/core/server.rs`：按 macOS/其他 Unix/Windows 分别选择原有监听配置，并提供测试路径入口。
- `crates/clash-verge-service-ipc/src/core/server_tests.rs`：正式 IPC 构建、认证请求及版本响应测试。
- `.github/workflows/autobuild.yml`、`release.yml`：仅 macOS 增加打包目标架构的监听测试。
- `scripts/tests/service-architecture.test.mjs`：检查上述步骤的 macOS 条件、目标架构和精确测试名称。
- `Changelog.md`、记录索引和本记录。

## 实际验证

本机仍为 Windows，以下区分运行与编译，未把交叉检查写成 macOS 安装成功：

- `cargo test --offline --locked -p clash_verge_service_ipc --features standalone --lib --bin bluelayer-mihomo-service-install`：10 项通过，其中新增正式 IPC 监听测试在隔离的 Windows 命名管道上实际完成认证请求和版本读取。未操作已安装服务。
- 服务 crate 使用 `standalone,client,test` 和 `--all-targets`，对 Intel/ARM macOS 执行交叉 `cargo check`：通过。
- `cargo clippy --offline --locked -p clash_verge_service_ipc --features standalone,client,test --all-targets [--target <target>] -- -D warnings`：Windows 宿主、Intel macOS、ARM macOS、Linux x64 四目标均通过。
- `node scripts/tests/platform-service-check.mjs <target> --offline`：上述四目标的真实应用服务可用性、诊断和入站函数定向编译均通过。
- `cargo clippy --offline --locked -p bluelayer --all-targets --all-features -- -D warnings`：Windows 应用检查通过。
- 原有四个 JS 回归文件联合 `node --test`：49 项通过，新增 1 项 macOS 目标测试接线检查。
- 修改 JS 文件的严格 ESLint：通过。
- 通过读取基线与当前源码做字符串比较，确认 Linux 的 mode 配置块及 Windows 的 SDDL 配置块原样保留；此为静态比较，不是 Linux/macOS 实机 TUN 测试。

既存子包 profile 警告未在本轮处理。新增 macOS 目标测试尚未在 GitHub 上执行，macOS Intel/ARM 实机安装、启动及 TUN 联网也尚未执行。ARM runner 执行 Intel 目标测试仍属于兼容执行环境，不等同于用户的物理 Intel Mac；最终仍需新包安装确认。

## 测试与回滚

新包应通过客户端服务修复/重装替换已安装的服务程序。只更新应用或反复点击旧服务的连接开关，不会替换旧 daemon 内的监听权限实现。若仍失败，继续获取新运行的 `[ServiceDiag]`，不要求用户删除订阅配置、修改网络接口、禁用系统安全或开启额外权限。

通过 `git log --all --fixed-strings --grep="Change-Record: BL-20261117-04" --format="%h %aI %s"` 定位提交。已发布后如需撤销，使用 `git revert`，不重写历史、不丢弃无关本地修改。回滚后需重建并重装服务程序，且会恢复 macOS pre-bind fchmod 的失败路径；不要回滚到其他平台的旧逻辑或削弱服务认证来规避。
