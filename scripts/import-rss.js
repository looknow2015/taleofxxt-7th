const fs = require("fs/promises");
const path = require("path");

const feedUrl = "http://rss.lizhi.fm/rss/136028729.xml";
const outputPath = path.join(__dirname, "..", "data", "episodes.json");

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function stripCdata(value) {
  return value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? decodeEntities(stripCdata(match[1].trim())) : "";
}

function attr(block, name, attrName) {
  const match = block.match(new RegExp(`<${name}[^>]*\\s${attrName}="([^"]+)"[^>]*\\/?\\s*>`, "i"));
  return match ? decodeEntities(match[1]) : "";
}

function toText(html) {
  return decodeEntities(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 12)
    .join("\n");
}

function episodeNoFromTitle(title, index) {
  const match = title.match(/vol\.(\d+)/i);
  return match ? Number(match[1]) : index + 1;
}

function highQualityCoverUrl(url) {
  return url.replace(/_(?:80|160|320)x(?:80|160|320)(\.[a-z]+)$/i, "_640x640$1");
}

async function main() {
  const response = await fetch(feedUrl);
  if (!response.ok) {
    throw new Error(`RSS request failed: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(match => match[1]);
  const episodes = itemBlocks.map((block, index) => {
    const title = tag(block, "title");
    const episodeNo = episodeNoFromTitle(title, index);
    const description = tag(block, "description");
    const duration = Number(tag(block, "itunes:duration") || 0);
    return {
      id: `vol-${episodeNo}`,
      episodeNo,
      title,
      coverUrl: highQualityCoverUrl(attr(block, "itunes:image", "href")),
      podcastUrl: tag(block, "link"),
      publishedAt: new Date(tag(block, "pubDate")).toISOString(),
      duration,
      summary: toText(description)
    };
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(episodes, null, 2)}\n`);
  console.log(`Imported ${episodes.length} episodes to ${outputPath}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
