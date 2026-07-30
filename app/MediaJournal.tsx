"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type MediaType = "book" | "movie" | "series";
type BookCategory = "literary" | "social_science" | "web_fiction" | "manga";
type EntryStatus = "in_progress" | "completed" | "paused";

type Note = {
  id: string;
  content: string;
  progressText: string;
  createdAt: string;
};

type Entry = {
  id: string;
  title: string;
  creator: string;
  mediaType: MediaType;
  bookCategory: BookCategory | "";
  status: EntryStatus;
  progressText: string;
  progressPercent: number;
  platform: string;
  country: string;
  startedAt: string;
  lastSeenAt: string;
  completedAt: string;
  rating: number | null;
  createdAt: string;
  updatedAt: string;
  notes: Note[];
};

type EntryForm = {
  title: string;
  creator: string;
  mediaType: MediaType;
  bookCategory: BookCategory;
  status: EntryStatus;
  progressText: string;
  progressPercent: number;
  platform: string;
  country: string;
  lastSeenAt: string;
  rating: number;
  thought: string;
};

const typeMeta: Record<MediaType, { label: string; mark: string }> = {
  book: { label: "书籍", mark: "书" },
  movie: { label: "电影", mark: "影" },
  series: { label: "剧集", mark: "剧" },
};

const bookCategoryMeta: Record<BookCategory, string> = {
  literary: "文学小说",
  social_science: "人文社科",
  web_fiction: "网络文学",
  manga: "漫画",
};

const statusMeta: Record<EntryStatus, string> = {
  in_progress: "进行中",
  completed: "已完成",
  paused: "暂放",
};

const today = () => new Date().toISOString().slice(0, 10);

const emptyForm = (): EntryForm => ({
  title: "",
  creator: "",
  mediaType: "book",
  bookCategory: "literary",
  status: "in_progress",
  progressText: "",
  progressPercent: 0,
  platform: "",
  country: "",
  lastSeenAt: today(),
  rating: 0,
  thought: "",
});

