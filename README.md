# Contributor Lens

一个只展示 GitHub PR 活动的 Manifest V3 Chrome 扩展。不评分，不使用 Member / Contributor / First-time contributor 身份标签。无后端、遥测、远程脚本或 CDN。

## 安装与使用

1. 打开 `chrome://extensions`，启用开发者模式，点击 **Load unpacked / 加载已解压的扩展程序**。
2. 选择本目录（包含 `manifest.json`），无需 npm install 或构建。
3. 打开 GitHub 仓库 Issue / PR 列表，作者旁会显示 **Check activity**。最近 7 天摘要加载后点击展开原始 PR 链接；卡片中的完整报告链接可在新标签页打开报告。
4. PR 详情顶部也有入口，Conversation / Commits / Files changed 均从该 PR 的 REST 记录确认作者。
5. 工具栏打开 Contributor Lens，可从当前个人主页或 PR 详情预填作者；输入用户名和 1–365 天，点击查询。可筛选状态、搜索标题或 owner/repo、复制完整 Markdown。
6. 可在本机 Token 设置中保存或清除可选 GitHub Token。匿名模式无需设置。Token 仅存 `chrome.storage.local`，不进入缓存键或日志，只随 `api.github.com` 请求发送。Token 输入框不会回显已保存的值。
7. **Request log** 显示最近 100 条实际请求，**Copy log** 复制 JSON；关闭和重启浏览器后仍保留。

## 统计和资源边界

- Search API：`author:<username> is:pr created:>=<UTC cutoff date>`；每页 100，按 created 降序，最多 10 页，再以精确时间戳过滤闭区间 `[now − days × 24h, now]`。仅统计窗口内创建的 PR，当前状态分为 open / merged / closed without merge，后两者用 `pull_request.merged_at` 区分。
- 数据范围取决于匿名或 Token 的仓库可见权限。缓存中的当前状态指该次查询时，不是打开卡片时。`incomplete_results` 或总结果数达到 1,000 时明确提示不完整。
- 分页失败只显示失败类别、HTTP 状态和页码，不把前页渲染成完整报告，也不缓存失败结果。账号不可搜索与合法零结果分开；无明确限流证据的普通 403 保留 HTTP 错误。
- 每日图按浏览器本地日历计数，包含窗口两端所在日期和零活动日（所以 7×24 小时可能覆盖 8 个日期）。悬停柱子查看日期和数量。10 分钟峰值使用包含边界的滑动窗口；相邻 ≤60 秒次数根据 PR **创建时间** 排序计算，并非 Git commit 次数。
- 自动查询只调度视口及上下 200px；每个列表 URL 匿名最多 4 个不同作者，认证最多 24 个，最多 2 个并发。手动查询不受作者额度限制。后台全部 API 网络请求也最多 2 个并发，不自动重试。
- 相同作者/天数/认证代次的查询共享进行中的 Promise。本地保存 12 份精简报告，10 分钟有效；修改 Token 清空缓存，旧请求不能写回新缓存。请求日志写入串行化，不因并发丢记录。
- 网络失败包含请求 30 秒超时；不完整结果依然可查看和导出，但带提示。GitHub 搜索索引延迟不由扩展控制。
- 仅申请 storage、activeTab 和 api.github.com 主机权限；内容脚本在 github.com 识别页面，通过后台消息请求。页面按钮使用隔离 Shadow DOM 和 textContent，不执行 API 返回文本。

## 开发与验证

Node.js 22+。安装测试依赖后运行：

```sh
npm ci
npm test
node tests/live.js
node tests/browser.test.js
node tests/toolbar.js
```

浏览器脚本使用 Playwright + `/usr/local/bin/chromium`（可按本机路径调整）。可用 `CHROMIUM_PATH` 指定工具栏测试浏览器路径；其他浏览器脚本中的 executablePath 可按本机调整。测试依赖不参与扩展运行。真实页面与模拟响应验证的范围、限制见 [VALIDATION.md](VALIDATION.md)。

API 口径参考：[GitHub REST Search](https://docs.github.com/en/rest/search/search#search-issues-and-pull-requests)。
