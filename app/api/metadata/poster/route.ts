const posterHeaders = {
  accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  referer: "https://www.douban.com/",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36",
};

function allowedPosterUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (!url.hostname.endsWith(".doubanio.com")) return null;
    return url;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const posterUrl = allowedPosterUrl(requestUrl.searchParams.get("url") || "");
  if (!posterUrl) {
    return Response.json({ error: "海报地址无效。" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(posterUrl, {
      headers: posterHeaders,
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.startsWith("image/")) {
      return Response.json(
        { error: "豆瓣没有返回可用海报。" },
        { status: 502 },
      );
    }
    return new Response(await response.arrayBuffer(), {
      headers: {
        "cache-control": "private, max-age=86400",
        "content-type": contentType,
      },
    });
  } catch {
    return Response.json(
      { error: "海报下载失败，可以稍后重试或上传本地图片。" },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
