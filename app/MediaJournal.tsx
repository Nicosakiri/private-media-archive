"use client";

import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  listLocalEntries,
  removeLocalEntry,
  saveLocalEntry,
} from "./local-entry-store";
import {
  bookCategoryMeta,
  calculateProgress,
  defaultProgressUnit,
  deriveStatus,
  makeProgressText,
  movieModeMeta,
  progressUnitMeta,
  seriesCategoryMeta,
  statusMeta,
  typeMeta,
} from "./media-types";
import type {
  BookCategory,
  Entry,
  EntryForm,
  EntryStatus,
  MediaType,
  MovieMode,
  Note,
  SeriesCategory,
} from "./media-types";

type DoubanLookupResult = {
  id: string;
  title: string;
  year: string;
  subtitle: string;
  coverUrl: string;
  sourceUrl: string;
};

type DoubanLookupDetails = {
  id: string;
  title: string;
  originalTitle: string;
  creators: string[];
  actors: string[];
  countries: string[];
  year: string;
  totalUnits: number | null;
  coverUrl: string;
  sourceUrl: string;
};

type ViewingRecordForm = {
  currentUnits: string;
  watchedAt: string;
  thought: string;
  status: EntryStatus;
  rating: number;
};

const today = () => {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
};

const emptyForm = (): EntryForm => ({
  title: "",
  originalTitle: "",
  creator: "",
  mediaType: "book",
  bookCategory: "literary",
  seriesCategory: "tv",
  movieMode: "",
  status: "in_progress",
  progressUnit: "page",
  totalUnits: "",
  currentUnits: "",
  platform: "",
  country: "",
  cast: "",
  year: "",
  doubanUrl: "",
  coverUrl: "",
  lastSeenAt: today(),
  rating: 0,
  thought: "",
});

function formatDate(date: string) {
  if (!date) return "未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date.slice(0, 10)}T12:00:00`));
}

function numberFromForm(value: string) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function doubanSearchNoun(mediaType: MediaType) {
  if (mediaType === "book") return "书名";
  if (mediaType === "movie") return "片名";
  return "剧名";
}

function doubanFilledMessage(mediaType: MediaType) {
  if (mediaType === "book") {
    return "已从豆瓣填充中文书名、作者、年份与总页数。";
  }
  if (mediaType === "series") {
    return "已从豆瓣填充中文剧名、原名、总集数、主创、主演、国家与年份。";
  }
  return "已从豆瓣填充中文片名、原名、片长、导演、主演、国家与年份。";
}

function viewingRecordForm(entry: Entry): ViewingRecordForm {
  return {
    currentUnits: entry.currentUnits ? String(entry.currentUnits) : "",
    watchedAt: today(),
    thought: "",
    status: entry.status === "abandoned" ? "in_progress" : entry.status,
    rating: entry.rating || 0,
  };
}

function calendarProgressLabel(entry: Entry, note: Note) {
  if (entry.mediaType === "movie" && entry.movieMode === "cinema") {
    return "影院观看";
  }
  if (!note.currentUnits) return note.progressText || "开始观看";
  return `${note.currentUnits}${progressUnitMeta[entry.progressUnit].unit}`;
}

function progressTimelineNotes(notes: Note[]) {
  return notes.filter((note, index) => {
    const previousProgress = notes[index + 1];
    if (!previousProgress) return true;
    return (
      note.currentUnits !== previousProgress.currentUnits ||
      note.status !== previousProgress.status
    );
  });
}

function posterProxyUrl(url: string) {
  return `/api/metadata/poster?url=${encodeURIComponent(url)}`;
}

async function localizePoster(url: string) {
  if (!url || url.startsWith("data:") || url.startsWith("blob:")) return url;
  const response = await fetch(posterProxyUrl(url));
  if (!response.ok) throw new Error("Poster download failed");
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function subtypeLabel(entry: Entry) {
  if (entry.mediaType === "book" && entry.bookCategory) {
    return bookCategoryMeta[entry.bookCategory];
  }
  if (entry.mediaType === "movie" && entry.movieMode) {
    return typeMeta.movie.label;
  }
  if (entry.mediaType === "series" && entry.seriesCategory) {
    return seriesCategoryMeta[entry.seriesCategory];
  }
  return typeMeta[entry.mediaType].label;
}

function Score({
  value,
  interactive = false,
  onChange,
}: {
  value: number;
  interactive?: boolean;
  onChange?: (value: number) => void;
}) {
  if (!interactive) {
    return (
      <span className="score-readout-inline">
        <strong>{value}</strong>
        <small>/ 10</small>
      </span>
    );
  }

  return (
    <div className="interactive-score" aria-label="十分制评分">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((point) => (
        <button
          aria-label={`${point} 分`}
          className={point === value ? "score-point active" : "score-point"}
          key={point}
          onClick={() => onChange?.(point === value ? 0 : point)}
          type="button"
        >
          {point}
        </button>
      ))}
    </div>
  );
}

