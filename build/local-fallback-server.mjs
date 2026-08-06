import { createHmac, randomInt } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { networkInterfaces, homedir, hostname } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const staticRoot = join(projectRoot, "github-pages");
const pagesPrefix = "/private-media-archive/";
const port = Number(process.argv[2]) || 4317;
const pairingCode = String(randomInt(0, 1_000_000)).padStart(6, "0");
const snapshotPath = join(
  homedir(),
  "Library",
  "Application Support",
  "Private Media Archive",
  "lan-sync.json",
);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
};

const requestHeaders = {
  accept: "application/json,text/plain,*/*",
  "accept-language": "zh-CN,zh;q=0.9",
  referer: "https://www.douban.com/",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36",
};

const frodoApiKey = "0dad551ec0f84ed02907ff5c42e8ec70";
const frodoApiSecret = "bf7dddc7c9cfe6f7";
const frodoUserAgent =
  "api-client/1 com.douban.frodo/7.21.0(214) Android/29 product/blueline vendor/Google model/Pixel 3 rom/android network/wifi platform/mobile nd/1";

const posterHeaders = {
  accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  referer: "https://www.douban.com/",
  "user-agent": requestHeaders["user-agent"],
};

const responseCache = new Map();
const cacheTtl = 10 * 60 * 1000;
let snapshotPromise = readSnapshot();
let activePages = 0;
let hasConnectedPage = false;
let shutdownTimer;

function json(response, value, statusCode = 200) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

function isLoopback(request) {
  const address = request.socket.remoteAddress || "";
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function localUrls() {
  const addresses = new Set();
  const localName = hostname();
  if (localName) {
    addresses.add(
      `http://${localName.endsWith(".local") ? localName : `${localName}.local`}:${port}`,
    );
  }
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const item of interfaces || []) {
      if (item.family === "IPv4" && !item.internal) {
        addresses.add(`http://${item.address}:${port}`);
      }
    }
  }
  return Array.from(addresses);
}

