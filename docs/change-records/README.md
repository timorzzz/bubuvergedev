# Bluelayer 变更记录

本目录保存开发记录，`Changelog.md` 保存面向用户的更新说明，Git 保存每次提交的完整代码差异。三者一起用于定位问题和回溯改动。

时间统一使用北京时间 `Asia/Shanghai`（UTC+08:00）。记录从 2026-11-15 开始建立；较早时间来自 Git 的实际提交时间。

## 当前记录

| 记录时间 | 记录编号 | 应用版本 | 改动与详细记录 |
| --- | --- | --- | --- |
| 2026-11-15 22:49:31 +08:00 | BL-20261115-02 | 1.0.6 | [订阅激活、线路就绪与脱敏日志；对比正常版本 a83dc92](2026-11-15-profile-activation-diagnostics.md) |
| 2026-11-15 21:52:35 +08:00 | BL-20261115-01 | 1.0.6 | [修复登录错误乱码，建立变更归档](2026-11-15-login-error-encoding.md) |

本次对应的提交可通过唯一编号查询：

```powershell
git log --all --fixed-strings --grep="Change-Record: BL-20261115-01" --format="%h %aI %s"
```

## 已有历史基线

下列为 2026-11-15 从 Git 历史补录的近期基线摘要，不表示本次重新修改或重新验证了这些历史功能。更早的全部变更保留在 Git 历史中。

| 原提交时间 | 提交 | 变更摘要 |
| --- | --- | --- |
| 2026-05-18 11:33:55 +08:00 | `2545970` | 隔离当前进程的代理环境变量；面板请求直连优先，失败后可尝试已启用的系统代理。 |
| 2026-05-09 00:37:34 +08:00 | `2c9e2e3` | 修复 Unix 服务 IPC 路径被移动后仍被日志引用导致的 Rust 编译错误。 |
| 2026-05-09 00:27:51 +08:00 | `0618b47` | 修复严格 Clippy 检查，并调整服务、托盘和窗口等相关代码。 |
| 2026-05-09 00:19:46 +08:00 | `71dadc8` | 隔离 Bluelayer 与原版 Clash Verge 的服务、IPC、端口和运行时配置。 |
| 2026-05-06 17:16:43 +08:00 | `96147c4` | 恢复托盘状态图标提示。 |

## 查找与对比

在项目根目录执行：

```powershell
# 查看完整提交历史与北京时间偏移。
git log --all --format="%h %aI %s"

# 按关键字查找开发记录。
rg -n "乱码|登录|代理|托盘" docs/change-records Changelog.md

# 查看一条历史提交的说明及完整差异。
git show 2545970

# 从本次记录查出对应提交，再比较改动。
$changeCommit = git log main --fixed-strings --grep="Change-Record: BL-20261115-01" --format="%H" -1
git show --stat $changeCommit
git diff 2545970 $changeCommit -- src/services/bluelayer.ts src/utils/bluelayer-payload.ts
```

## 回溯与回退

先检查 `git status` 并妥善保存本地未提交改动。需要检查旧版时，在独立目录检出历史代码：

```powershell
git worktree add --detach ../bluelayer-inspect-2545970 2545970
```

需要撤销已发布的某次修改时，先从记录找到提交，再创建反向提交：

```powershell
$changeCommit = git log main --fixed-strings --grep="Change-Record: BL-20261115-01" --format="%H" -1
git revert $changeCommit
```

回退后应重新验证、增加回退记录并提交推送。若后续代码依赖该修改，先处理依赖和冲突；不要直接强制覆盖远端历史。

## 后续维护

后续每批修改新增一条带时间的记录，写清问题、修改范围、验证结果、基线提交和回退方式，并在提交正文中加入 `Change-Record: 记录编号`。提交后可按编号检索到真实提交哈希；构建和安装包验证结果在完成后补充，避免把静态检查写成三端实测通过。
