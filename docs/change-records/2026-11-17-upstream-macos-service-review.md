# BL-20261117-05：参考官方最新 macOS 服务安装逻辑

## 时间与范围

- 记录时间：2026-11-17 11:11:09 +08:00，Asia/Shanghai。
- 应用版本：1.0.6。
- 本地基线：`6f3ab41`，同时包含待提交的 BL-20261117-04 macOS IPC 修复。
- 提交关联标识：`Change-Record: BL-20261117-05`。
- 用户要求推送修复，并参考 GitHub 官方最新版 Clash Verge 的 macOS TUN 服务安装方式。

本次为只读上游源码核对及记录，没有引入额外运行逻辑、升级依赖、修改服务标识或复制整套上游架构。实际产品修复和测试范围见 BL-20261117-04。

## 查询时的官方版本

通过 GitHub API 实际确认，不采用搜索引擎中的旧缓存作为“最新版”：

- 官方最新稳定版：[Clash Verge Rev v2.5.10](https://github.com/clash-verge-rev/clash-verge-rev/releases/tag/v2.5.10)，发布于 2026-11-03，主程序提交 `c83f7ad529c7c9cb3d2d54a0955ef8c1b22a411b`。
- 该稳定版依赖官方服务组件 `v2.7.7`，标签指向提交 `3ed29700b093190b5e7addcaa892e77f172af544`，其 IPC 库为 `kode-bridge 0.5.2`。
- 同时查看官方 dev 查询时的提交 `dc71c11ef2bdc6554860e364919f4ee8cd9e6296`（2026-11-17），它使用服务组件 `v2.8.1`、`kode-bridge 0.6`；服务标签提交为 `9d4ea7d27fb3c43804bd18f3bb3b686528763239`。没有把 dev 当成稳定版本。

核对命令包括 `gh api .../releases/latest`、标签解引用、主程序 Cargo.toml/Cargo.lock、服务组件的安装器、management、launchd 模板和 server 源码；未在上游仓库写入内容，未拉取或合并上游代码。

## 与本次故障直接相关的结论

### 1. 安装与就绪是两个阶段

官方应用将安装工作交给带提权能力的安装工具；macOS 提权仍使用 osascript 的管理员授权，并传入用户组信息。安装器检查已有 launchd 注册、停止旧任务、发布服务和 plist、设置所有权与权限，检查启用及 bootstrap 等命令，并验证服务可用性。不能把安装器退出成功或 plist 存在当作 IPC 已正常运行。

本地此前已补充命令错误传播、安装后握手和启动诊断；本次用户日志中的问题发生在 daemon 创建监听器时，而不是管理员授权失败。因此没有继续改动权限提升、服务安装目录或等待时长。

参考：[稳定版应用服务入口](https://github.com/clash-verge-rev/clash-verge-rev/blob/v2.5.10/src-tauri/src/core/service.rs)、[官方服务安装器](https://github.com/clash-verge-rev/clash-verge-service-ipc/blob/v2.7.7/src/bin/install_service.rs)、[官方提权与安装校验](https://github.com/clash-verge-rev/clash-verge-service-ipc/blob/v2.7.7/src/management.rs)。

### 2. 同名监听权限 API 不代表同一实现

官方服务 `v2.7.7` 仍对 Unix 调用 `with_listener_mode`，但它使用的 `kode-bridge 0.5.2` 已采用自有 Unix 传输实现：先绑定路径，再对实际 socket 路径设置权限，随后监听。稳定版 Cargo.lock 的 kode-bridge 依赖中已没有 interprocess。

本地锁定的是 `kode-bridge 0.3.6` 和 `interprocess 2.4.0`，会在 bind 前对描述符执行 fchmod；用户日志正是该路径返回 Unsupported。不能只看上层 API 名称就把官方调用方式复制到不同底层版本。

本次 BL-20261117-04 的限定方案是在 macOS 不启用旧库的 pre-bind mode，继续沿用本地既有的受限目录、umask 和创建后路径权限设置。这与避开不兼容描述符操作的方向一致，但不是将新版库完整移植，也不宣称与官方新服务在所有行为上完全等同。Windows/Linux 保持原有监听配置。

参考：[官方服务监听配置](https://github.com/clash-verge-rev/clash-verge-service-ipc/blob/v2.7.7/src/core/server.rs)、[kode-bridge v0.5.2 的 Unix 传输](https://github.com/KodeBarinn/kode-bridge/blob/v0.5.2/src/transport/unix.rs)，库标签提交为 `04b809c3da2fd968aad61bc5556535cf096d6381`。

### 3. 没有直接升级或照搬的内容

官方新服务还包含协议版本、多用户/会话所有权、经管理员批准的核心副本、维护与修复状态等成套机制，应用侧与服务侧需共同匹配。将这些零散复制到当前 2.2.0 基础的本地服务，或只升级 IPC 库，会扩大平台和功能回归风险。本次不做该迁移，不复用官方服务 ID、安装路径或旧服务清理名称，避免干扰同机原版 Clash Verge。

## 验证边界与回滚

本轮实际执行的是远程版本查询和源码阅读，不是运行官方客户端或 macOS 安装器；不据此宣称本地 Intel/ARM 安装成功。源代码修复的实际命令与结果保留在 BL-20261117-04，最终仍需新 CI 和用户的 Intel Mac 测试。

该记录仅为文档；回滚已发布内容使用 `git revert`，不要重写共享历史。如需回滚同一提交中的代码修复，遵循 BL-20261117-04 的服务重装与风险说明。记录定位命令：`git log --all --fixed-strings --grep="Change-Record: BL-20261117-05" --format="%h %aI %s"`。