function formatDate(date: string) {
  if (!date) return "未记录日期";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${date.slice(0, 10)}T12:00:00`));
}

function relativeDate(date: string) {
  if (!date) return "";
  const days = Math.floor(
    (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24),
  );
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 30) return `${days} 天前`;
  return formatDate(date);
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
  return (
    <div className={`score ${interactive ? "interactive-score" : ""}`}>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((point) =>
        interactive ? (
          <button
            aria-label={`${point} 分`}
            className={point === value ? "score-point active" : "score-point"}
            key={point}
            onClick={() => onChange?.(point === value ? 0 : point)}
            type="button"
          >
            {point}
          </button>
        ) : (
          <span className="score-readout" key={point}>
            {point === 1 ? (
              <>
                <strong>{value}</strong>
                <small>/ 10</small>
              </>
            ) : null}
          </span>
        ),
      )}
    </div>
  );
}

function EntryCard({
  entry,
  onOpen,
}: {
  entry: Entry;
  onOpen: (entry: Entry) => void;
}) {
  const latestNote = entry.notes[0];
  return (
    <button className="entry-card" onClick={() => onOpen(entry)} type="button">
      <div className={`media-mark media-${entry.mediaType}`}>
        <span>{typeMeta[entry.mediaType].mark}</span>
        <i aria-hidden="true" />
      </div>
      <div className="entry-copy">
        <div className="entry-topline">
          <span className="eyebrow">
            {entry.mediaType === "book" && entry.bookCategory
              ? bookCategoryMeta[entry.bookCategory]
              : typeMeta[entry.mediaType].label}
          </span>
          <span className={`status-dot ${entry.status}`} />
          <span className="status-label">{statusMeta[entry.status]}</span>
        </div>
        <h3>{entry.title}</h3>
        <p className="creator">{entry.creator || "创作者未填写"}</p>
        {entry.status === "completed" && entry.rating ? (
          <Score value={entry.rating} />
        ) : (
          <div className="progress-row">
            <div className="progress-track" aria-label={`进度 ${entry.progressPercent}%`}>
              <span style={{ width: `${entry.progressPercent}%` }} />
            </div>
            <strong>{entry.progressPercent}%</strong>
          </div>
        )}
        <div className="entry-foot">
          <span>{entry.progressText || "还没有记录位置"}</span>
          <span>{relativeDate(entry.lastSeenAt)}</span>
        </div>
        {latestNote && <p className="note-preview">“{latestNote.content}”</p>}
      </div>
    </button>
  );
}

function InsightsPanel({ entries }: { entries: Entry[] }) {
  type ChartDatum = { label: string; count: number; color?: string };
  const [chart, setChart] = useState<"types" | "countries" | "ratings">("types");
  const completed = entries.filter((entry) => entry.status === "completed");
  const rated = completed.filter((entry) => entry.rating);
  const average = rated.length
    ? rated.reduce((sum, entry) => sum + (entry.rating || 0), 0) / rated.length
    : 0;

  const typeCounts: ChartDatum[] = [
    {
      label: "文学小说",
      count: entries.filter((entry) => entry.bookCategory === "literary").length,
      color: "var(--media-book)",
    },
    {
      label: "人文社科",
      count: entries.filter((entry) => entry.bookCategory === "social_science")
        .length,
      color: "#777772",
    },
    {
      label: "网络文学",
      count: entries.filter((entry) => entry.bookCategory === "web_fiction")
        .length,
      color: "#92928d",
    },
    {
      label: "漫画",
      count: entries.filter((entry) => entry.bookCategory === "manga").length,
      color: "#b0b0aa",
    },
    {
      label: "电影",
      count: entries.filter((entry) => entry.mediaType === "movie").length,
      color: "var(--media-movie)",
    },
    {
      label: "剧集",
      count: entries.filter((entry) => entry.mediaType === "series").length,
      color: "var(--media-series)",
    },
  ];

  const countryMap = entries.reduce<Record<string, number>>((result, entry) => {
    const country = entry.country.trim() || "未记录";
    result[country] = (result[country] || 0) + 1;
    return result;
  }, {});
  const countryCounts: ChartDatum[] = Object.entries(countryMap)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const ratingCounts: ChartDatum[] = Array.from({ length: 10 }, (_, index) => ({
    label: `${index + 1} 分`,
    count: rated.filter((entry) => entry.rating === index + 1).length,
  }));
  const activeData =
    chart === "types"
      ? typeCounts
      : chart === "countries"
        ? countryCounts
        : ratingCounts;
  const maxCount = Math.max(1, ...activeData.map((item) => item.count));
  const topCountry = countryCounts.find((item) => item.label !== "未记录");
  const favoriteType = [...typeCounts].sort((a, b) => b.count - a.count)[0];

  return (
    <section className="insights-page">
      <div className="insights-intro">
        <span className="date-kicker">YOUR READING & WATCHING</span>
        <h1>统计</h1>
        <p>按类型、国家与地区、评分查看全部记录。</p>
      </div>

      <div className="insight-summary">
        <div>
          <span>总收藏</span>
          <strong>{entries.length}</strong>
          <small>部作品</small>
        </div>
        <div>
          <span>完成率</span>
          <strong>
            {entries.length
              ? Math.round((completed.length / entries.length) * 100)
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
          <strong>
            {entries.reduce((sum, entry) => sum + entry.notes.length, 0)}
          </strong>
          <small>则</small>
        </div>
      </div>

      <section className="chart-card">
        <div className="chart-heading">
          <div>
            <span className="eyebrow">OVERVIEW</span>
            <h2>
              {chart === "types"
                ? "类型分布"
                : chart === "countries"
                  ? "国家 / 地区分布"
                  : "评分分布"}
            </h2>
          </div>
          <div className="chart-options" aria-label="统计图选项">
            <button
              className={chart === "types" ? "active" : ""}
              onClick={() => setChart("types")}
              type="button"
            >
              类型构成
            </button>
            <button
              className={chart === "countries" ? "active" : ""}
              onClick={() => setChart("countries")}
              type="button"
            >
              国家 / 地区
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

        {entries.length ? (
          <div className={`bar-chart chart-${chart}`}>
            {activeData.map((item, index) => (
              <div className="bar-item" key={item.label}>
                <div className="bar-value">
                  <span>{item.count || ""}</span>
                  <i
                    style={{
                      height: `${Math.max(3, (item.count / maxCount) * 100)}%`,
                      background:
                        item.color
                          ? item.color
                          : chart === "ratings"
                            ? "var(--ink)"
                            : "var(--sage)",
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
            <p>添加记录后，这里会自动生成统计图。</p>
          </div>
        )}
      </section>

      <div className="insight-notes">
        <article>
          <span>最常看的类型</span>
          <strong>
            {favoriteType?.count ? favoriteType.label : "还看不出来"}
          </strong>
          <p>
            {favoriteType?.count
              ? `共 ${favoriteType.count} 部，占当前记录最多。`
              : "添加记录后自动计算。"}
          </p>
        </article>
        <article>
          <span>记录最多的国家 / 地区</span>
          <strong>{topCountry?.label || "尚未填写"}</strong>
          <p>
            {topCountry
              ? `共 ${topCountry.count} 部。国家与地区支持自由填写。`
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
              ? `目前平均给出 ${average.toFixed(1)} 分，共 ${rated.length} 部参与统计。`
              : "完成作品并给出 1–10 分后自动统计。"}
          </p>
        </article>
      </div>
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
  const [view, setView] = useState<"records" | "insights">("records");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [form, setForm] = useState<EntryForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");

  async function loadEntries() {
    try {
      const response = await fetch("/api/entries", { cache: "no-store" });
      if (!response.ok) throw new Error("记录加载失败");
      const data = (await response.json()) as { entries: Entry[] };
      setEntries(data.entries);
      setError("");
    } catch {
      setError("暂时没能读到你的记录，请稍后刷新重试。");
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
        entry.creator.toLowerCase().includes(keyword) ||
        entry.platform.toLowerCase().includes(keyword);
      const matchesStatus =
        statusFilter === "all" || entry.status === statusFilter;
      const matchesType =
        typeFilter === "all" || entry.mediaType === typeFilter;
      return matchesSearch && matchesStatus && matchesType;
    });
  }, [entries, search, statusFilter, typeFilter]);

  const activeEntries = entries
    .filter((entry) => entry.status === "in_progress")
    .slice(0, 3);

  const stats = useMemo(
    () => ({
      active: entries.filter((entry) => entry.status === "in_progress").length,
      completed: entries.filter((entry) => entry.status === "completed").length,
      notes: entries.reduce((sum, entry) => sum + entry.notes.length, 0),
    }),
    [entries],
  );

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setEditorOpen(true);
  }

  function openEdit(entry: Entry) {
    setSelected(null);
    setEditing(entry);
    setForm({
      title: entry.title,
      creator: entry.creator,
      mediaType: entry.mediaType,
      bookCategory: entry.bookCategory || "literary",
      status: entry.status,
      progressText: entry.progressText,
      progressPercent: entry.progressPercent,
      platform: entry.platform,
      country: entry.country,
      lastSeenAt: entry.lastSeenAt.slice(0, 10),
      rating: entry.rating || 0,
      thought: "",
    });
    setEditorOpen(true);
  }

  async function saveEntry(event: FormEvent) {
    event.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const response = await fetch(
        editing ? `/api/entries/${editing.id}` : "/api/entries",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        },
      );
      if (!response.ok) throw new Error("保存失败");
      setEditorOpen(false);
      setEditing(null);
      await loadEntries();
    } catch {
      setError("这次没有保存成功，请再试一次。");
    } finally {
      setSaving(false);
    }
  }

  async function addNote(event: FormEvent) {
    event.preventDefault();
    if (!selected || !noteDraft.trim()) return;
    setSaving(true);
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryId: selected.id,
          content: noteDraft,
          progressText: selected.progressText,
        }),
      });
      if (!response.ok) throw new Error("保存失败");
      setNoteDraft("");
      await loadEntries();
      const data = (await response.json()) as { note: Note };
      setSelected((current) =>
        current ? { ...current, notes: [data.note, ...current.notes] } : current,
      );
    } catch {
      setError("感想没有保存成功，请再试一次。");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry() {
    if (!selected) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/entries/${selected.id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("删除失败");
      setSelected(null);
      await loadEntries();
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
          <span className="brand-seal">留</span>
          <div>
            <strong>留痕</strong>
            <small>我的书影音手帐</small>
          </div>
        </div>

        <nav aria-label="记录筛选" className="side-nav">
          {[
            ["all", "全部记录", entries.length],
            ["in_progress", "正在看", stats.active],
            ["completed", "已完成", stats.completed],
            [
              "paused",
              "暂时搁置",
              entries.filter((entry) => entry.status === "paused").length,
            ],
          ].map(([value, label, count]) => (
            <button
              className={statusFilter === value ? "active" : ""}
              key={value}
              onClick={() => {
                setStatusFilter(value as "all" | EntryStatus);
                setView("records");
              }}
              type="button"
            >
              <span>{label}</span>
              <em>{count}</em>
            </button>
          ))}
          <button
            className={view === "insights" ? "active insights-nav" : "insights-nav"}
            onClick={() => setView("insights")}
            type="button"
          >
            <span>统计图</span>
            <em>↗</em>
          </button>
        </nav>

        <div className="sidebar-note">
          <span>个人书影音记录</span>
          <p>记录进度、平台、评分和感想。</p>
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
                placeholder="搜索片名、书名、作者或平台"
                type="search"
                value={search}
              />
            </label>
          ) : (
            <span className="topbar-title">我的观看档案 · 实时统计</span>
          )}
          <div className="topbar-actions">
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
              <span>＋</span> 新建记录
            </button>
          </div>
        </header>

        {view === "records" ? (
          <>
        <div className="hero">
          <div>
            <span className="date-kicker">
              {new Intl.DateTimeFormat("zh-CN", {
                month: "long",
                day: "numeric",
                weekday: "long",
              }).format(new Date())}
            </span>
            <h1>最近的观看进度</h1>
            <p>继续更新，避免忘记上次看到哪里。</p>
          </div>
          <div className="stats">
            <div>
              <strong>{stats.active}</strong>
              <span>正在进行</span>
            </div>
            <div>
              <strong>{stats.completed}</strong>
              <span>已经看完</span>
            </div>
            <div>
              <strong>{stats.notes}</strong>
              <span>则感想</span>
            </div>
          </div>
        </div>

        {error && (
          <button className="error-banner" onClick={() => void loadEntries()}>
            {error} <u>重试</u>
          </button>
        )}

        <section className="now-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">CONTINUE</span>
              <h2>正在看的</h2>
            </div>
            {activeEntries.length > 0 && (
              <button
                className="text-button"
                onClick={() => setStatusFilter("in_progress")}
                type="button"
              >
                查看全部 →
              </button>
            )}
          </div>

          {loading ? (
            <div className="loading-grid">
              <i />
              <i />
              <i />
            </div>
          ) : activeEntries.length ? (
            <div className="active-grid">
              {activeEntries.map((entry) => (
                <EntryCard entry={entry} key={entry.id} onOpen={setSelected} />
              ))}
            </div>
          ) : (
            <button className="empty-now" onClick={openCreate} type="button">
              <span className="empty-mark">＋</span>
              <span>
                <strong>添加第一条记录</strong>
                <small>录入作品名称、当前进度和观看平台</small>
              </span>
              <em>新建记录</em>
            </button>
          )}
        </section>

        <section className="library-section">
          <div className="section-heading library-heading">
            <div>
              <span className="eyebrow">ARCHIVE</span>
              <h2>我的收藏</h2>
            </div>
            <div className="type-filter" aria-label="类型筛选">
              {(["all", "book", "movie", "series"] as const).map(
                (type) => (
                  <button
                    className={typeFilter === type ? "active" : ""}
                    key={type}
                    onClick={() => setTypeFilter(type)}
                    type="button"
                  >
                    {type === "all" ? "全部" : typeMeta[type].label}
                  </button>
                ),
              )}
            </div>
          </div>

          {filteredEntries.length ? (
            <div className="library-grid">
              {filteredEntries.map((entry) => (
                <EntryCard entry={entry} key={entry.id} onOpen={setSelected} />
              ))}
            </div>
          ) : (
            !loading && (
              <div className="empty-library">
                <span>暂无符合条件的记录</span>
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
              </div>
            )
          )}
        </section>
          </>
        ) : (
          <InsightsPanel entries={entries} />
        )}
      </section>

      <button
        aria-label="新建记录"
        className="mobile-add"
        onClick={openCreate}
        type="button"
      >
        ＋
      </button>

      {editorOpen && (
        <div className="modal-backdrop" role="presentation">
          <div
            aria-label={editing ? "编辑记录" : "新建记录"}
            aria-modal="true"
            className="editor-modal"
            role="dialog"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">
                  {editing ? "EDIT RECORD" : "NEW RECORD"}
                </span>
                <h2>{editing ? "编辑记录" : "新增记录"}</h2>
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
                    onClick={() => setForm({ ...form, mediaType: type })}
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

              <label className="field field-wide">
                <span>作品名称 *</span>
                <input
                  autoFocus
                  onChange={(event) =>
                    setForm({ ...form, title: event.target.value })
                  }
                  placeholder="例如：百年孤独"
                  required
                  value={form.title}
                />
              </label>

              <div className="field-row">
                <label className="field">
                  <span>作者 / 导演</span>
                  <input
                    onChange={(event) =>
                      setForm({ ...form, creator: event.target.value })
                    }
                    placeholder="加西亚·马尔克斯"
                    value={form.creator}
                  />
                </label>
                <label className="field">
                  <span>观看平台 / 版本</span>
                  <input
                    onChange={(event) =>
                      setForm({ ...form, platform: event.target.value })
                    }
                    placeholder="微信读书、影院、Netflix…"
                    value={form.platform}
                  />
                </label>
              </div>

              <label className="field field-wide">
                <span>国家 / 地区</span>
                <input
                  onChange={(event) =>
                    setForm({ ...form, country: event.target.value })
                  }
                  placeholder="例如：中国、日本、法国、美国"
                  value={form.country}
                />
              </label>

              <div className="field-row">
                <label className="field">
                  <span>当前状态</span>
                  <select
                    onChange={(event) =>
                      setForm({
                        ...form,
                        status: event.target.value as EntryStatus,
                        progressPercent:
                          event.target.value === "completed"
                            ? 100
                            : form.progressPercent,
                      })
                    }
                    value={form.status}
                  >
                    <option value="in_progress">正在进行</option>
                    <option value="completed">已经完成</option>
                    <option value="paused">暂时搁置</option>
                  </select>
                </label>
                <label className="field">
                  <span>这次看到的日期</span>
                  <input
                    onChange={(event) =>
                      setForm({ ...form, lastSeenAt: event.target.value })
                    }
                    type="date"
                    value={form.lastSeenAt}
                  />
                </label>
              </div>

              <label className="field field-wide">
                <span>看到哪里</span>
                <input
                  onChange={(event) =>
                    setForm({ ...form, progressText: event.target.value })
                  }
                  placeholder="第 6 章末 / 01:32:10 / 第 12 集"
                  value={form.progressText}
                />
              </label>

              <label className="range-field">
                <span>
                  大致进度 <strong>{form.progressPercent}%</strong>
                </span>
                <input
                  max="100"
                  min="0"
                  onChange={(event) =>
                    setForm({
                      ...form,
                      progressPercent: Number(event.target.value),
                    })
                  }
                  type="range"
                  value={form.progressPercent}
                />
              </label>

              {form.status === "completed" && (
                <div className="rating-field">
                  <span>看完评分</span>
                  <Score
                    interactive
                    onChange={(rating) => setForm({ ...form, rating })}
                    value={form.rating}
                  />
                  <small>{form.rating ? `${form.rating} / 10` : "暂不评分"}</small>
                </div>
              )}

              <label className="field field-wide">
                <span>{editing ? "补充一则新感想" : "此刻的感想"}</span>
                <textarea
                  onChange={(event) =>
                    setForm({ ...form, thought: event.target.value })
                  }
                  placeholder="这则感想会连同当前进度一起保存。"
                  rows={4}
                  value={form.thought}
                />
              </label>

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
                  {saving ? "正在保存…" : editing ? "保存更新" : "留下记录"}
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
              <button
                className="text-button"
                onClick={() => openEdit(selected)}
                type="button"
              >
                编辑记录
              </button>
              <button
                aria-label="关闭"
                className="close-button"
                onClick={() => setSelected(null)}
                type="button"
              >
                ×
              </button>
            </div>
            <div className={`detail-cover media-${selected.mediaType}`}>
              <span>{typeMeta[selected.mediaType].mark}</span>
              <i />
            </div>
            <div className="detail-title">
              <span className="eyebrow">
                {selected.mediaType === "book" && selected.bookCategory
                  ? bookCategoryMeta[selected.bookCategory]
                  : typeMeta[selected.mediaType].label}{" "}
                ·{" "}
                {statusMeta[selected.status]}
              </span>
              <h2>{selected.title}</h2>
              <p>{selected.creator || "创作者未填写"}</p>
              {selected.rating ? <Score value={selected.rating} /> : null}
            </div>

            <dl className="detail-meta">
              <div>
                <dt>上次看到</dt>
                <dd>{selected.progressText || "未记录具体位置"}</dd>
              </div>
              <div>
                <dt>平台 / 版本</dt>
                <dd>{selected.platform || "未记录"}</dd>
              </div>
              <div>
                <dt>国家 / 地区</dt>
                <dd>{selected.country || "未记录"}</dd>
              </div>
              <div>
                <dt>最后更新</dt>
                <dd>{formatDate(selected.lastSeenAt)}</dd>
              </div>
            </dl>

            <div className="drawer-progress">
              <div>
                <span>整体进度</span>
                <strong>{selected.progressPercent}%</strong>
              </div>
              <div className="progress-track">
                <span style={{ width: `${selected.progressPercent}%` }} />
              </div>
            </div>

            <section className="thoughts">
              <div className="thoughts-heading">
                <h3>感想记录</h3>
                <span>{selected.notes.length} 则</span>
              </div>
              <form className="quick-note" onSubmit={addNote}>
                <textarea
                  aria-label="记录新感想"
                  onChange={(event) => setNoteDraft(event.target.value)}
                  placeholder="刚刚读到这里，我想到……"
                  rows={3}
                  value={noteDraft}
                />
                <button
                  disabled={saving || !noteDraft.trim()}
                  type="submit"
                >
                  记下来
                </button>
              </form>
              <div className="note-timeline">
                {selected.notes.length ? (
                  selected.notes.map((note) => (
                    <article key={note.id}>
                      <i />
                      <div>
                        <div>
                          <span>{note.progressText || "随手记"}</span>
                          <time>{formatDate(note.createdAt)}</time>
                        </div>
                        <p>{note.content}</p>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="no-notes">
                    暂无感想记录。
                  </p>
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
    </main>
  );
}