function timestamp(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function parseArchive(value) {
  if (!value || typeof value !== "object") {
    throw new Error("同步包内容无效。");
  }
  if (
    value.format !== "private-media-archive" ||
    value.version !== 1 ||
    !Array.isArray(value.entries) ||
    !Array.isArray(value.deletedEntries) ||
    !value.preferences ||
    typeof value.exportedAt !== "string"
  ) {
    throw new Error("这不是可识别的 Private Media Archive 同步包。");
  }
  return value;
}

function mergeArchives(left, right) {
  const entries = new Map();
  for (const entry of [...left.entries, ...right.entries]) {
    const current = entries.get(entry.id);
    if (!current || timestamp(entry.updatedAt) > timestamp(current.updatedAt)) {
      entries.set(entry.id, entry);
    }
  }

  const deletions = new Map();
  for (const deletion of [...left.deletedEntries, ...right.deletedEntries]) {
    const current = deletions.get(deletion.id);
    if (!current || timestamp(deletion.deletedAt) > timestamp(current.deletedAt)) {
      deletions.set(deletion.id, deletion);
    }
  }

  for (const [id, deletion] of deletions) {
    const entry = entries.get(id);
    if (!entry || timestamp(deletion.deletedAt) >= timestamp(entry.updatedAt)) {
      entries.delete(id);
    } else {
      deletions.delete(id);
    }
  }

  const newest =
    timestamp(right.exportedAt) >= timestamp(left.exportedAt) ? right : left;
  return {
    format: "private-media-archive",
    version: 1,
    exportedAt: new Date().toISOString(),
    deviceId: newest.deviceId,
    entries: Array.from(entries.values()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    ),
    deletedEntries: Array.from(deletions.values()),
    preferences: newest.preferences,
  };
}

async function readSnapshot() {
  try {
    const parsed = JSON.parse(await readFile(snapshotPath, "utf8"));
    return {
      revision: Number(parsed.revision) || 0,
      updatedAt: parsed.updatedAt || "",
      archive: parseArchive(parsed.archive),
    };
  } catch {
    return null;
  }
}

async function saveSnapshot(snapshot) {
  await mkdir(dirname(snapshotPath), { recursive: true });
  const temporaryPath = `${snapshotPath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(snapshot), "utf8");
  await rename(temporaryPath, snapshotPath);
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 80 * 1024 * 1024) {
      throw new Error("同步包超过 80MB，请先减少或压缩图片。");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function handleSession(request, response) {
  hasConnectedPage = true;
  activePages += 1;
  if (shutdownTimer) clearTimeout(shutdownTimer);
  response.writeHead(200, {
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
  });
  response.write("data: connected\n\n");
  const keepAlive = setInterval(() => response.write(": keep-alive\n\n"), 15000);
  request.on("close", () => {
    clearInterval(keepAlive);
    activePages = Math.max(0, activePages - 1);
    if (!hasConnectedPage || activePages > 0) return;
    shutdownTimer = setTimeout(() => {
      if (activePages > 0) return;
      server.close(() => process.exit(0));
    }, 5000);
  });
}

async function handleSync(request, response, url) {
  const hostRequest = isLoopback(request);
  const suppliedCode = request.headers["x-pma-pairing-code"];
  const authorized = hostRequest || suppliedCode === pairingCode;

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/__pma/sync/status") {
    const snapshot = await snapshotPromise;
    json(response, {
      available: true,
      isHost: hostRequest,
      pairingCode: hostRequest ? pairingCode : null,
      urls: hostRequest ? localUrls() : [],
      revision: snapshot?.revision || 0,
      updatedAt: snapshot?.updatedAt || "",
      entryCount: snapshot?.archive.entries.length || 0,
    });
    return;
  }

  if (!authorized) {
    json(response, { error: "配对码不正确，请查看电脑上的同步窗口。" }, 401);
    return;
  }

  if (request.method === "GET" && url.pathname === "/__pma/sync/pull") {
    const snapshot = await snapshotPromise;
    if (!snapshot) {
      json(response, { error: "电脑端还没有准备同步数据。" }, 404);
      return;
    }
    json(response, snapshot);
    return;
  }

  if (request.method === "POST" && url.pathname === "/__pma/sync/merge") {
    const body = await readJsonBody(request);
    const incoming = parseArchive(body?.archive);
    const current = await snapshotPromise;
    const archive = current ? mergeArchives(current.archive, incoming) : incoming;
    const nextSnapshot = {
      revision: (current?.revision || 0) + 1,
      updatedAt: new Date().toISOString(),
      archive,
    };
    snapshotPromise = Promise.resolve(nextSnapshot);
    await saveSnapshot(nextSnapshot);
    json(response, nextSnapshot);
    return;
  }

  json(response, { error: "同步地址不存在。" }, 404);
}

function cacheGet(key) {
  const item = responseCache.get(key);
  if (!item || item.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return null;
  }
  return item.value;
}

function cacheSet(key, value) {
  responseCache.set(key, { expiresAt: Date.now() + cacheTtl, value });
}

async function fetchDoubanJson(url, extraHeaders = {}) {
  let latestError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {
        headers: {
          ...requestHeaders,
          ...extraHeaders,
          referer: extraHeaders.referer || `${url.origin}/`,
        },
        redirect: "follow",
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(
          `Douban ${url.hostname}${url.pathname} responded with ${response.status}`,
        );
      }
      const body = await response.text();
      try {
        return JSON.parse(body);
      } catch {
        throw new Error("Douban did not return valid JSON");
      }
    } catch (error) {
      latestError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw latestError;
}

function signedFrodoSearchUrl(query) {
  const path = "/api/v2/search/subjects";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const message = `GET&${encodeURIComponent(path)}&${timestamp}`;
  const signature = createHmac("sha1", frodoApiSecret)
    .update(message)
    .digest("base64");
  const url = new URL(`https://frodo.douban.com${path}`);
  url.searchParams.set("q", query);
  url.searchParams.set("start", "0");
  url.searchParams.set("count", "12");
  url.searchParams.set("apikey", frodoApiKey);
  url.searchParams.set("_ts", timestamp);
  url.searchParams.set("_sig", signature);
  return url;
}

function lookupKind(value) {
  return value === "book" || value === "series" ? value : "movie";
}

function subjectIdFromUrl(value, kind) {
  try {
    const url = new URL(value);
    const expectedHost = kind === "book" ? "book.douban.com" : "movie.douban.com";
    if (url.hostname !== expectedHost) return null;
    return url.pathname.match(/^\/subject\/(\d+)\/?$/)?.[1] || null;
  } catch {
    return null;
  }
}

function normalizeSearchResults(data, kind) {
  const cards = Array.isArray(data)
    ? data
    : Array.isArray(data?.cards)
      ? data.cards
      : null;
  if (!cards) throw new Error("Douban search returned an unexpected shape");

  return cards
    .map((card) => {
      const rawId = String(card.id ?? "").trim();
      const rawUrl = card.url?.trim() || "";
      const id = /^\d+$/.test(rawId) ? rawId : subjectIdFromUrl(rawUrl, kind);
      if (!id) return null;
      return {
        id,
        title: card.title?.trim() || "",
        year: String(card.year ?? "").trim(),
        subtitle:
          card.card_subtitle?.trim() ||
          card.sub_title?.trim() ||
          card.subtitle?.trim() ||
          "",
        coverUrl:
          card.cover_url?.trim() ||
          card.img?.trim() ||
          (typeof card.cover === "string" ? card.cover.trim() : "") ||
          (typeof card.cover === "object"
            ? card.cover.large?.trim() ||
              card.cover.normal?.trim() ||
              card.cover.url?.trim() ||
              ""
            : "") ||
          card.pic?.large?.trim() ||
          card.pic?.normal?.trim() ||
          "",
        sourceUrl: rawUrl || sourceUrl(kind, id),
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeFrodoSearchResults(data, kind) {
  if (!Array.isArray(data?.items)) {
    throw new Error("Douban mobile search returned an unexpected shape");
  }
  const expectedTypes = kind === "book" ? ["book"] : ["movie", "tv"];
  return data.items
    .map((item) => {
      const card = item.target || item.subject || item;
      const targetType = String(
        item.target_type || card.target_type || card.type || "",
      ).toLowerCase();
      if (
        targetType &&
        !expectedTypes.some((expected) => targetType.includes(expected))
      ) {
        return null;
      }
      const rawUrl = card.url?.trim() || "";
      const rawUri = card.uri?.trim() || "";
      const rawId = String(card.id ?? item.id ?? "").trim();
      const id = /^\d+$/.test(rawId)
        ? rawId
        : rawUrl.match(/\/subject\/(\d+)/)?.[1] ||
          rawUri.match(/\/(?:book|movie|tv)\/(\d+)/)?.[1] ||
          null;
      if (!id) return null;
      const cover = card.cover;
      return {
        id,
        title: card.title?.trim() || "",
        year: String(card.year ?? "").trim(),
        subtitle:
          card.card_subtitle?.trim() ||
          card.sub_title?.trim() ||
          card.subtitle?.trim() ||
          "",
        coverUrl:
          card.cover_url?.trim() ||
          card.img?.trim() ||
          (typeof cover === "string" ? cover.trim() : "") ||
          (typeof cover === "object"
            ? cover.large?.trim() ||
              cover.normal?.trim() ||
              cover.url?.trim() ||
              ""
            : "") ||
          card.pic?.large?.trim() ||
          card.pic?.normal?.trim() ||
          "",
        sourceUrl: rawUrl || sourceUrl(kind, id),
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

async function searchDouban(query, kind) {
  const categoryUrl = new URL(
    `https://${kind === "book" ? "book" : "movie"}.douban.com/j/subject_suggest`,
  );
  categoryUrl.searchParams.set("q", query);
  const combinedUrl = new URL("https://www.douban.com/j/search_suggest");
  combinedUrl.searchParams.set("q", query);

  let latestError;

  try {
    const data = await fetchDoubanJson(signedFrodoSearchUrl(query), {
      accept: "application/json",
      "accept-language": "zh-CN,zh;q=0.9",
      "user-agent": frodoUserAgent,
      referer: "https://m.douban.com/",
    });
    const results = normalizeFrodoSearchResults(data, kind);
    if (results.length > 0) return results;
  } catch (error) {
    latestError = error;
  }

  for (const url of [categoryUrl, combinedUrl]) {
    try {
      return normalizeSearchResults(await fetchDoubanJson(url), kind);
    } catch (error) {
      latestError = error;
    }
  }
  throw latestError;
}

function names(people) {
  return (people || []).map((person) => person.name?.trim() || "").filter(Boolean);
}

function positiveInteger(value) {
  const number = Number(String(value ?? "").match(/\d+/)?.[0]);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function durationInMinutes(values) {
  for (const value of values || []) {
    const minutes = Number(value.match(/(\d+)\s*分钟/)?.[1]);
    if (Number.isFinite(minutes) && minutes > 0) return minutes;
  }
  return null;
}

function firstPositiveInteger(values) {
  for (const value of values || []) {
    const number = positiveInteger(value);
    if (number) return number;
  }
  return null;
}

function publicationYear(values) {
  for (const value of values || []) {
    const year = value.match(/(?:19|20)\d{2}/)?.[0];
    if (year) return year;
  }
  return "";
}

function sourceUrl(kind, id) {
  return `https://${kind === "book" ? "book" : "movie"}.douban.com/subject/${id}/`;
}

async function handleMetadata(response, url) {
  const kind = lookupKind(url.searchParams.get("kind"));
  const subjectId = url.searchParams.get("id")?.trim();
  try {
    if (subjectId) {
      if (!/^\d+$/.test(subjectId)) {
        json(response, { error: "豆瓣条目编号无效。" }, 400);
        return;
      }
      const cacheKey = `subject:${kind}:${subjectId}`;
      const cached = cacheGet(cacheKey);
      if (cached) {
        json(response, { subject: cached });
        return;
      }
      const data = await fetchDoubanJson(
        new URL(`https://m.douban.com/rexxar/api/v2/subject/${subjectId}`),
      );
      const subject = {
        id: data.id || subjectId,
        title: data.title?.trim() || "",
        originalTitle: data.original_title?.trim() || "",
        creators:
          kind === "book"
            ? (data.author || []).map((author) => author.trim()).filter(Boolean)
            : names(data.directors),
        actors: names(data.actors).slice(0, 12),
        countries: (data.countries || []).map((country) => country.trim()).filter(Boolean),
        year: data.year?.trim() || publicationYear(data.pubdate),
        totalUnits:
          kind === "book"
            ? firstPositiveInteger(data.pages)
            : kind === "series"
              ? positiveInteger(data.episodes_count ?? data.last_episode_number)
              : durationInMinutes(data.durations),
        coverUrl:
          data.pic?.large?.trim() ||
          data.pic?.normal?.trim() ||
          data.cover_url?.trim() ||
          "",
        detectedType: data.type || data.subtype || "",
        sourceUrl: data.url || sourceUrl(kind, subjectId),
      };
      cacheSet(cacheKey, subject);
      json(response, { subject });
      return;
    }

    const query = url.searchParams.get("q")?.trim() || "";
    if (!query) {
      json(response, { error: "请输入中文名称。" }, 400);
      return;
    }
    const cacheKey = `search:${kind}:${query.toLocaleLowerCase("zh-CN")}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      json(response, { results: cached });
      return;
    }
    const results = await searchDouban(query, kind);
    cacheSet(cacheKey, results);
    json(response, { results });
  } catch (error) {
    console.error("[Private Media Archive] Douban lookup failed:", error);
    json(
      response,
      {
        code: "DOUBAN_UNAVAILABLE",
        error: "豆瓣当前没有返回资料，可以稍后重试或直接打开豆瓣搜索。",
      },
      502,
    );
  }
}

function allowedPosterUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".doubanio.com")
      ? url
      : null;
  } catch {
    return null;
  }
}

async function handlePoster(response, url) {
  const posterUrl = allowedPosterUrl(url.searchParams.get("url") || "");
  if (!posterUrl) {
    json(response, { error: "海报地址无效。" }, 400);
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const upstream = await fetch(posterUrl, {
      headers: posterHeaders,
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    });
    const contentType = upstream.headers.get("content-type") || "";
    if (!upstream.ok || !contentType.startsWith("image/")) {
      json(response, { error: "豆瓣没有返回可用海报。" }, 502);
      return;
    }
    const body = Buffer.from(await upstream.arrayBuffer());
    response.writeHead(200, {
      "Cache-Control": "private, max-age=86400",
      "Content-Length": body.length,
      "Content-Type": contentType,
    });
    response.end(body);
  } catch {
    json(response, { error: "海报下载失败，可以稍后重试或上传本地图片。" }, 502);
  } finally {
    clearTimeout(timeout);
  }
}

function safeStaticPath(pathname) {
  let relativePath;
  if (pathname === pagesPrefix.slice(0, -1) || pathname === pagesPrefix) {
    relativePath = "index.html";
  } else if (pathname.startsWith(pagesPrefix)) {
    relativePath = decodeURIComponent(pathname.slice(pagesPrefix.length));
  } else if (
    /^\/(favicon\.svg|manifest\.webmanifest|nicosakiri-avatar\.png|pma-icon\.svg|world-countries\.geojson)$/.test(
      pathname,
    )
  ) {
    relativePath = pathname.slice(1);
  } else {
    return null;
  }
  const candidate = resolve(staticRoot, relativePath || "index.html");
  if (candidate !== staticRoot && !candidate.startsWith(`${staticRoot}${sep}`)) {
    return null;
  }
  return candidate;
}

async function serveStatic(request, response, url) {
  let filePath = safeStaticPath(url.pathname);
  if (!filePath) {
    response.writeHead(302, { Location: pagesPrefix });
    response.end();
    return;
  }
  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) filePath = join(filePath, "index.html");
    const contentType = mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, {
      "Cache-Control": filePath.endsWith("index.html") || filePath.endsWith("sw.js")
        ? "no-cache"
        : "public, max-age=31536000, immutable",
      "Content-Length": (await stat(filePath)).size,
      "Content-Type": contentType,
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  try {
    if (url.pathname === "/__pma/session" && request.method === "GET") {
      handleSession(request, response);
      return;
    }
    if (url.pathname.startsWith("/__pma/sync/")) {
      await handleSync(request, response, url);
      return;
    }
    if (url.pathname === "/api/metadata/movie-search" && request.method === "GET") {
      await handleMetadata(response, url);
      return;
    }
    if (url.pathname === "/api/metadata/poster" && request.method === "GET") {
      await handlePoster(response, url);
      return;
    }
    if (url.pathname === "/") {
      response.writeHead(302, { Location: pagesPrefix });
      response.end();
      return;
    }
    await serveStatic(request, response, url);
  } catch (error) {
    json(response, { error: error instanceof Error ? error.message : "本地服务出错。" }, 500);
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Private Media Archive fallback server: http://127.0.0.1:${port}/`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
