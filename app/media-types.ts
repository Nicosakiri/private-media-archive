export type MediaType = "book" | "movie" | "series";
export type BookCategory =
  | "literary"
  | "social_science"
  | "web_fiction"
  | "manga";
export type SeriesCategory = "tv" | "anime" | "variety";
export type MovieMode = "" | "cinema" | "streaming";
export type EntryStatus = "in_progress" | "completed" | "abandoned";
export type ProgressUnit = "page" | "minute" | "episode";

export type Note = {
  id: string;
  content: string;
  progressText: string;
  currentUnits: number;
  progressPercent: number;
  status: EntryStatus;
  watchedAt: string;
  createdAt: string;
};

export type Entry = {
  id: string;
  title: string;
  originalTitle: string;
  creator: string;
  mediaType: MediaType;
  bookCategory: BookCategory | "";
  seriesCategory: SeriesCategory | "";
  movieMode: MovieMode;
  status: EntryStatus;
  progressText: string;
  progressPercent: number;
  progressUnit: ProgressUnit;
  totalUnits: number;
  currentUnits: number;
  platform: string;
  country: string;
  cast: string;
  year: string;
  doubanUrl: string;
  coverUrl: string;
  startedAt: string;
  lastSeenAt: string;
  completedAt: string;
  rating: number | null;
  createdAt: string;
  updatedAt: string;
  notes: Note[];
};

export type EntryForm = {
  title: string;
  originalTitle: string;
  creator: string;
  mediaType: MediaType;
  bookCategory: BookCategory;
  seriesCategory: SeriesCategory;
  movieMode: MovieMode;
  status: EntryStatus;
  progressUnit: ProgressUnit;
  totalUnits: string;
  currentUnits: string;
  platform: string;
  country: string;
  cast: string;
  year: string;
  doubanUrl: string;
  coverUrl: string;
  lastSeenAt: string;
  rating: number;
  thought: string;
};

export const typeMeta: Record<
  MediaType,
  { label: string; mark: string; creatorLabel: string }
> = {
  book: { label: "书籍", mark: "📖", creatorLabel: "作者" },
  movie: { label: "电影", mark: "🎬", creatorLabel: "导演" },
  series: { label: "剧集", mark: "📺", creatorLabel: "主创" },
};

export const bookCategoryMeta: Record<BookCategory, string> = {
  literary: "文学小说",
  social_science: "人文社科",
  web_fiction: "网络文学",
  manga: "漫画",
};

export const movieModeMeta: Record<Exclude<MovieMode, "">, string> = {
  cinema: "影院观看",
  streaming: "流媒体观看",
};

export const seriesCategoryMeta: Record<SeriesCategory, string> = {
  tv: "电视剧",
  anime: "动漫",
  variety: "综艺",
};

export const statusMeta: Record<EntryStatus, string> = {
  in_progress: "进行中",
  completed: "已看完",
  abandoned: "已弃",
};

export const progressUnitMeta: Record<
  ProgressUnit,
  { total: string; current: string; unit: string }
> = {
  page: {
    total: "总页数",
    current: "看到第几页",
    unit: "页",
  },
  minute: {
    total: "全片时长（分钟）",
    current: "看到第几分钟",
    unit: "分钟",
  },
  episode: {
    total: "总集数",
    current: "看到第几集",
    unit: "集",
  },
};

export function defaultProgressUnit(mediaType: MediaType): ProgressUnit {
  if (mediaType === "book") return "page";
  if (mediaType === "movie") return "minute";
  return "episode";
}

export function calculateProgress(
  movieMode: MovieMode,
  totalUnits: number,
  currentUnits: number,
) {
  if (movieMode === "cinema") return 100;
  if (!Number.isFinite(totalUnits) || totalUnits <= 0) return 0;
  const value = Math.round((Math.max(0, currentUnits) / totalUnits) * 100);
  return Math.min(100, Math.max(0, value));
}

export function deriveStatus(
  progressPercent: number,
  manuallyAbandoned: boolean,
): EntryStatus {
  if (manuallyAbandoned) return "abandoned";
  return progressPercent >= 100 ? "completed" : "in_progress";
}

export function makeProgressText(
  mediaType: MediaType,
  movieMode: MovieMode,
  progressUnit: ProgressUnit,
  totalUnits: number,
  currentUnits: number,
) {
  if (mediaType === "movie" && movieMode === "cinema") {
    return "影院观看 · 已完成";
  }
  if (!currentUnits && !totalUnits) return "";
  const unit = progressUnitMeta[progressUnit].unit;
  if (!totalUnits) return `${currentUnits} ${unit}`;
  return `${Math.min(currentUnits, totalUnits)} / ${totalUnits} ${unit}`;
}