function ProgressBar({
  percent,
  compact = false,
}: {
  percent: number;
  compact?: boolean;
}) {
  return (
    <div className={`progress-visual ${compact ? "compact" : ""}`}>
      <div
        aria-label={`进度 ${percent}%`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        className="progress-track"
        role="progressbar"
      >
        <span
          style={{
            width: `${percent}%`,
            background: `color-mix(in srgb, var(--progress-blue) ${100 - percent}%, var(--progress-green) ${percent}%)`,
          }}
        />
      </div>
      <strong>{percent}%</strong>
    </div>
  );
}

function RecordTable({
  entries,
  loading,
  onOpen,
}: {
  entries: Entry[];
  loading: boolean;
  onOpen: (entry: Entry) => void;
}) {
  return (
    <div className="table-shell">
      <table className="records-table">
        <thead>
          <tr>
            <th><span className="property-icon">Aa</span>名称</th>
            <th><span className="property-icon">◉</span>分类</th>
            <th><span className="property-icon">⑩</span>评分</th>
            <th><span className="property-icon">≡</span>作者 / 导演 / 主创</th>
            <th><span className="property-icon">◎</span>国家 / 地区</th>
            <th><span className="property-icon">⌁</span>平台 / 版本</th>
            <th><span className="property-icon">▬</span>进度</th>
            <th><span className="property-icon">⌖</span>当前位置</th>
            <th><span className="property-icon">□</span>最近更新</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            [0, 1, 2, 3].map((row) => (
              <tr className="table-loading-row" key={row}>
                {Array.from({ length: 9 }, (_, cell) => (
                  <td key={cell}>
                    <i />
                  </td>
                ))}
              </tr>
            ))
          ) : (
            entries.map((entry) => (
              <tr
                key={entry.id}
                onClick={() => onOpen(entry)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen(entry);
                  }
                }}
                tabIndex={0}
              >
                <td className="title-cell">
                  <button onClick={() => onOpen(entry)} type="button">
                    {entry.coverUrl ? (
                      <img
                        alt=""
                        className="table-cover"
                        referrerPolicy="no-referrer"
                        src={entry.coverUrl}
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className={`row-media-icon media-${entry.mediaType}`}
                      >
                        {typeMeta[entry.mediaType].mark}
                      </span>
                    )}
                    <span
                      aria-label={statusMeta[entry.status]}
                      className={`title-status-dot ${entry.status}`}
                      role="img"
                      title={statusMeta[entry.status]}
                    />
                    <strong>{entry.title}</strong>
                  </button>
                </td>
                <td>
                  <span className={`type-pill type-${entry.mediaType}`}>
                    {subtypeLabel(entry)}
                  </span>
                </td>
                <td className="rating-cell">
                  {entry.rating ? (
                    <span className="score-pill">
                      <strong>{entry.rating}</strong>
                      <small>/10</small>
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{entry.creator || "—"}</td>
                <td>{entry.country || "—"}</td>
                <td>{entry.platform || "—"}</td>
                <td className="progress-cell">
                  <ProgressBar compact percent={entry.progressPercent} />
                </td>
                <td>{entry.progressText || "—"}</td>
                <td>{formatDate(entry.lastSeenAt)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function InsightsPanel({ entries }: { entries: Entry[] }) {
  type ChartDatum = { label: string; count: number; color?: string };
  type Chart = "primary" | "secondary" | "ratings";
  const [scope, setScope] = useState<"media" | "web">("media");
  const [chart, setChart] = useState<Chart>("primary");
  const scopedEntries =
    scope === "web"
      ? entries.filter((entry) => entry.bookCategory === "web_fiction")
      : entries.filter((entry) => entry.bookCategory !== "web_fiction");
  const completed = scopedEntries.filter(
    (entry) => entry.status === "completed",
  );
  const rated = completed.filter((entry) => entry.rating);
  const average = rated.length
    ? rated.reduce((sum, entry) => sum + (entry.rating || 0), 0) / rated.length
    : 0;

  const typeCounts: ChartDatum[] = [
    {
      label: "文学小说",
      count: scopedEntries.filter(
        (entry) => entry.bookCategory === "literary",
      ).length,
      color: "var(--media-book)",
    },
    {
      label: "人文社科",
      count: scopedEntries.filter(
        (entry) => entry.bookCategory === "social_science",
      )
        .length,
      color: "#777772",
    },
    {
      label: "漫画",
      count: scopedEntries.filter((entry) => entry.bookCategory === "manga")
        .length,
      color: "#b0b0aa",
    },
    {
      label: "电影",
      count: scopedEntries.filter((entry) => entry.mediaType === "movie")
        .length,
      color: "var(--media-movie)",
    },
    {
      label: "电视剧",
      count: scopedEntries.filter(
        (entry) =>
          entry.mediaType === "series" && entry.seriesCategory === "tv",
      ).length,
      color: "var(--media-series)",
    },
    {
      label: "动漫",
      count: scopedEntries.filter(
        (entry) =>
          entry.mediaType === "series" && entry.seriesCategory === "anime",
      ).length,
      color: "#718878",
    },
    {
      label: "综艺",
      count: scopedEntries.filter(
        (entry) =>
          entry.mediaType === "series" && entry.seriesCategory === "variety",
      ).length,
      color: "var(--media-variety)",
    },
  ];

  const countryMap = scopedEntries.reduce<Record<string, number>>(
    (result, entry) => {
      const country = entry.country.trim() || "未记录";
      result[country] = (result[country] || 0) + 1;
      return result;
    },
    {},
  );
  const countryCounts: ChartDatum[] = Object.entries(countryMap)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const platformMap = scopedEntries.reduce<Record<string, number>>(
    (result, entry) => {
      const platform = entry.platform.trim() || "未记录";
      result[platform] = (result[platform] || 0) + 1;
      return result;
    },
    {},
  );
  const platformCounts: ChartDatum[] = Object.entries(platformMap)
    .map(([label, count]) => ({ label, count, color: "var(--media-book)" }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const statusCounts: ChartDatum[] = (
    [
      ["进行中", "in_progress", "var(--progress-blue)"],
      ["已看完", "completed", "var(--progress-green)"],
      ["已弃", "abandoned", "#e05252"],
    ] as const
  ).map(([label, status, color]) => ({
    label,
    color,
    count: scopedEntries.filter((entry) => entry.status === status).length,
  }));
  const ratingCounts: ChartDatum[] = Array.from({ length: 10 }, (_, index) => ({
    label: `${index + 1} 分`,
    count: rated.filter((entry) => entry.rating === index + 1).length,
  }));
  const activeData =
    chart === "ratings"
      ? ratingCounts
      : scope === "web"
        ? chart === "primary"
          ? platformCounts
          : statusCounts
        : chart === "primary"
          ? typeCounts
          : countryCounts;
  const chartTitle =
    chart === "ratings"
      ? "评分分布"
      : scope === "web"
        ? chart === "primary"
          ? "阅读平台分布"
          : "完成状态分布"
        : chart === "primary"
          ? "类型分布"
          : "国家 / 地区分布";
  const maxCount = Math.max(1, ...activeData.map((item) => item.count));
  const favoriteType = [...typeCounts].sort((a, b) => b.count - a.count)[0];
  const topCountry = countryCounts.find((item) => item.label !== "未记录");
  const topPlatform = platformCounts.find((item) => item.label !== "未记录");
  const topStatus = [...statusCounts].sort((a, b) => b.count - a.count)[0];
  const thoughtCount = scopedEntries.reduce(
    (sum, entry) =>
      sum + entry.notes.filter((note) => note.content.trim()).length,
    0,
  );

  function changeScope(nextScope: "media" | "web") {
    setScope(nextScope);
    setChart("primary");
  }

  return (
    <section className="insights-page">
      <div className="insights-intro">
        <span className="date-kicker">LOCAL STATISTICS</span>
        <h1>统计</h1>
        <p>
          {scope === "web"
            ? "网络小说单独统计，不计入书影音数据。"
            : "网络小说已从这里排除，按类型、国家与评分查看书影音记录。"}
        </p>
        <div className="insight-scope-tabs" aria-label="统计范围">
          <button
            className={scope === "media" ? "active" : ""}
            onClick={() => changeScope("media")}
            type="button"
          >
            书影音统计
          </button>
          <button
            className={scope === "web" ? "active" : ""}
            onClick={() => changeScope("web")}
            type="button"
          >
            网络小说统计
          </button>
        </div>
      </div>

      <div className="insight-summary">
        <div>
          <span>{scope === "web" ? "网络小说" : "书影音记录"}</span>
          <strong>{scopedEntries.length}</strong>
          <small>部作品</small>
        </div>
        <div>
          <span>完成率</span>
          <strong>
            {scopedEntries.length
              ? Math.round((completed.length / scopedEntries.length) * 100)
              : 0}
          </strong>
          <small>%</small>
        </div>
        <div>
          <span>平均评分</span>
          <strong>{average ? average.toFixed(1) : "—"}</strong>
          <small>{average ? "/ 10" : "暂无"}</small>
        </div>
        <div>
          <span>感想数量</span>
          <strong>{thoughtCount}</strong>
          <small>则</small>
        </div>
      </div>

      <section className="chart-card">
        <div className="chart-heading">
          <div>
            <span className="eyebrow">OVERVIEW</span>
            <h2>{chartTitle}</h2>
          </div>
          <div className="chart-options" aria-label="统计图选项">
            <button
              className={chart === "primary" ? "active" : ""}
              onClick={() => setChart("primary")}
              type="button"
            >
              {scope === "web" ? "阅读平台" : "类型构成"}
            </button>
            <button
              className={chart === "secondary" ? "active" : ""}
              onClick={() => setChart("secondary")}
              type="button"
            >
              {scope === "web" ? "完成状态" : "国家 / 地区"}
            </button>
            <button
              className={chart === "ratings" ? "active" : ""}
              onClick={() => setChart("ratings")}
              type="button"
            >
              评分偏好
            </button>
          </div>
        </div>

        {scopedEntries.length ? (
          <div className={`bar-chart chart-${chart}`}>
            {activeData.map((item, index) => (
              <div className="bar-item" key={item.label}>
                <div className="bar-value">
                  <span>{item.count || ""}</span>
                  <i
                    style={{
                      height: `${Math.max(3, (item.count / maxCount) * 100)}%`,
                      background:
                        item.color ||
                        (chart === "ratings" ? "var(--ink)" : "var(--sage)"),
                      opacity:
                        chart === "ratings" ? 0.28 + index * 0.065 : 1,
                    }}
                  />
                </div>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="chart-empty">
            <div className="empty-bars">
              {[32, 70, 45, 86, 58, 38].map((height) => (
                <i key={height} style={{ height: `${height}%` }} />
              ))}
            </div>
            <p>
              {scope === "web"
                ? "添加网络小说后，这里会自动生成统计图。"
                : "添加书影音记录后，这里会自动生成统计图。"}
            </p>
          </div>
        )}
      </section>

      <div className="insight-notes">
        <article>
          <span>
            {scope === "web" ? "记录最多的阅读平台" : "最常看的类型"}
          </span>
          <strong>
            {scope === "web"
              ? topPlatform?.label || "暂无"
              : favoriteType?.count
                ? favoriteType.label
                : "暂无"}
          </strong>
          <p>
            {scope === "web"
              ? topPlatform
                ? `共 ${topPlatform.count} 部。`
                : "填写阅读平台后自动汇总。"
              : favoriteType?.count
                ? `共 ${favoriteType.count} 部，占当前记录最多。`
                : "添加记录后自动计算。"}
          </p>
        </article>
        <article>
          <span>
            {scope === "web" ? "最常见的阅读状态" : "记录最多的国家 / 地区"}
          </span>
          <strong>
            {scope === "web"
              ? topStatus?.count
                ? topStatus.label
                : "暂无"
              : topCountry?.label || "暂无"}
          </strong>
          <p>
            {scope === "web"
              ? topStatus?.count
                ? `共 ${topStatus.count} 部。`
                : "添加网络小说后自动计算。"
              : topCountry
                ? `共 ${topCountry.count} 部。`
                : "填写国家或地区后自动汇总。"}
          </p>
        </article>
        <article>
          <span>平均评分区间</span>
          <strong>
            {average >= 8
              ? "8–10 分"
              : average >= 6
                ? "6–7.9 分"
                : average
                  ? "1–5.9 分"
                  : "暂无评分"}
          </strong>
          <p>
            {average
              ? `平均 ${average.toFixed(1)} 分，共 ${rated.length} 部参与统计。`
              : "完成作品并给出 1–10 分后自动统计。"}
          </p>
        </article>
      </div>
    </section>
  );
}

function CalendarPage({
  entries,
  onOpen,
}: {
  entries: Entry[];
  onOpen: (entry: Entry) => void;
}) {
  const now = new Date();
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(now.getFullYear(), now.getMonth(), 1),
  );
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const leadingDays = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const previousMonthDays = new Date(year, month, 0).getDate();
  const monthTitle = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
  }).format(visibleMonth);
  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, Array<{ entry: Entry; note: Note }>>();
    entries.forEach((entry) => {
      entry.notes.forEach((note) => {
        const date = note.watchedAt || note.createdAt.slice(0, 10);
        const events = grouped.get(date) || [];
        events.push({ entry, note });
        grouped.set(date, events);
      });
    });
    grouped.forEach((events) =>
      events.sort((a, b) => b.note.createdAt.localeCompare(a.note.createdAt)),
    );
    return grouped;
  }, [entries]);

  const cells = Array.from({ length: 42 }, (_, index) => {
    const dayOffset = index - leadingDays + 1;
    if (dayOffset < 1) {
      const day = previousMonthDays + dayOffset;
      const date = new Date(year, month - 1, day);
      return { day, date, outside: true };
    }
    if (dayOffset > daysInMonth) {
      const day = dayOffset - daysInMonth;
      const date = new Date(year, month + 1, day);
      return { day, date, outside: true };
    }
    return {
      day: dayOffset,
      date: new Date(year, month, dayOffset),
      outside: false,
    };
  });

  function moveMonth(offset: number) {
    setVisibleMonth(new Date(year, month + offset, 1));
  }

  return (
    <section className="calendar-page">
      <div className="calendar-intro">
        <div>
          <span className="date-kicker">VIEWING CALENDAR</span>
          <h1>观看日历</h1>
          <p>每一次新增的观看或阅读记录，都会按日期出现在这里。</p>
        </div>
        <div className="calendar-legend" aria-label="日历状态图例">
          {(["in_progress", "completed", "abandoned"] as EntryStatus[]).map(
            (status) => (
              <span key={status}>
                <i className={status} />
                {statusMeta[status]}
              </span>
            ),
          )}
        </div>
      </div>

      <section className="calendar-card">
        <div className="calendar-heading">
          <h2>{monthTitle}</h2>
          <div>
            <button onClick={() => moveMonth(-1)} type="button">
              ‹
            </button>
            <button
              onClick={() =>
                setVisibleMonth(
                  new Date(now.getFullYear(), now.getMonth(), 1),
                )
              }
              type="button"
            >
              今天
            </button>
            <button onClick={() => moveMonth(1)} type="button">
              ›
            </button>
          </div>
        </div>
        <div className="calendar-scroll">
          <div className="calendar-grid">
            {["一", "二", "三", "四", "五", "六", "日"].map((weekday) => (
              <div className="calendar-weekday" key={weekday}>
                周{weekday}
              </div>
            ))}
            {cells.map(({ day, date, outside }) => {
              const dateKey = [
                date.getFullYear(),
                String(date.getMonth() + 1).padStart(2, "0"),
                String(date.getDate()).padStart(2, "0"),
              ].join("-");
              const events = eventsByDate.get(dateKey) || [];
              const isToday = dateKey === today();
              return (
                <div
                  className={[
                    "calendar-day",
                    outside ? "outside" : "",
                    isToday ? "today" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={dateKey}
                >
                  <time dateTime={dateKey}>{day}</time>
                  <div className="calendar-events">
                    {events.slice(0, 3).map(({ entry, note }) => (
                      <button
                        key={`${entry.id}-${note.id}`}
                        onClick={() => onOpen(entry)}
                        title={`《${entry.title}》 ${calendarProgressLabel(entry, note)}`}
                        type="button"
                      >
                        <i className={note.status} />
                        <span>
                          《{entry.title}》{" "}
                          <strong>{calendarProgressLabel(entry, note)}</strong>
                        </span>
                      </button>
                    ))}
                    {events.length > 3 && (
                      <small>还有 {events.length - 3} 条</small>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </section>
  );
}

export function MediaJournal() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | EntryStatus>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | MediaType>("all");
  const [view, setView] = useState<"records" | "calendar" | "insights">(
    "records",
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [detailTab, setDetailTab] = useState<"progress" | "thoughts">(
    "progress",
  );
  const [form, setForm] = useState<EntryForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [recordForm, setRecordForm] = useState<ViewingRecordForm | null>(null);
  const [movieLookupQuery, setMovieLookupQuery] = useState("");
  const [movieLookupResults, setMovieLookupResults] = useState<
    DoubanLookupResult[]
  >([]);
  const [movieLookupMessage, setMovieLookupMessage] = useState("");
  const [movieLookupLoading, setMovieLookupLoading] = useState(false);

  async function loadEntries() {
    try {
      const savedEntries = await listLocalEntries();
      setEntries(savedEntries);
      setError("");
    } catch {
      setError("无法读取当前设备中的记录。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadEntries();
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem("liuhen-theme");
    const preferred =
      saved === "light" || saved === "dark"
        ? saved
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    setTheme(preferred);
    document.documentElement.dataset.theme = preferred;
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("liuhen-theme", next);
  }

  const filteredEntries = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return entries.filter((entry) => {
      const matchesSearch =
        !keyword ||
        entry.title.toLowerCase().includes(keyword) ||
        entry.originalTitle.toLowerCase().includes(keyword) ||
        entry.creator.toLowerCase().includes(keyword) ||
        entry.cast.toLowerCase().includes(keyword) ||
        entry.country.toLowerCase().includes(keyword) ||
        entry.year.toLowerCase().includes(keyword) ||
        entry.platform.toLowerCase().includes(keyword);
      const matchesStatus =
        statusFilter === "all" || entry.status === statusFilter;
      const matchesType =
        typeFilter === "all" || entry.mediaType === typeFilter;
      return matchesSearch && matchesStatus && matchesType;
    });
  }, [entries, search, statusFilter, typeFilter]);

  const stats = useMemo(
    () => ({
      active: entries.filter((entry) => entry.status === "in_progress").length,
      completed: entries.filter((entry) => entry.status === "completed").length,
      notes: entries.reduce(
        (sum, entry) =>
          sum + entry.notes.filter((note) => note.content.trim()).length,
        0,
      ),
    }),
    [entries],
  );

  const totalUnits = numberFromForm(form.totalUnits);
  const currentUnits = Math.min(
    totalUnits || Number.POSITIVE_INFINITY,
    numberFromForm(form.currentUnits),
  );
  const computedProgress = calculateProgress(
    form.movieMode,
    totalUnits,
    currentUnits,
  );
  const automaticStatus = deriveStatus(
    computedProgress,
    form.status === "abandoned",
  );
  const isCinema =
    form.mediaType === "movie" && form.movieMode === "cinema";
  const recordCurrentUnits =
    selected && recordForm
      ? Math.min(
          selected.totalUnits || Number.POSITIVE_INFINITY,
          numberFromForm(recordForm.currentUnits),
        )
      : 0;
  const recordProgress =
    selected && recordForm
      ? calculateProgress(
          selected.movieMode,
          selected.totalUnits,
          recordCurrentUnits,
        )
      : 0;
  const recordStatus =
    recordForm &&
    deriveStatus(recordProgress, recordForm.status === "abandoned");

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setMovieLookupQuery("");
    setMovieLookupResults([]);
    setMovieLookupMessage("");
    setEditorOpen(true);
  }

  async function backfillEntryCover(entry: Entry) {
    if (
      entry.coverUrl.startsWith("data:") ||
      entry.coverUrl.startsWith("blob:")
    ) {
      return;
    }
    try {
      let remoteCoverUrl = entry.coverUrl;
      if (!remoteCoverUrl) {
        const subjectId = entry.doubanUrl.match(/\/subject\/(\d+)/)?.[1];
        if (!subjectId) return;
        const response = await fetch(
          `/api/metadata/movie-search?id=${subjectId}&kind=${entry.mediaType}`,
        );
        const data = (await response.json()) as {
          subject?: DoubanLookupDetails;
        };
        remoteCoverUrl = data.subject?.coverUrl?.trim() || "";
        if (!response.ok || !remoteCoverUrl) return;
      }
      const coverUrl = await localizePoster(remoteCoverUrl);
      if (!coverUrl) return;
      const updated = { ...entry, coverUrl };
      await saveLocalEntry(updated);
      setEntries((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setSelected((current) =>
        current?.id === updated.id ? updated : current,
      );
    } catch {
      // 豆瓣封面不可用时保留占位图，用户仍可上传本地图片。
    }
  }

  function openDetails(entry: Entry) {
    setSelected(entry);
    setDetailTab("progress");
    void backfillEntryCover(entry);
  }

  function openEdit(entry: Entry) {
    setSelected(null);
    setEditing(entry);
    setForm({
      title: entry.title,
      originalTitle: entry.originalTitle || "",
      creator: entry.creator,
      mediaType: entry.mediaType,
      bookCategory: entry.bookCategory || "literary",
      seriesCategory: entry.seriesCategory || "tv",
      movieMode: entry.movieMode,
      status: entry.status,
      progressUnit: entry.progressUnit,
      totalUnits: entry.totalUnits ? String(entry.totalUnits) : "",
      currentUnits: entry.currentUnits ? String(entry.currentUnits) : "",
      platform: entry.platform,
      country: entry.country,
      cast: entry.cast || "",
      year: entry.year || "",
      doubanUrl: entry.doubanUrl || "",
      coverUrl: entry.coverUrl || "",
      lastSeenAt: entry.lastSeenAt.slice(0, 10),
      rating: entry.rating || 0,
      thought: "",
    });
    setMovieLookupQuery("");
    setMovieLookupResults([]);
    setMovieLookupMessage("");
    setEditorOpen(true);
  }

  function changeMediaType(mediaType: MediaType) {
    const movieMode: MovieMode =
      mediaType === "movie" ? form.movieMode || "streaming" : "";
    setForm({
      ...form,
      mediaType,
      movieMode,
      progressUnit: defaultProgressUnit(mediaType),
      status: "in_progress",
      totalUnits: "",
      currentUnits: "",
      rating: 0,
    });
    setMovieLookupResults([]);
    setMovieLookupMessage("");
    setMovieLookupQuery("");
  }

  function uploadCover(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("请选择图片文件作为封面。");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("封面图片请控制在 5MB 以内。");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setForm((current) => ({
        ...current,
        coverUrl: typeof reader.result === "string" ? reader.result : "",
      }));
      setError("");
    };
    reader.onerror = () => setError("这张封面没有读取成功，请换一张再试。");
    reader.readAsDataURL(file);
  }

  function openDoubanSearch() {
    const query = movieLookupQuery.trim();
    if (!query) {
      setMovieLookupMessage(`先输入${doubanSearchNoun(form.mediaType)}中文名。`);
      return;
    }
    const url = new URL("https://www.douban.com/search");
    url.searchParams.set("q", query);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function searchMovieMetadata() {
    const query = movieLookupQuery.trim();
    if (!query) {
      setMovieLookupMessage(`先输入${doubanSearchNoun(form.mediaType)}中文名。`);
      return;
    }

    setMovieLookupLoading(true);
    setMovieLookupResults([]);
    setMovieLookupMessage("");
    try {
      const response = await fetch(
        `/api/metadata/movie-search?q=${encodeURIComponent(query)}&kind=${form.mediaType}`,
      );
      const data = (await response.json()) as {
        code?: string;
        error?: string;
        results?: DoubanLookupResult[];
      };
      if (!response.ok) {
        setMovieLookupMessage(
          data.code === "DOUBAN_UNAVAILABLE"
            ? "豆瓣当前没有返回候选，可以稍后重试或直接打开豆瓣。"
            : data.error || "没有检索成功，请稍后再试。",
        );
        return;
      }
      const results = data.results || [];
      setMovieLookupResults(results);
      setMovieLookupMessage(
        results.length
          ? "选择正确条目后自动填充。"
          : `没有找到匹配${doubanSearchNoun(form.mediaType)}。`,
      );
    } catch {
      setMovieLookupMessage("目前无法连接豆瓣，可以稍后再试。");
    } finally {
      setMovieLookupLoading(false);
    }
  }

  async function applyMovieMetadata(result: DoubanLookupResult) {
    const selectedType = form.mediaType;
    setMovieLookupLoading(true);
    setMovieLookupMessage("");
    setForm((current) => ({
      ...current,
      title: result.title || current.title,
      year: result.year || current.year,
      doubanUrl: result.sourceUrl || current.doubanUrl,
    }));
    try {
      const response = await fetch(
        `/api/metadata/movie-search?id=${result.id}&kind=${selectedType}`,
      );
      const data = (await response.json()) as {
        error?: string;
        subject?: DoubanLookupDetails;
      };
      if (!response.ok || !data.subject) {
        setMovieLookupMessage(data.error || "没有读取到这个条目的资料。");
        return;
      }

      const subject = data.subject;
      const remoteCoverUrl = subject.coverUrl || result.coverUrl;
      let coverUrl = "";
      if (remoteCoverUrl) {
        try {
          coverUrl = await localizePoster(remoteCoverUrl);
        } catch {
          coverUrl = remoteCoverUrl;
        }
      }
      setForm((current) => ({
        ...current,
        title: subject.title || current.title,
        originalTitle: subject.originalTitle || current.originalTitle,
        creator: subject.creators.join(" / ") || current.creator,
        cast:
          selectedType === "book"
            ? current.cast
            : subject.actors.join(" / ") || current.cast,
        country: subject.countries.join(" / ") || current.country,
        year: subject.year || current.year,
        doubanUrl: subject.sourceUrl || current.doubanUrl,
        coverUrl: coverUrl || current.coverUrl,
        totalUnits: subject.totalUnits
          ? String(subject.totalUnits)
          : current.totalUnits,
        currentUnits:
          current.movieMode === "cinema" && subject.totalUnits
            ? String(subject.totalUnits)
            : current.currentUnits,
      }));
      setMovieLookupResults([]);
      setMovieLookupMessage(
        `${doubanFilledMessage(selectedType)}${
          coverUrl.startsWith("data:") ? " 海报已保存到本机。" : ""
        }`,
      );
    } catch {
      setMovieLookupMessage("没有读取到这个条目的资料。");
    } finally {
      setMovieLookupLoading(false);
    }
  }

  async function saveEntry(event: FormEvent) {
    event.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const progressPercent = calculateProgress(
        form.movieMode,
        totalUnits,
        currentUnits,
      );
      const status = deriveStatus(
        progressPercent,
        form.status === "abandoned",
      );
      const storedCurrentUnits =
        progressPercent === 100 && totalUnits ? totalUnits : currentUnits;
      const progressText = makeProgressText(
        form.mediaType,
        form.movieMode,
        form.progressUnit,
        totalUnits,
        storedCurrentUnits,
      );
      const thought = form.thought.trim();
      const notes: Note[] = editing ? [...editing.notes] : [];
      if (!editing) {
        notes.unshift({
          id: crypto.randomUUID(),
          content: thought,
          progressText,
          currentUnits: storedCurrentUnits,
          progressPercent,
          status,
          watchedAt: form.lastSeenAt,
          createdAt: now,
        });
      }
      const entry: Entry = {
        id: editing?.id ?? crypto.randomUUID(),
        title: form.title.trim(),
        originalTitle: form.originalTitle.trim(),
        creator: form.creator.trim(),
        mediaType: form.mediaType,
        bookCategory:
          form.mediaType === "book" ? form.bookCategory : "",
        seriesCategory:
          form.mediaType === "series" ? form.seriesCategory : "",
        movieMode: form.mediaType === "movie" ? form.movieMode : "",
        status,
        progressText,
        progressPercent,
        progressUnit: form.progressUnit,
        totalUnits,
        currentUnits: storedCurrentUnits,
        platform: form.platform.trim(),
        country: form.country.trim(),
        cast: form.cast.trim(),
        year: form.year.trim(),
        doubanUrl: form.doubanUrl.trim(),
        coverUrl: form.coverUrl,
        startedAt: editing?.startedAt || form.lastSeenAt,
        lastSeenAt: editing?.lastSeenAt || form.lastSeenAt,
        completedAt:
          status === "completed"
            ? editing?.completedAt || form.lastSeenAt
            : "",
        rating:
          status === "completed" && form.rating >= 1 && form.rating <= 10
            ? form.rating
            : null,
        createdAt: editing?.createdAt || now,
        updatedAt: now,
        notes,
      };
      await saveLocalEntry(entry);
      setEntries((current) =>
        [entry, ...current.filter((item) => item.id !== entry.id)].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        ),
      );
      setEditorOpen(false);
      setEditing(null);
      setError("");
    } catch {
      setError("这次没有保存成功，请检查浏览器是否允许本地存储。");
    } finally {
      setSaving(false);
    }
  }

  function openViewingRecord(entry: Entry) {
    setSelected(entry);
    setRecordForm(viewingRecordForm(entry));
    setRecordOpen(true);
  }

  async function addViewingRecord(event: FormEvent) {
    event.preventDefault();
    if (!selected || !recordForm || !recordStatus) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const storedCurrentUnits =
        recordProgress === 100 && selected.totalUnits
          ? selected.totalUnits
          : recordCurrentUnits;
      const progressText = makeProgressText(
        selected.mediaType,
        selected.movieMode,
        selected.progressUnit,
        selected.totalUnits,
        storedCurrentUnits,
      );
      const note: Note = {
        id: crypto.randomUUID(),
        content: recordForm.thought.trim(),
        progressText,
        currentUnits: storedCurrentUnits,
        progressPercent: recordProgress,
        status: recordStatus,
        watchedAt: recordForm.watchedAt,
        createdAt: now,
      };
      const updated: Entry = {
        ...selected,
        status: recordStatus,
        progressText,
        progressPercent: recordProgress,
        currentUnits: storedCurrentUnits,
        lastSeenAt: recordForm.watchedAt,
        completedAt:
          recordStatus === "completed"
            ? selected.completedAt || recordForm.watchedAt
            : "",
        rating:
          recordStatus === "completed" &&
          recordForm.rating >= 1 &&
          recordForm.rating <= 10
            ? recordForm.rating
            : recordStatus === "completed"
              ? selected.rating
              : null,
        updatedAt: now,
        notes: [note, ...selected.notes],
      };
      await saveLocalEntry(updated);
      setEntries((current) =>
        current
          .map((entry) => (entry.id === updated.id ? updated : entry))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      );
      setSelected(updated);
      setRecordOpen(false);
      setRecordForm(null);
      setError("");
    } catch {
      setError("这次观看记录没有保存成功。");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry() {
    if (!selected) return;
    setSaving(true);
    try {
      await removeLocalEntry(selected.id);
      setEntries((current) =>
        current.filter((entry) => entry.id !== selected.id),
      );
      setSelected(null);
      setError("");
    } catch {
      setError("删除失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-seal">PMA</span>
          <div>
            <strong>Private Media Archive</strong>
          </div>
        </div>

        <nav aria-label="主导航" className="side-nav">
          <button
            className={view === "records" ? "active" : ""}
            onClick={() => setView("records")}
            type="button"
          >
            <span>全部信息</span>
            <em>▦</em>
          </button>
          <button
            className={view === "calendar" ? "active" : ""}
            onClick={() => setView("calendar")}
            type="button"
          >
            <span>观看日历</span>
            <em>□</em>
          </button>
          <button
            className={view === "insights" ? "active" : ""}
            onClick={() => setView("insights")}
            type="button"
          >
            <span>统计图</span>
            <em>↗</em>
          </button>
        </nav>

        <div className="sidebar-note local-mode-note">
          <span>本地模式</span>
          <p>记录仅保存在当前设备，暂未开启云同步。</p>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          {view === "records" ? (
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="搜索记录"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索名称、作者、国家或平台"
                type="search"
                value={search}
              />
            </label>
          ) : (
            <span className="topbar-title">
              {view === "calendar"
                ? "按日期查看观看与阅读记录"
                : "当前设备中的记录统计"}
            </span>
          )}
          <div className="topbar-actions">
            <span className="local-badge">本地</span>
            <button
              aria-label={theme === "light" ? "切换到深色模式" : "切换到浅色模式"}
              className="theme-toggle"
              onClick={toggleTheme}
              title={theme === "light" ? "深色模式" : "浅色模式"}
              type="button"
            >
              <span>{theme === "light" ? "◐" : "◑"}</span>
              {theme === "light" ? "深色" : "浅色"}
            </button>
            <button className="primary-button" onClick={openCreate} type="button">
              <span>＋</span> 新增观看
            </button>
          </div>
        </header>

        {view === "records" ? (
          <>
            <div className="database-titlebar">
              <div>
                <span className="date-kicker">LOCAL DATABASE</span>
                <h1>书影音记录</h1>
                <p>共 {entries.length} 条记录 · 当前保存在本地</p>
              </div>
              <div className="database-summary">
                <span><strong>{stats.active}</strong> 进行中</span>
                <i />
                <span><strong>{stats.completed}</strong> 已看完</span>
                <i />
                <span><strong>{stats.notes}</strong> 则感想</span>
              </div>
            </div>

            {error && (
              <button className="error-banner" onClick={() => void loadEntries()}>
                {error} <u>重试</u>
              </button>
            )}

            <section className="records-section">
              <div className="database-toolbar">
                <div className="view-tabs" aria-label="表格视图">
                  {(["all", "book", "movie", "series"] as const).map((type) => (
                    <button
                      className={typeFilter === type ? "active" : ""}
                      key={type}
                      onClick={() => setTypeFilter(type)}
                      type="button"
                    >
                      <span aria-hidden="true">▦</span>
                      {type === "all" ? "全部" : typeMeta[type].label}
                    </button>
                  ))}
                </div>
                <div className="table-result">
                  <span>
                    {statusFilter === "all"
                      ? `${filteredEntries.length} 条`
                      : `${statusMeta[statusFilter]} · ${filteredEntries.length} 条`}
                  </span>
                  {(search || statusFilter !== "all" || typeFilter !== "all") && (
                    <button
                      onClick={() => {
                        setSearch("");
                        setStatusFilter("all");
                        setTypeFilter("all");
                      }}
                      type="button"
                    >
                      清除筛选
                    </button>
                  )}
                </div>
              </div>
              <div className="status-toolbar">
                <div className="status-tabs" aria-label="按观看进度筛选">
                  {(
                    [
                      ["all", "全部状态"],
                      ["in_progress", "进行中"],
                      ["completed", "已看完"],
                      ["abandoned", "已弃"],
                    ] as const
                  ).map(([status, label]) => (
                    <button
                      className={statusFilter === status ? "active" : ""}
                      key={status}
                      onClick={() => setStatusFilter(status)}
                      type="button"
                    >
                      {status !== "all" && (
                        <i className={status} aria-hidden="true" />
                      )}
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {filteredEntries.length || loading ? (
                <RecordTable
                  entries={filteredEntries}
                  loading={loading}
                  onOpen={openDetails}
                />
              ) : (
                <div className="empty-table">
                  <strong>
                    {entries.length ? "暂无符合条件的记录" : "还没有记录"}
                  </strong>
                  <span>
                    {entries.length
                      ? "可以清除筛选或更换关键词。"
                      : "新增一部作品后会显示在表格中。"}
                  </span>
                  {entries.length ? (
                    <button
                      onClick={() => {
                        setSearch("");
                        setStatusFilter("all");
                        setTypeFilter("all");
                      }}
                      type="button"
                    >
                      清除筛选
                    </button>
                  ) : (
                    <button onClick={openCreate} type="button">
                      新增观看
                    </button>
                  )}
                </div>
              )}
            </section>
          </>
        ) : view === "calendar" ? (
          <CalendarPage entries={entries} onOpen={openDetails} />
        ) : (
          <InsightsPanel entries={entries} />
        )}
      </section>

      <button
        aria-label="新增观看"
        className="mobile-add"
        onClick={openCreate}
        type="button"
      >
        ＋
      </button>

      {editorOpen && (
        <div className="modal-backdrop" role="presentation">
          <div
            aria-label={editing ? "编辑作品资料" : "新增观看"}
            aria-modal="true"
            className="editor-modal"
            role="dialog"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">
                  {editing ? "EDIT ITEM" : "NEW ITEM"}
                </span>
                <h2>{editing ? "编辑作品资料" : "新增观看"}</h2>
              </div>
              <button
                aria-label="关闭"
                className="close-button"
                onClick={() => setEditorOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <form onSubmit={saveEntry}>
              <div className="media-type-picker">
                {(Object.keys(typeMeta) as MediaType[]).map((type) => (
                  <button
                    className={form.mediaType === type ? "active" : ""}
                    key={type}
                    onClick={() => changeMediaType(type)}
                    type="button"
                  >
                    <span>{typeMeta[type].mark}</span>
                    {typeMeta[type].label}
                  </button>
                ))}
              </div>

              {form.mediaType === "book" && (
                <div className="book-category-field">
                  <span>书籍分类</span>
                  <div className="book-category-grid">
                    <div>
                      <small>出版读物</small>
                      {(["literary", "social_science"] as BookCategory[]).map(
                        (category) => (
                          <button
                            className={
                              form.bookCategory === category ? "active" : ""
                            }
                            key={category}
                            onClick={() =>
                              setForm({ ...form, bookCategory: category })
                            }
                            type="button"
                          >
                            {bookCategoryMeta[category]}
                          </button>
                        ),
                      )}
                    </div>
                    <div>
                      <small>通俗阅读</small>
                      {(["web_fiction", "manga"] as BookCategory[]).map(
                        (category) => (
                          <button
                            className={
                              form.bookCategory === category ? "active" : ""
                            }
                            key={category}
                            onClick={() =>
                              setForm({ ...form, bookCategory: category })
                            }
                            type="button"
                          >
                            {bookCategoryMeta[category]}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                </div>
              )}

              {form.mediaType === "series" && (
                <div className="series-category-field">
                  <span>剧集分类</span>
                  <div>
                    {(
                      ["tv", "anime", "variety"] as SeriesCategory[]
                    ).map((category) => (
                      <button
                        className={
                          form.seriesCategory === category ? "active" : ""
                        }
                        key={category}
                        onClick={() =>
                          setForm({ ...form, seriesCategory: category })
                        }
                        type="button"
                      >
                        {seriesCategoryMeta[category]}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {form.mediaType === "movie" && (
                <div className="movie-mode-field">
                  <span>观看方式</span>
                  <div>
                    {(["cinema", "streaming"] as const).map((mode) => (
                      <button
                        className={form.movieMode === mode ? "active" : ""}
                        key={mode}
                        onClick={() =>
                          setForm({
                            ...form,
                            movieMode: mode,
                            status:
                              form.status === "abandoned"
                                ? "abandoned"
                                : "in_progress",
                            currentUnits:
                              mode === "cinema"
                                ? form.totalUnits
                                : form.currentUnits,
                            rating: mode === "cinema" ? form.rating : 0,
                          })
                        }
                        type="button"
                      >
                        {movieModeMeta[mode]}
                      </button>
                    ))}
                  </div>
                  {isCinema && (
                    <small>影院观看默认记为已看完，进度为 100%。</small>
                  )}
                </div>
              )}

              <section className="movie-lookup-field">
                <div className="movie-lookup-heading">
                  <div>
                    <span>豆瓣检索</span>
                    <small>输入中文名，选择候选后读取豆瓣基础资料。</small>
                  </div>
                  <span className="lookup-source">豆瓣 · 按需联网</span>
                </div>
                <div className="movie-lookup-controls">
                  <input
                    aria-label={`输入${doubanSearchNoun(form.mediaType)}中文名检索`}
                    autoFocus
                    onChange={(event) =>
                      setMovieLookupQuery(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void searchMovieMetadata();
                      }
                    }}
                    placeholder={
                      form.mediaType === "book"
                        ? "例如：活着"
                        : form.mediaType === "series"
                          ? "例如：后宫·甄嬛传"
                          : "例如：寄生虫"
                    }
                    value={movieLookupQuery}
                  />
                  <button
                    disabled={movieLookupLoading || !movieLookupQuery.trim()}
                    onClick={() => void searchMovieMetadata()}
                    type="button"
                  >
                    {movieLookupLoading ? "检索中…" : "搜索豆瓣"}
                  </button>
                  <button
                    className="douban-link-button"
                    disabled={!movieLookupQuery.trim()}
                    onClick={openDoubanSearch}
                    type="button"
                  >
                    打开豆瓣
                  </button>
                </div>
                {movieLookupResults.length > 0 && (
                  <div
                    aria-label={`${doubanSearchNoun(form.mediaType)}检索结果`}
                    className="movie-lookup-results"
                  >
                    {movieLookupResults.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => void applyMovieMetadata(item)}
                        type="button"
                      >
                        {item.coverUrl ? (
                          <img
                            alt=""
                            src={posterProxyUrl(item.coverUrl)}
                          />
                        ) : (
                          <i aria-hidden="true">
                            {typeMeta[form.mediaType].mark}
                          </i>
                        )}
                        <span>
                          <strong>{item.title}</strong>
                          <small>
                            {item.subtitle ||
                              (item.year
                                ? `${item.year} 年`
                                : `豆瓣${typeMeta[form.mediaType].label}`)}
                          </small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {movieLookupMessage && (
                  <p className="movie-lookup-message">{movieLookupMessage}</p>
                )}
              </section>

              <section className="cover-editor">
                <div
                  className={`cover-editor-preview media-${form.mediaType}`}
                >
                  {form.coverUrl ? (
                    <img
                      alt={`${form.title || "作品"}封面预览`}
                      referrerPolicy="no-referrer"
                      src={form.coverUrl}
                    />
                  ) : (
                    <span>{typeMeta[form.mediaType].mark}</span>
                  )}
                </div>
                <div className="cover-editor-copy">
                  <div>
                    <span>封面</span>
                    <small>
                      选择豆瓣条目后自动填充，也可以换成你喜欢的图片。
                    </small>
                  </div>
                  <div className="cover-editor-actions">
                    <label>
                      选择本地图片
                      <input
                        accept="image/*"
                        onChange={uploadCover}
                        type="file"
                      />
                    </label>
                    {form.coverUrl && (
                      <button
                        onClick={() =>
                          setForm({ ...form, coverUrl: "" })
                        }
                        type="button"
                      >
                        移除封面
                      </button>
                    )}
                  </div>
                </div>
              </section>

              <label className="field field-wide">
                <span>
                  {form.mediaType === "book"
                    ? "书名（中文）*"
                    : form.mediaType === "movie"
                      ? "片名（中文）*"
                      : "剧名（中文）*"}
                </span>
                <input
                  onChange={(event) =>
                    setForm({ ...form, title: event.target.value })
                  }
                  placeholder={
                    form.mediaType === "book"
                      ? "例如：百年孤独"
                      : "输入作品名称"
                  }
                  required
                  value={form.title}
                />
              </label>

              <label className="field field-wide">
                <span>原名（可手动修改）</span>
                <input
                  onChange={(event) =>
                    setForm({ ...form, originalTitle: event.target.value })
                  }
                  placeholder={
                    form.mediaType === "book"
                      ? "原文书名"
                      : form.mediaType === "movie"
                        ? "原片名"
                        : "原剧名"
                  }
                  value={form.originalTitle}
                />
              </label>

              <div className="field-row">
                <label className="field">
                  <span>{typeMeta[form.mediaType].creatorLabel}</span>
                  <input
                    onChange={(event) =>
                      setForm({ ...form, creator: event.target.value })
                    }
                    placeholder={`填写${typeMeta[form.mediaType].creatorLabel}`}
                    value={form.creator}
                  />
                </label>
                <label className="field">
                  <span>
                    {isCinema ? "影院名称（可选）" : "观看平台 / 版本"}
                  </span>
                  <input
                    onChange={(event) =>
                      setForm({ ...form, platform: event.target.value })
                    }
                    placeholder={
                      isCinema ? "例如：百丽宫影城" : "微信读书、Netflix…"
                    }
                    value={form.platform}
                  />
                </label>
              </div>

              {form.mediaType !== "book" && (
                <label className="field field-wide">
                  <span>主演</span>
                  <input
                    onChange={(event) =>
                      setForm({ ...form, cast: event.target.value })
                    }
                    placeholder="选择豆瓣条目后自动填充，也可以手动修改"
                    value={form.cast}
                  />
                </label>
              )}

              <div className="field-row">
                <label className="field">
                  <span>国家 / 地区</span>
                  <input
                    onChange={(event) =>
                      setForm({ ...form, country: event.target.value })
                    }
                    placeholder="例如：中国、日本、法国、美国"
                    value={form.country}
                  />
                </label>
                <label className="field">
                  <span>年份</span>
                  <input
                    inputMode="numeric"
                    maxLength={4}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        year: event.target.value.replace(/\D/g, "").slice(0, 4),
                      })
                    }
                    placeholder="例如：2024"
                    value={form.year}
                  />
                </label>
              </div>

              {!editing && (
                <div className="field-row">
                  <div className="automatic-status-field">
                    <span>状态</span>
                    <div>
                      <span
                        className={`title-status-dot ${automaticStatus}`}
                      />
                      <strong>{statusMeta[automaticStatus]}</strong>
                      <small>
                        {automaticStatus === "abandoned"
                          ? "手动标记"
                          : "根据进度自动同步"}
                      </small>
                    </div>
                    <button
                      className={
                        form.status === "abandoned" ? "active" : ""
                      }
                      onClick={() =>
                        setForm({
                          ...form,
                          status:
                            form.status === "abandoned"
                              ? deriveStatus(computedProgress, false)
                              : "abandoned",
                        })
                      }
                      type="button"
                    >
                      {form.status === "abandoned"
                        ? "取消已弃"
                        : "标记为已弃"}
                    </button>
                  </div>
                  <label className="field">
                    <span>这次观看 / 阅读日期</span>
                    <input
                      onChange={(event) =>
                        setForm({ ...form, lastSeenAt: event.target.value })
                      }
                      type="date"
                      value={form.lastSeenAt}
                    />
                  </label>
                </div>
              )}

              {!isCinema && (
                <section className="automatic-progress">
                  <div className="automatic-progress-heading">
                    <div>
                      <span>自动计算进度</span>
                      <small>
                        {editing
                          ? "总量可以修正；当前位置请通过“添加记录”更新。"
                          : "填写总量和当前位置后，系统自动换算百分比。"}
                      </small>
                    </div>
                    <strong>{computedProgress}%</strong>
                  </div>
                  <div className="field-row">
                    <label className="field">
                      <span>
                        {progressUnitMeta[form.progressUnit].total}
                      </span>
                      <input
                        min="0"
                        onChange={(event) =>
                          setForm({
                            ...form,
                            totalUnits: event.target.value,
                          })
                        }
                        placeholder="0"
                        step="1"
                        type="number"
                        value={form.totalUnits}
                      />
                    </label>
                    <label className="field">
                      <span>
                        {progressUnitMeta[form.progressUnit].current}
                      </span>
                      <input
                        disabled={Boolean(editing)}
                        max={form.totalUnits || undefined}
                        min="0"
                        onChange={(event) =>
                          setForm({
                            ...form,
                            currentUnits: event.target.value,
                          })
                        }
                        placeholder="0"
                        step="1"
                        type="number"
                        value={form.currentUnits}
                      />
                    </label>
                  </div>
                  <ProgressBar percent={computedProgress} />
                </section>
              )}

              {!editing &&
                computedProgress === 100 &&
                automaticStatus !== "abandoned" && (
                <div className="rating-field">
                  <span>完成评分</span>
                  <Score
                    interactive
                    onChange={(rating) => setForm({ ...form, rating })}
                    value={form.rating}
                  />
                  <small>{form.rating ? `${form.rating} / 10` : "暂不评分"}</small>
                </div>
              )}

              {!editing && (
                <label className="field field-wide">
                  <span>这次的感想</span>
                  <textarea
                    onChange={(event) =>
                      setForm({ ...form, thought: event.target.value })
                    }
                    placeholder="可选；之后也可以在条目里继续添加"
                    rows={4}
                    value={form.thought}
                  />
                </label>
              )}

              <div className="modal-actions">
                <button
                  className="secondary-button"
                  onClick={() => setEditorOpen(false)}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="primary-button"
                  disabled={saving || !form.title.trim()}
                  type="submit"
                >
                  {saving ? "正在保存…" : editing ? "保存资料" : "建立条目"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selected && (
        <div className="drawer-backdrop" role="presentation">
          <aside
            aria-label={`${selected.title} 的详情`}
            aria-modal="true"
            className="detail-drawer"
            role="dialog"
          >
            <div className="drawer-actions">
              <div className="drawer-action-group">
                <button
                  className="add-record-button"
                  onClick={() => openViewingRecord(selected)}
                  type="button"
                >
                  ＋ 添加记录
                </button>
                <button
                  className="text-button"
                  onClick={() => openEdit(selected)}
                  type="button"
                >
                  编辑资料
                </button>
              </div>
              <button
                aria-label="关闭"
                className="close-button"
                onClick={() => setSelected(null)}
                type="button"
              >
                ×
              </button>
            </div>
            <div
              className={`detail-cover media-${selected.mediaType} ${
                selected.coverUrl ? "has-image" : ""
              }`}
            >
              {selected.coverUrl ? (
                <img
                  alt={`《${selected.title}》封面`}
                  referrerPolicy="no-referrer"
                  src={selected.coverUrl}
                />
              ) : (
                <>
                  <span>{typeMeta[selected.mediaType].mark}</span>
                  <i />
                </>
              )}
            </div>
            <div className="detail-title">
              <span className="eyebrow">{subtypeLabel(selected)}</span>
              <div className="detail-title-row">
                <span
                  aria-label={statusMeta[selected.status]}
                  className={`title-status-dot ${selected.status}`}
                  role="img"
                  title={statusMeta[selected.status]}
                />
                <h2>{selected.title}</h2>
              </div>
              {selected.originalTitle && (
                <p className="detail-original-title">
                  原名：{selected.originalTitle}
                </p>
              )}
              <p>{selected.creator || "未填写创作者"}</p>
              {selected.rating ? <Score value={selected.rating} /> : null}
            </div>

            <dl className="detail-meta">
              <div>
                <dt>当前位置</dt>
                <dd>{selected.progressText || "未填写"}</dd>
              </div>
              <div>
                <dt>平台 / 版本</dt>
                <dd>{selected.platform || "未填写"}</dd>
              </div>
              {selected.mediaType === "movie" && selected.movieMode && (
                <div>
                  <dt>观看方式</dt>
                  <dd>{movieModeMeta[selected.movieMode]}</dd>
                </div>
              )}
              {selected.mediaType !== "book" && (
                <div>
                  <dt>主演</dt>
                  <dd>{selected.cast || "未填写"}</dd>
                </div>
              )}
              {selected.mediaType === "series" && selected.seriesCategory && (
                <div>
                  <dt>剧集分类</dt>
                  <dd>{seriesCategoryMeta[selected.seriesCategory]}</dd>
                </div>
              )}
              <div>
                <dt>国家 / 地区</dt>
                <dd>{selected.country || "未填写"}</dd>
              </div>
              <div>
                <dt>年份</dt>
                <dd>{selected.year || "未填写"}</dd>
              </div>
              {selected.doubanUrl && (
                <div>
                  <dt>资料来源</dt>
                  <dd>
                    <a
                      href={selected.doubanUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      打开豆瓣条目 ↗
                    </a>
                  </dd>
                </div>
              )}
              <div>
                <dt>最后更新</dt>
                <dd>{formatDate(selected.lastSeenAt)}</dd>
              </div>
            </dl>

            <div className="drawer-progress">
              <ProgressBar percent={selected.progressPercent} />
            </div>

            <section className="entry-history">
              <div className="history-tabs" role="tablist">
                <button
                  aria-selected={detailTab === "progress"}
                  className={detailTab === "progress" ? "active" : ""}
                  onClick={() => setDetailTab("progress")}
                  role="tab"
                  type="button"
                >
                  观看进度
                  <span>{progressTimelineNotes(selected.notes).length}</span>
                </button>
                <button
                  aria-selected={detailTab === "thoughts"}
                  className={detailTab === "thoughts" ? "active" : ""}
                  onClick={() => setDetailTab("thoughts")}
                  role="tab"
                  type="button"
                >
                  感想
                  <span>
                    {
                      selected.notes.filter((note) => note.content.trim())
                        .length
                    }
                  </span>
                </button>
              </div>
              <div className="note-timeline">
                {detailTab === "progress" ? (
                  progressTimelineNotes(selected.notes).length ? (
                    progressTimelineNotes(selected.notes).map((note) => (
                      <article className="progress-history-item" key={note.id}>
                        <i className={note.status} />
                        <div>
                          <div>
                            <span>{note.progressText || "开始观看"}</span>
                            <time>{formatDate(note.watchedAt)}</time>
                          </div>
                          <ProgressBar compact percent={note.progressPercent} />
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className="no-notes">暂无观看进度。</p>
                  )
                ) : (
                  selected.notes.filter((note) => note.content.trim()).length ? (
                    selected.notes
                      .filter((note) => note.content.trim())
                      .map((note) => (
                        <article className="thought-history-item" key={note.id}>
                          <i className={note.status} />
                          <div>
                            <div>
                              <span>{note.progressText || "观看记录"}</span>
                              <time>{formatDate(note.watchedAt)}</time>
                            </div>
                            <p>{note.content}</p>
                          </div>
                        </article>
                      ))
                  ) : (
                    <p className="no-notes">还没有记录感想。</p>
                  )
                )}
              </div>
            </section>

            <button
              className="delete-button"
              disabled={saving}
              onClick={() => void deleteEntry()}
              type="button"
            >
              删除这条记录
            </button>
          </aside>
        </div>
      )}

      {recordOpen && selected && recordForm && recordStatus && (
        <div
          className="modal-backdrop record-modal-backdrop"
          role="presentation"
        >
          <div
            aria-label={`为《${selected.title}》添加记录`}
            aria-modal="true"
            className="record-modal"
            role="dialog"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">ADD LOG</span>
                <h2>添加记录</h2>
                <p>《{selected.title}》</p>
              </div>
              <button
                aria-label="关闭"
                className="close-button"
                onClick={() => {
                  setRecordOpen(false);
                  setRecordForm(null);
                }}
                type="button"
              >
                ×
              </button>
            </div>

            <form onSubmit={addViewingRecord}>
              {selected.mediaType === "movie" &&
              selected.movieMode === "cinema" ? (
                <div className="record-cinema-progress">
                  <span className="title-status-dot completed" />
                  <div>
                    <strong>影院观看 · 进度 100%</strong>
                    <small>每次添加都会保存为一条独立观看记录。</small>
                  </div>
                </div>
              ) : (
                <section className="automatic-progress record-progress">
                  <div className="automatic-progress-heading">
                    <div>
                      <span>这次看到哪里</span>
                      <small>
                        总量 {selected.totalUnits || "未填写"}{" "}
                        {progressUnitMeta[selected.progressUnit].unit}
                      </small>
                    </div>
                    <strong>{recordProgress}%</strong>
                  </div>
                  <label className="field">
                    <span>
                      {progressUnitMeta[selected.progressUnit].current}
                    </span>
                    <input
                      autoFocus
                      max={selected.totalUnits || undefined}
                      min="0"
                      onChange={(event) =>
                        setRecordForm({
                          ...recordForm,
                          currentUnits: event.target.value,
                        })
                      }
                      placeholder="0"
                      required
                      step="1"
                      type="number"
                      value={recordForm.currentUnits}
                    />
                  </label>
                  <ProgressBar percent={recordProgress} />
                </section>
              )}

              <div className="field-row">
                <div className="automatic-status-field">
                  <span>状态</span>
                  <div>
                    <span className={`title-status-dot ${recordStatus}`} />
                    <strong>{statusMeta[recordStatus]}</strong>
                    <small>
                      {recordStatus === "abandoned"
                        ? "手动标记"
                        : "根据进度自动同步"}
                    </small>
                  </div>
                  <button
                    className={
                      recordForm.status === "abandoned" ? "active" : ""
                    }
                    onClick={() =>
                      setRecordForm({
                        ...recordForm,
                        status:
                          recordForm.status === "abandoned"
                            ? deriveStatus(recordProgress, false)
                            : "abandoned",
                      })
                    }
                    type="button"
                  >
                    {recordForm.status === "abandoned"
                      ? "取消已弃"
                      : "标记为已弃"}
                  </button>
                </div>
                <label className="field">
                  <span>观看 / 阅读日期</span>
                  <input
                    onChange={(event) =>
                      setRecordForm({
                        ...recordForm,
                        watchedAt: event.target.value,
                      })
                    }
                    required
                    type="date"
                    value={recordForm.watchedAt}
                  />
                </label>
              </div>

              {recordStatus === "completed" && (
                <div className="rating-field">
                  <span>完成评分</span>
                  <Score
                    interactive
                    onChange={(rating) =>
                      setRecordForm({ ...recordForm, rating })
                    }
                    value={recordForm.rating}
                  />
                  <small>
                    {recordForm.rating
                      ? `${recordForm.rating} / 10`
                      : "暂不评分"}
                  </small>
                </div>
              )}

              <label className="field field-wide">
                <span>这次的感想</span>
                <textarea
                  onChange={(event) =>
                    setRecordForm({
                      ...recordForm,
                      thought: event.target.value,
                    })
                  }
                  placeholder="可选"
                  rows={5}
                  value={recordForm.thought}
                />
              </label>

              <div className="modal-actions">
                <button
                  className="secondary-button"
                  onClick={() => {
                    setRecordOpen(false);
                    setRecordForm(null);
                  }}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="primary-button"
                  disabled={saving || !recordForm.watchedAt}
                  type="submit"
                >
                  {saving ? "正在保存…" : "保存这次记录"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
