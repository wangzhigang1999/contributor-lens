# 验证记录

2026-11-06，Linux ARM64 Chromium + Playwright，真实加载 Manifest V3 扩展。以下数据为当次查询快照，之后 GitHub 状态可能变化。

## 真实 GitHub 页面与真实 API

| 场景 | 结果 |
| --- | --- |
| `https://github.com/microsoft/vscode/issues` | 新 Issue 列表结构中 25 行出现入口。实际点击作者 liivats 的页内按钮，查询成功，最近 7 天为 0 PR，卡片明确展示没有活动。 |
| `https://github.com/microsoft/vscode/pulls` | 25 行出现入口。 |
| `https://github.com/microsoft/vscode/pull/346472` | 顶部入口对应 lszomoru，1 个入口。 |
| 同一 PR 的 `/commits`、`/files` | 两个标签都出现 1 个入口，均对应 lszomoru。未使用时间线评论者身份。 |
| 工具栏弹窗查询 | 通过 `chrome.action.openPopup()` 打开**实际 action popup**，通过 CDP 在该 popup 内点击查询。PR 页自动预填 lszomoru，查询成功：49 PR，2 open、46 merged、1 closed without merge。 |
| `https://github.com/lszomoru` 个人主页 | 实际 action popup 自动预填 lszomoru，查询成功，同样得到 49 PR。 |
| 完整报告原始链接 | 从报告打开 `https://github.com/microsoft/vscode/pull/346472`，页面标题为 “ci: list the Linux workspace image jobs before the Windows ones by lszomoru · Pull Request #346472”。 |
| Request log | 真实 API 请求日志显示分页、HTTP 状态和限流信息，Copy log 返回“已复制”。 |
| 浏览器重启 | 关闭 Chromium，再用同一专用 profile 启动，日志 20 条且与重启前逐项一致。 |

使用无界面浏览器，未物理点击浏览器工具栏图标。实际 action popup 不会被 Playwright 注册为常规 Page，因此用 `chrome.action.openPopup()` + CDP 操作其真实页面；另外在独立标签页验证了同一 `popup.html` 的完整报告、截图和日志。无界面测试的证书忽略参数仅用于当前测试运行器，不属于扩展。

证据：`tests/live-evidence.json`、`tests/live-report.png`、`tests/toolbar-evidence.json`、`tests/toolbar-profile-evidence.json`。

## 可控 HTTP 响应与页面夹具

`tests/browser.test.js` 在真正运行的扩展和 Chromium 中拦截 API 响应，未使用真实 Token。以下均通过：

- 合法 200 零结果与账号错误分开；界面明确显示“查询成功：此窗口没有 PR 活动”。
- 普通 403 没有任何限流证据时显示 HTTP 错误，而非限流。
- `incomplete_results: true` 显示不完整提示。
- 第一页 200 + 100 条数据，第二页 429：报告显示失败页 2，不展示前页为完整统计。日志包含页码 1 / 2、状态 200 / 429 和 Retry-After。
- Request log 的 Copy log、完整报告的 Markdown 复制成功；状态筛选及标题搜索生效。
- 35 行混合相对条目 URL、绝对同源 URL、个人主页作者链接、`author:` 筛选链接和用户 hovercard 按钮：35 行均出现入口。跨域链接、其他仓库条目及导航组织链接不产生误识别。
- 匿名模式只自动查询 4 位作者；滚动后不突破额度；额度以外仍可手动查询。
- 保存模拟 Token 后，自动查询最多 24 位作者。
- 列表替换后重新插入入口，最终仍为 35 个，不重复。
- PR 顶部作者与时间线 reviewer 不同，三个标签仍始终选择 PR 作者。
- 真正关闭并重新启动浏览器后，模拟请求产生的持久日志逐项一致。

证据：`tests/browser-evidence.json`。

## 核心自动测试

`npm test`：9 项测试全部通过。

覆盖精确截止时间与未来时间排除、关闭合并分类、PR 去重、滑动 10 分钟窗口跨整点、≤60 秒相邻计数、每日零活动日、结果上限、不可搜索账号 / Token 拒绝 / 权限错误 / 普通 HTTP 错误 / 网络失败分类、第二页限流日志、并发请求合并、最大网络并发 2、最近 100 条日志不丢写、12 份缓存上限、Token 更换时在途结果不能回写、认证缓存跨 Worker 重启复用。

没有使用真实 Token 验证私有仓库权限、真实 API 限流或 GitHub 登录后的个人化页面；这些行为使用可控响应和夹具验证。未人为触发 GitHub 真正的 1,000 条搜索上限；上限提示使用核心测试验证。GitHub 其他布局或未来 DOM 改版需继续回归。
