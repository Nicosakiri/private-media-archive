const CACHE_TTL = 10 * 60 * 1000;
const responseCache = new Map();

const requestHeaders = {
  accept: "application/json,text/plain,*/*",
  "accept-language": "zh-CN,zh;q=0.9",
  referer: "https://www.douban.com/",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36",
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function cached(key) {
  const item = responseCache.get(key);
  if (!item || item.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return null;
  }
  return item.value;
}

function cache(key, value) {
  responseCache.set(key, { expiresAt: Date.now() + CACHE_TTL, value });
}

async function fetchDoubanJson(url) {
  let latestError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {
        headers: requestHeaders,
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Douban responded with ${response.status}`);
      }
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("Douban did not return JSON");
      }
      return await response.json();
    } catch (error) {
      latestError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw latestError;
}

function lookupKind(value) {
  return value === "book" || value === "series" ? value : "movie";
}

function subjectIdFromUrl(url, kind) {
  const host = kind === "book" ? "book" : "movie";
  return url.match(
    new RegExp(`^https:\\/\\/${host}\\.douban\\.com\\/subject\\/(\\d+)\\/?$`),
  )?.[1];
}

function names(people) {
  return (people || [])
    .map((person) => person.name?.trim() || "")
    .filter(Boolean);
}

function positiveInteger(value) {
  const match = String(value ?? "").match(/\d+/);
  const number = Number(match?.[0]);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function durationInMinutes(durations) {
  for (const duration of durations || []) {
    const minutes = Number(duration.match(/(\d+)\s*分钟/)?.[1]);
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

function publicationYear(pubdate) {
  for (const value of pubdate || []) {
    const year = value.match(/(?:19|20)\d{2}/)?.[0];
    if (year) return year;
  }
  return "";
}

function sourceUrl(kind, id) {
  const host = kind === "book" ? "book" : "movie";
  return `https://${host}.douban.com/subject/${id}/`;
}

async function handleRequest(request) {
  const requestUrl = new URL(request.url);
  const kind = lookupKind(requestUrl.searchParams.get("kind"));
  const subjectId = requestUrl.searchParams.get("id")?.trim();

  try {
    if (subjectId) {
      if (!/^\d+$/.test(subjectId)) {
        return json({ error: "豆瓣条目编号无效。" }, 400);
      }

      const cacheKey = `subject:${kind}:${subjectId}`;
      const cachedSubject = cached(cacheKey);
      if (cachedSubject) return json({ subject: cachedSubject });

      const url = new URL(
        `https://m.douban.com/rexxar/api/v2/subject/${subjectId}`,
      );
      const data = await fetchDoubanJson(url);
      const totalUnits =
        kind === "book"
          ? firstPositiveInteger(data.pages)
          : kind === "series"
            ? positiveInteger(data.episodes_count ?? data.last_episode_number)
            : durationInMinutes(data.durations);
      const subject = {
        id: data.id || subjectId,
        title: data.title?.trim() || "",
        originalTitle: data.original_title?.trim() || "",
        creators:
          kind === "book"
            ? (data.author || []).map((author) => author.trim()).filter(Boolean)
            : names(data.directors),
        actors: names(data.actors).slice(0, 12),
        countries: (data.countries || [])
          .map((country) => country.trim())
          .filter(Boolean),
        year: data.year?.trim() || publicationYear(data.pubdate),
        totalUnits,
        coverUrl:
          data.pic?.large?.trim() ||
          data.pic?.normal?.trim() ||
          data.cover_url?.trim() ||
          "",
        detectedType: data.type || data.subtype || "",
        sourceUrl: data.url || sourceUrl(kind, subjectId),
      };
      cache(cacheKey, subject);
      return json({ subject });
    }

    const query = requestUrl.searchParams.get("q")?.trim() || "";
    if (!query) return json({ error: "请输入中文名称。" }, 400);

    const cacheKey = `search:${kind}:${query.toLocaleLowerCase("zh-CN")}`;
    const cachedResults = cached(cacheKey);
    if (cachedResults) return json({ results: cachedResults });

    const url = new URL("https://www.douban.com/j/search_suggest");
    url.searchParams.set("q", query);
    const data = await fetchDoubanJson(url);
    const results = (data.cards || [])
      .map((card) => {
        const subjectUrl = card.url?.trim() || "";
        const id = subjectIdFromUrl(subjectUrl, kind);
        if (!id) return null;
        return {
          id,
          title: card.title?.trim() || "",
          year: card.year?.trim() || "",
          subtitle: card.card_subtitle?.trim() || "",
          coverUrl: card.cover_url?.trim() || "",
          sourceUrl: subjectUrl,
        };
      })
      .filter(Boolean)
      .slice(0, 8);

    cache(cacheKey, results);
    return json({ results });
  } catch {
    return json(
      {
        code: "DOUBAN_UNAVAILABLE",
        error: "豆瓣当前没有返回资料，可以稍后重试或直接打开豆瓣搜索。",
      },
      502,
    );
  }
}

export function onRequestGet(context) {
  return handleRequest(context.request);
}
