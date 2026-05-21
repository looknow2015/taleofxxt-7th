const crypto = require("crypto");
const fs = require("fs/promises");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const root = __dirname;
const publicDir = path.join(root, "public");
const dataDir = path.join(root, "data");
const episodesPath = path.join(dataDir, "episodes.json");
const votesPath = path.join(dataDir, "votes.json");
const messagesPath = path.join(dataDir, "messages.json");
const maxVotesPerUser = 3;
const adminToken = process.env.ADMIN_TOKEN || "xxt-admin";

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 100_000) {
        req.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function getClientKey(req, anonymousId) {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = Array.isArray(forwarded) ? forwarded[0] : String(forwarded || req.socket.remoteAddress || "");
  const ua = String(req.headers["user-agent"] || "");
  return crypto
    .createHash("sha256")
    .update(`${anonymousId || "anonymous"}|${ip.split(",")[0]}|${ua}`)
    .digest("hex");
}

async function getMergedEpisodes() {
  const episodes = await readJson(episodesPath, []);
  const votes = await readJson(votesPath, { totals: {}, records: [] });
  return episodes.map(episode => ({
    ...episode,
    votes: Number(votes.totals?.[episode.id] || 0)
  }));
}

function getVoterRecords(votes, voterHash) {
  return (votes.records || []).filter(record => record.voterHash === voterHash);
}

function requireAdmin(req, res, url) {
  const token = url.searchParams.get("token") || req.headers["x-admin-token"];
  if (token === adminToken) return true;
  send(res, 401, JSON.stringify({ error: "Unauthorized." }));
  return false;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

async function getAdminExport() {
  const [episodes, votes, messages] = await Promise.all([
    readJson(episodesPath, []),
    readJson(votesPath, { totals: {}, records: [] }),
    readJson(messagesPath, [])
  ]);
  const voteRows = episodes
    .map(episode => ({
      episodeId: episode.id,
      episodeNo: episode.episodeNo,
      title: episode.title,
      votes: Number(votes.totals?.[episode.id] || 0)
    }))
    .sort((a, b) => b.votes - a.votes || b.episodeNo - a.episodeNo);

  return {
    generatedAt: new Date().toISOString(),
    totalVotes: voteRows.reduce((sum, episode) => sum + episode.votes, 0),
    voterCount: new Set((votes.records || []).map(record => record.voterHash)).size,
    voteRows,
    voteRecords: votes.records || [],
    messages
  };
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/admin/export") {
    if (!requireAdmin(req, res, url)) return;
    const data = await getAdminExport();
    const format = url.searchParams.get("format") || "json";

    if (format === "votes.csv") {
      const rows = [
        ["episodeId", "episodeNo", "title", "votes"],
        ...data.voteRows.map(row => [row.episodeId, row.episodeNo, row.title, row.votes])
      ];
      send(res, 200, rows.map(row => row.map(csvEscape).join(",")).join("\n"), "text/csv; charset=utf-8");
      return;
    }

    if (format === "messages.csv") {
      const rows = [
        ["id", "createdAt", "message"],
        ...data.messages.map(row => [row.id, row.createdAt, row.message])
      ];
      send(res, 200, rows.map(row => row.map(csvEscape).join(",")).join("\n"), "text/csv; charset=utf-8");
      return;
    }

    send(res, 200, JSON.stringify(data));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/cover") {
    const coverUrl = url.searchParams.get("url") || "";
    const parsed = new URL(coverUrl);

    if (parsed.hostname !== "cdn.lizhi.fm") {
      send(res, 400, "Unsupported cover host.", "text/plain; charset=utf-8");
      return;
    }

    const response = await fetch(parsed, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://www.lizhi.fm/"
      }
    });

    if (!response.ok) {
      send(res, response.status, "Cover image unavailable.", "text/plain; charset=utf-8");
      return;
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400"
    });
    res.end(buffer);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/episodes") {
    const episodes = await getMergedEpisodes();
    send(res, 200, JSON.stringify({ episodes }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stats") {
    const episodes = await getMergedEpisodes();
    const totalVotes = episodes.reduce((sum, episode) => sum + episode.votes, 0);
    const leaders = [...episodes]
      .sort((a, b) => b.votes - a.votes || b.episodeNo - a.episodeNo)
      .slice(0, 12);
    send(res, 200, JSON.stringify({ totalVotes, leaders }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/vote-status") {
    const anonymousId = String(url.searchParams.get("anonymousId") || "");
    const votes = await readJson(votesPath, { totals: {}, records: [] });
    const voterHash = getClientKey(req, anonymousId);
    const records = getVoterRecords(votes, voterHash);
    send(res, 200, JSON.stringify({
      maxVotes: maxVotesPerUser,
      usedVotes: records.length,
      remainingVotes: Math.max(0, maxVotesPerUser - records.length),
      votedEpisodeIds: records.map(record => record.episodeId)
    }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/vote") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const episodeId = String(body.episodeId || "");
    const anonymousId = String(body.anonymousId || "");
    const episodes = await readJson(episodesPath, []);
    const episode = episodes.find(item => item.id === episodeId);

    if (!episode) {
      send(res, 404, JSON.stringify({ error: "Episode not found." }));
      return;
    }

    const votes = await readJson(votesPath, { totals: {}, records: [] });
    const voterHash = getClientKey(req, anonymousId);
    const recordKey = `${episodeId}:${voterHash}`;
    const userRecords = getVoterRecords(votes, voterHash);
    const alreadyVoted = userRecords.some(record => record.episodeId === episodeId);

    if (!alreadyVoted && userRecords.length >= maxVotesPerUser) {
      send(res, 403, JSON.stringify({
        error: "No votes remaining.",
        maxVotes: maxVotesPerUser,
        usedVotes: userRecords.length,
        remainingVotes: 0
      }));
      return;
    }

    if (!alreadyVoted) {
      votes.totals[episodeId] = Number(votes.totals[episodeId] || 0) + 1;
      votes.records.push({
        key: recordKey,
        episodeId,
        voterHash,
        createdAt: new Date().toISOString()
      });
      await writeJson(votesPath, votes);
    }

    send(res, 200, JSON.stringify({
      ok: true,
      duplicate: alreadyVoted,
      episodeId,
      votes: Number(votes.totals[episodeId] || 0),
      maxVotes: maxVotesPerUser,
      usedVotes: alreadyVoted ? userRecords.length : userRecords.length + 1,
      remainingVotes: alreadyVoted ? Math.max(0, maxVotesPerUser - userRecords.length) : Math.max(0, maxVotesPerUser - userRecords.length - 1)
    }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/message") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const text = String(body.message || "").trim();

    if (!text) {
      send(res, 400, JSON.stringify({ error: "Message is required." }));
      return;
    }

    if (text.length > 500) {
      send(res, 400, JSON.stringify({ error: "Message is too long." }));
      return;
    }

    const messages = await readJson(messagesPath, []);
    messages.push({
      id: crypto.randomUUID(),
      message: text,
      createdAt: new Date().toISOString()
    });
    await writeJson(messagesPath, messages);

    send(res, 200, JSON.stringify({ ok: true }));
    return;
  }

  send(res, 404, JSON.stringify({ error: "Not found." }));
}

async function serveStatic(req, res, url) {
  const routePath = url.pathname === "/admin" ? "/admin.html" : url.pathname;
  const cleanPath = decodeURIComponent(routePath === "/" ? "/index.html" : routePath);
  const filePath = path.normalize(path.join(publicDir, cleanPath));

  if (!filePath.startsWith(publicDir)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream"
    });
    res.end(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      send(res, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    send(res, 500, JSON.stringify({ error: "Internal server error." }));
  }
});

server.listen(port, host, () => {
  console.log(`小西天儿物语封面投票墙已启动：http://${host}:${port}`);
});
