# Validation record

## Original live verification — 2026-11-06

The Manifest V3 extension was loaded into Linux ARM64 Chromium using Playwright. These are snapshots of public GitHub data, which can change after the test.

| Scenario                                      | Observed result                                                                                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `microsoft/vscode/issues`                     | All 25 rows in the new Issue list had entries. Clicking liivats's inline button returned a successful seven-day report with zero PRs.                |
| `microsoft/vscode/pulls`                      | All 25 rows had entries.                                                                                                                             |
| `microsoft/vscode/pull/346472`                | One entry identified lszomoru. The same author appeared on Conversation, `/commits`, and `/files`.                                                   |
| Actual toolbar popup on the PR                | Opened with `chrome.action.openPopup()` and operated through CDP. Prefilled lszomoru and returned 49 PRs: 2 open, 46 merged, 1 closed without merge. |
| Actual toolbar popup on `github.com/lszomoru` | Prefilled lszomoru and returned the same report.                                                                                                     |
| Original report link                          | Opened PR #346472 and checked its title, repository, and author on GitHub.                                                                           |
| Request log                                   | Actual request records included pages, status, and rate-limit fields. Copy log succeeded.                                                            |
| Browser restart                               | Reopened the same dedicated profile and recovered the same 20 log entries.                                                                           |

These checks used a headless browser, not a physical toolbar-icon click. The actual action popup was operated using CDP because Playwright did not register it as an ordinary Page. The same report was also exercised in a normal extension tab. Certificate-ignore flags in the live test harness apply only to that test environment, not to the extension.

Historical evidence lives in `tests/live-evidence.json`, `tests/live-report.png`, `tests/toolbar-evidence.json`, and `tests/toolbar-profile-evidence.json`. Those original artifacts retain their original Chinese UI messages; they are not screenshots of the current English UI.

## Controlled browser responses

`npm run test:browser` loads the real extension into Chromium and intercepts GitHub responses. It uses a fake token rather than real credentials. It checks:

- Successful zero results, ordinary 403 errors, and explicit incomplete-results notices.
- Page 1 returning 200 with 100 records followed by page 2 returning 429: two separate log entries, the failed page identified, and no misleading complete report.
- Log copying, Markdown copying, state filtering, and title searching.
- Thirty-five rows mixing relative and absolute same-origin item URLs, profile links, author-filter links, and user hovercard buttons. Foreign origins, other repositories, navigation organizations, and leading assignees must not be mistaken for row authors.
- Four automatic anonymous author queries, manual querying beyond that budget, and at most 24 authenticated automatic queries.
- Row replacement without duplicate entries.
- A PR header author distinct from timeline reviewers across all three tabs.
- Persistent logs after closing and restarting Chromium.

The browser suite writes `tests/browser-evidence.json` with current messages. It runs in CI without live GitHub access.

## Unit and package verification

`npm test` covers exact timestamp boundaries, future-record exclusion, state partitions, duplicate records, sliding windows crossing clock buckets, adjacent creation counts, zero-activity days, incomplete results, error classification, per-page logging, concurrent query merging, concurrency limits, log and cache capacity, credential isolation, and authenticated cache reuse after worker restart.

`npm run test:package` independently parses the Chromium-generated CRX3, verifies its signature and extension ID, rejects an altered payload, compares both archives against the runtime-file allowlist and source bytes, and checks SHA-256 hashes. It does not claim that Chrome permits off-store CRX installation on every platform.

Real token access to private repositories, live rate limits, and signed-in personalized layouts were not tested. Those paths use controlled responses. The real 1,000-result search cap was not deliberately triggered. Future GitHub layout changes still require regression testing.
