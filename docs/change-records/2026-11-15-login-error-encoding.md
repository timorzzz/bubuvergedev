# BL-20261115-01：登录错误乱码修复

## 时间与版本

- 记录时间：2026-11-15 21:52:35 +08:00（Asia/Shanghai）。
- 应用主版本：1.0.6，本次未提升版本号；自动构建附加版本由既有发布流程生成。
- 分支：`main`。
- 修改前基线：`2545970dc579e6ba79c82274f8fd1652235e61f6`。
- 对应提交标识：`Change-Record: BL-20261115-01`。使用此编号查找实际修复提交，命令见下文。
- 当前状态：本地代码与前端构建验证通过，提交推送后由用户编译安装包测试。

## 问题与原因

用户反馈 Windows 登录报错时，红色错误框显示乱码。检查发现两类编码问题：

1. `src/services/bluelayer.ts` 中线路加载失败、登录失败、订阅同步失败等本地提示已经被错误转码，损坏的文字会直接显示在页面上。
2. 面板 V1 接口使用 Base64 与 RC4。原实现将 RC4 解密得到的字节直接当作 JavaScript 字符串解析 JSON，缺少 UTF-8 解码。通过固定的中文错误响应复现了原解码器的中文损坏问题。

另外，HTTP 非成功响应此前会把原始响应正文直接作为错误提示，可能把加密内容或 HTML 显示给用户。

## 本次全部改动

| 文件 | 改动 |
| --- | --- |
| `src/services/bluelayer.ts` | 接入独立的 V1 响应解析器；恢复创建订阅失败、线路未加载完成、订阅同步失败、登录失败、用户信息获取失败等中文提示；恢复客服匹配关键词与公告默认标题；HTTP 失败时提取接口错误说明，无可用说明时显示带状态码的中文提示。 |
| `src/utils/bluelayer-payload.ts` | 提取已有 RC4/JSON 解析逻辑，增加严格 UTF-8 字节解码；继续兼容 Unicode 转义 JSON、普通 JSON 和未包装的更新响应；解析失败时显示中文提示。 |
| `scripts/tests/bluelayer-payload.test.mjs` | 增加 7 项基于固定响应样本的回归测试，覆盖中文失败消息、成功用户资料与数字流量、Unicode 转义、普通 JSON、空白、更新响应和异常内容。 |
| `eslint.config.ts` | 将 `scripts/tests/*.mjs` 加入 ESLint 默认项目与 Node 脚本环境，确保回归测试文件可以通过提交检查。 |
| `package.json` | 文档等文件的 lint-staged 格式化命令增加 `--no-errors-on-unmatched`，避免当前 Biome 不支持 Markdown 时阻止提交；可处理文件仍正常格式化。 |
| `Changelog.md` | 增加本次 Bluelayer 1.0.6 测试版的用户更新说明；保留原有上游历史块，并增加分隔，供发布脚本提取正确的最新说明。 |
| `docs/change-records/README.md` | 建立按日期与编号检索的记录索引，补录近期 Git 基线，记录查询、差异比较、独立检出和回退方法。 |
| `docs/change-records/2026-11-15-login-error-encoding.md` | 保存本次原因、修改范围、验证与回退依据。 |
| `AGENTS.md` | 约定后续修改持续记录时间、版本、文件、验证与提交关联。 |

源码中的固定中文提示使用 Unicode 转义，减少后续编辑时再次被错误转码的风险。

## 影响范围

- 用户可见变化：登录、订阅和账户相关错误恢复可读中文；面板返回的中文用户资料正常解码；异常内容显示统一提示。
- 共用代码：Windows、macOS、Linux 使用同一套前端解析逻辑，本次未修改平台专用 Rust、系统代理、TUN、服务安装或托盘代码。
- 登录 session 有效期继续为 7 天；未修改账号验证、面板选择或订阅激活的流程。
- 未新增登录 HTTP 请求日志。

## 已完成验证

以下结果来自本次本地实际执行：

| 检查 | 结果 |
| --- | --- |
| 使用修改前提交中的解码器解析固定中文错误样本 | 已复现旧解码器损坏 UTF-8 中文消息。 |
| `node --test scripts/tests/bluelayer-payload.test.mjs` | 7 项通过，0 项失败。 |
| `pnpm typecheck` | 通过。 |
| `pnpm exec eslint src/services/bluelayer.ts src/utils/bluelayer-payload.ts --max-warnings=0` | 通过。 |
| ESLint 配置文件和新增回归测试文件的严格检查 | 通过。 |
| `pnpm web:build` | TypeScript 检查与 Vite 生产构建通过。 |
| `git diff --check` | 通过。 |
| 发布说明解析器 `resolveUpdateLog` / `resolveUpdateLogDefault` | 正确提取本次 1.0.6 说明，不混入上游 2.4.8 内容。 |

本次未执行三端安装包编译，也未在真实账户上进行登录失败的安装包实测。Git 推送钩子的执行结果以对应提交和本次交付说明为准。

## 用户测试要点

- 输入错误密码，确认错误框中文可读。
- 遇到线路尚未加载完成时，确认显示“线路尚未加载完成，请稍后重试”。
- 正常登录后检查账户中文信息、公告及订阅加载。
- 面板返回异常数据或 HTTP 错误时，确认提示可读且不显示原始加密数据或整页 HTML。

## 查找与回退

```powershell
$changeCommit = git log main --fixed-strings --grep="Change-Record: BL-20261115-01" --format="%H" -1
git show $changeCommit
git diff 2545970 $changeCommit
```

需要独立检查修改前代码，可在项目根目录执行：

```powershell
git worktree add --detach ../bluelayer-before-login-encoding 2545970
```

需要撤销本次提交时，先保存未提交工作，再运行 `git revert $changeCommit`。这会恢复旧版的错误提示与解码行为；后续有依赖时应先评估冲突。回退本身应新增记录并重新验证，不应重写共享分支历史。
