type LookupKind = "book" | "movie" | "series";

type DoubanSearchCard = {
  title?: string;
  url?: string;
  cover_url?: string;
  year?: string;
  card_subtitle?: string;
  type?: string;
};

type DoubanPerson = {
  name?: string;
};

type DoubanSubject = {
  id?: string;
  title?: string;
  original_title?: string;
  year?: string;
  countries?: string[];
  durations?: string[];
  directors?: DoubanPerson[];
  actors?: DoubanPerson[];
  author?: string[];
  pages?: string[];
  pubdate?: string[];
  episodes_count?: number | string;
  last_episode_number?: number | string;
  pic?: {
    large?: string;
    normal?: string;
  };
  cover_url?: string;
  type?: string;
  subtype?: string;
  url?: string;
};

type CacheValue = {
  expiresAt: number;
  value: unknown;
};

const CACHE_TTL = 10 * 60 * 1000;
const responseCache = new Map<string, CacheValue>();

const requestHeaders = {
  accept: "application/json,text/plain,*/*",
  "accept-language": "zh-CN,zh;q=0.9",
  referer: "https://www.douban.com/",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36",
};

function cached<T>(key: string) {
  const item = responseCache.get(key);
  if (!item || item.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return null;
  }
  return item.value as T;
}

function cache(key: string, value: unknown) {
  responseCache.set(key, {
    expiresAt: Date.now() + CACHE_TTL,
    value,
  });
}

async function fetchDoubanJson<T>(url: URL) {
  let latestError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {
        headers: requestHeaders,
        redirect: "follow",
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Douban responded with ${response.status}`);
      }
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("Douban did not return JSON");
      }
      return (await response.json()) as T;
    } catch (error) {
      latestError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw latestError;
}

function lookupKind(value: string | null): LookupKind {
  return value === "book" || value === "series" ? value : "movie";
}

function subjectIdFromUrl(url: string, kind: LookupKind) {
  const host = kind === "book" ? "book" : "movie";
  return url.match(
    new RegExp(`^https:\\/\\/${host}\\.douban\\.com\\/subject\\/(\\d+)\\/?$`),
  )?.[1];
}

function names(people: DoubanPerson[] | undefined) {
  return (people || [])
    .map((person) => person.name?.trim() || "")
    .filter(Boolean);
}

function positiveInteger(value: number | string | undefined) {
  const match = String(value ?? "").match(/\d+/);
  const number = Number(match?.[0]);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function durationInMinutes(durations: string[] | undefined) {
  for (const duration of durations || []) {
    const minutes = Number(duration.match(/(\d+)\s*分钟/)?.[1]);
    if (Number.isFinite(minutes) && minutes > 0) return minutes;
  }
  return null;
}

function firstPositiveInteger(values: string[] | undefined) {
  for (const value of values || []) {
    const number = positiveInteger(value);
    if (number) return number;
  }
  return null;
}

function publicationYear(pubdate: string[] | undefined) {
  for (const value of pubdate || []) {
    const year = value.match(/(?:19|20)\d{2}/)?.[0];
    if (year) return year;
  }
  return "";
}

function sourceUrl(kind: LookupKind, id: string) {
  const host = kind === "book" ? "book" : "movie";
  return `https://${host}.douban.com/subject/${id}/`;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const kind = lookupKind(requestUrl.searchParams.get("kind"));
  const subjectId = requestUrl.searchParams.get("id")?.trim();

  try {
    if (subjectId) {
      if (!/^\d+$/.test(subjectId)) {
        return Response.json({ error: "豆瓣条目编号无效。" }, { status: 400 });
      }

      const cacheKey = `subject:${kind}:${subjectId}`;
      const cachedSubject = cached<Record<string, unknown>>(cacheKey);
      if (cachedSubject) return Response.json({ subject: cachedSubject });

      const url = new URL(
        `https://m.douban.com/rexxar/api/v2/subject/${subjectId}`,
      );
      const data = await fetchDoubanJson<DoubanSubject>(url);
      const totalUnits =
        kind === "book"
          ? firstPositiveInteger(data.pages)
          : kind === "series"
            ? positiveInteger(
                data.episodes_count ?? data.last_episode_number,
              )
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
      return Response.json({ subject });
    }

    const query = requestUrl.searchParams.get("q")?.trim() || "";
    if (!query) {
      return Response.json({ error: "请输入中文名称。" }, { status: 400 });
    }

    const cacheKey = `search:${kind}:${query.toLocaleLowerCase("zh-CN")}`;
    const cachedResults = cached<Array<Record<string, unknown>>>(cacheKey);
    if (cachedResults) return Response.json({ results: cachedResults });

    const url = new URL("https://www.douban.com/j/search_suggest");
    url.searchParams.set("q", query);
    const data = await fetchDoubanJson<{ cards?: DoubanSearchCard[] }>(url);
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
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .slice(0, 8);

    cache(cacheKey, results);
    return Response.json({ results });
  } catch {
    return Response.json(
      {
        code: "DOUBAN_UNAVAILABLE",
        error: "豆瓣当前没有返回资料，可以稍后重试或直接打开豆瓣搜索。",
      },
      { status: 502 },
    );
  }
}
