# Private Media Archive

本机使用的书影音观看记录网站。双击项目根目录中的
`打开本地网站.command`，然后访问 `http://127.0.0.1:4317/`。

记录目前保存在当前浏览器的 IndexedDB 中。

## 手机离线版（GitHub Pages）

推送到 `main` 后，GitHub Actions 会自动构建并更新：

`https://nicosakiri.github.io/private-media-archive/`

手机首次联网打开后，可以在 Safari 的分享菜单中选择“添加到主屏幕”。网站会缓存界面、图标和世界地图；之后没有网络时也可以打开并新增进度或感想。手机记录仍只保存在手机浏览器中，不会上传到 GitHub。

手机和电脑之间主要使用“数据同步 → AirDrop 数据包”：手机导出 `.pma` 文件并 AirDrop 到电脑，电脑导入时会自动与主数据库合并。建议偶尔保留一份 `.pma` 文件作为备份。

GitHub Pages 只提供静态前端，手机端豆瓣检索不可用；可以先手动记录，之后在电脑本地版中补充资料。

## 豆瓣资料自动填充

书籍、电影和剧集编辑页中的“豆瓣检索”会在点击搜索时按需联网：

1. 输入中文名，读取当前分类对应的豆瓣候选条目。
2. 选择正确条目，读取标题、创作者、年份等基础资料。
3. 书籍读取“页数”，电影读取“片长”，剧集读取“集数”，并自动填入总量。
4. “原名”会在豆瓣提供时自动填入，也可以随时手动粘贴或修改。
5. 豆瓣候选中的封面由本地服务下载一次并保存在条目中，避免图片防盗链；也可以上传本地图片替换。
6. 选中的豆瓣条目链接会随记录一同保存在本机。

不需要 API key；豆瓣没有返回资料时，可以使用“打开豆瓣”手动核对。

## 观看记录与日历

- “新增观看”用于建立一部书籍、电影或剧集条目。
- 打开表格中的条目后，使用“添加记录”更新本次进度、日期和感想。
- 最新一条记录会自动更新主页表格中的进度和状态。
- 条目详情分为“观看进度”和“感想”两条时间轴。
- 同一进度下可以写多次感想，但“观看进度”时间轴只保留一次进度节点。
- “观看日历”按日期汇总每一次记录，并用蓝、绿、红三色表示进行中、已看完和已弃。
- 统计页分为“书影音统计”和“网络小说统计”；网络文学不会混入书影音总数、评分或图表。

## EdgeOne Makers 部署

腾讯部署使用仓库内已经编译好的独立目录，避免与 Cloudflare 所需的 Next.js
依赖互相影响。在 EdgeOne 项目的“构建部署配置”中设置：

- 框架预设：React
- 根目录：`edgeone-deploy`

其余安装、编译和输出目录由 `edgeone-deploy/edgeone.json` 自动配置。

---

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
