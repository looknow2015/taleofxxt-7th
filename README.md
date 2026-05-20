# 小西天儿物语封面投票墙

一个用于七周年活动的轻量网页：自动导入 RSS 节目封面，瀑布流展示，点击封面给对应节目投 1 票，并在本地 JSON 文件里统计票数。

## 运行

```bash
npm run import:rss
npm start
```

打开：

```text
http://localhost:4173
```

## 数据

- 节目数据：`data/episodes.json`
- 票数数据：`data/votes.json`
- 匿名留言：`data/messages.json`

`npm run import:rss` 会从公开 RSS `http://rss.lizhi.fm/rss/136028729.xml` 重新生成节目数据。票数不会被导入脚本覆盖。RSS 里的封面默认是 `80x80` 小图，导入脚本会自动改用 `640x640` 版本，以保证首页封面清晰度。

## 投票规则

当前版本每个匿名用户最多可投 3 票，同一期节目只能投 1 票，并做了两层限制：

- 浏览器端用 `localStorage` 保存匿名用户 ID。
- 服务端用匿名用户 ID、IP、User-Agent 的哈希值限制总票数和单期重复投票。

这适合朋友局、周年活动和轻量公开传播。如果要承受大流量或更强防刷，可以把 `data/votes.json` 换成 Supabase、Firebase 或正式数据库。

## 匿名留言

首页的匿名留言只提交到后台，不会在网站中公开展示。留言会写入 `data/messages.json`，每条包含：

```json
{
  "id": "uuid",
  "message": "留言内容",
  "createdAt": "提交时间"
}
```

## 替换为自有封面

现在默认使用 RSS 里的封面地址。若节目方有高清封面，可以：

1. 把图片放入 `public/covers/`。
2. 修改 `data/episodes.json` 里对应节目的 `coverUrl`，例如 `/covers/vol-206.jpg`。

## 部署建议

本地活动展示可直接运行 Node 服务。若要线上部署，推荐：

- 前端和接口部署到 Render、Railway、Fly.io 等支持持久服务的平台。
- 或改成 Next.js + Supabase 后部署到 Vercel。
