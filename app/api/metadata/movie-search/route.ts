type LookupKind = "book" | "movie" | "series";

type DoubanSearchCard = {
  id?: number | string;
  title?: string;
  url?: string;
  cover_url?: string;
  img?: string;
  year?: string;
  card_subtitle?: string;
  sub_title?: string;
  subtitle?: string;
  type?: string;
  target_type?: string;
  uri?: string;
  cover?: string | { url?: string; normal?: string; large?: string };
  pic?: { normal?: string; large?: string };
};

type DoubanSearchItem = DoubanSearchCard & {
  target?: DoubanSearchCard;
  subject?: DoubanSearchCard;
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

const frodoApiKey = "0dad551ec0f84ed02907ff5c42e8ec70";
const frodoApiSecret = "bf7dddc7c9cfe6f7";
const frodoUserAgent =
  "api-client/1 com.douban.frodo/7.21.0(214) Android/29 product/blueline vendor/Google model/Pixel 3 rom/android network/wifi platform/mobile nd/1";

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

async function fetchDoubanJson<T>(
  url: URL,
  extraHeaders: Record<string, string> = {},
) {
  let latestError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {
        headers: {
          ...requestHeaders,
          ...extraHeaders,
          referer:
            extraHeaders.referer ||
            (url.hostname === "book.douban.com" ||
            url.hostname === "movie.douban.com"
              ? `${url.origin}/`
              : requestHeaders.referer),
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
        return JSON.parse(body) as T;
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

async function signedFrodoSearchUrl(query: string) {
  const path = "/api/v2/search/subjects";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const message = `GET&${encodeURIComponent(path)}&${timestamp}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(frodoApiSecret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  const encodedSignature = btoa(
    String.fromCharCode(...new Uint8Array(signature)),
  );
  const url = new URL(`https://frodo.douban.com${path}`);
  url.searchParams.set("q", query);
  url.searchParams.set("start", "0");
  url.searchParams.set("count", "12");
  url.searchParams.set("apikey", frodoApiKey);
  url.searchParams.set("_ts", timestamp);
  url.searchParams.set("_sig", encodedSignature);
  return url;
}

function lookupKind(value: string | null): LookupKind {
  return value === "book" || value === "series" ? value : "movie";
}

function subjectIdFromUrl(url: string, kind: LookupKind) {
  try {
    const parsed = new URL(url);
    const expectedHost =
      kind === "book" ? "book.douban.com" : "movie.douban.com";
    if (parsed.hostname !== expectedHost) return null;
    return parsed.pathname.match(/^\/subject\/(\d+)\/?$/)?.[1] || null;
  } catch {
    return null;
  }
}

function normalizeSearchResults(
  data: DoubanSearchCard[] | { cards?: DoubanSearchCard[] },
  kind: LookupKind,
) {
  const cards = Array.isArray(data)
    ? data
    : Array.isArray(data.cards)
      ? data.cards
      : null;
  if (!cards) throw new Error("Douban search returned an unexpected shape");

  return cards
    .map((card) => {
      const rawId = String(card.id ?? "").trim();
      const rawUrl = card.url?.trim() || "";
      const id = /^\d+$/.test(rawId)
        ? rawId
        : subjectIdFromUrl(rawUrl, kind);
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
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 8);
}

function normalizeFrodoSearchResults(
  data: { items?: DoubanSearchItem[] },
  kind: LookupKind,
) {
  if (!Array.isArray(data.items)) {
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
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 8);
}

async function searchDouban(query: string, kind: LookupKind) {
  const categoryUrl = new URL(
    `https://${kind === "book" ? "book" : "movie"}.douban.com/j/subject_suggest`,
  );
  categoryUrl.searchParams.set("q", query);

  const combinedUrl = new URL("https://www.douban.com/j/search_suggest");
  combinedUrl.searchParams.set("q", query);

  let latestError: unknown;

  try {
    const frodoUrl = await signedFrodoSearchUrl(query);
    const data = await fetchDoubanJson<{ items?: DoubanSearchItem[] }>(
      frodoUrl,
      {
        accept: "application/json",
        "accept-language": "zh-CN,zh;q=0.9",
        "user-agent": frodoUserAgent,
        referer: "https://m.douban.com/",
      },
    );
    const results = normalizeFrodoSearchResults(data, kind);
    if (results.length > 0) return results;
  } catch (error) {
    latestError = error;
  }

  for (const url of [categoryUrl, combinedUrl]) {
    try {
      const data = await fetchDoubanJson<
        DoubanSearchCard[] | { cards?: DoubanSearchCard[] }
      >(url);
      return normalizeSearchResults(data, kind);
    } catch (error) {
      latestError = error;
    }
  }
  throw latestError;
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

    const results = await searchDouban(query, kind);

    cache(cacheKey, results);
    return Response.json({ results });
  } catch (error) {
    console.error("[Private Media Archive] Douban lookup failed:", error);
    return Response.json(
      {
        code: "DOUBAN_UNAVAILABLE",
        error: "豆瓣当前没有返回资料，可以稍后重试或直接打开豆瓣搜索。",
      },
      { status: 502 },
    );
  }
}
