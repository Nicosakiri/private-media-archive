export type MediaType = "book" | "movie" | "series";
export type BookCategory =
  | "literary"
  | "social_science"
  | "textbook"
  | "web_fiction"
  | "light_novel"
  | "manga";
export type SeriesCategory = "tv" | "anime" | "variety";
export type MovieMode = "" | "cinema" | "streaming";
export type EntryStatus = "in_progress" | "completed" | "abandoned";
export type ProgressUnit = "page" | "minute" | "episode";
export type ProgressMode = "units" | "percent";
export type WebFictionType = "" | "bg" | "danmei" | "gen" | "other";

export type NoteImage = {
  id: string;
  name: string;
  dataUrl: string;
};

export type Note = {
  id: string;
  content: string;
  quoteText: string;
  quoteMinute: number;
  progressText: string;
  currentUnits: number;
  progressPercent: number;
  status: EntryStatus;
  volume: number;
  images: NoteImage[];
  thoughtImages: NoteImage[];
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
  progressMode: ProgressMode;
  totalUnits: number;
  currentUnits: number;
  volume: number;
  webFictionType: WebFictionType;
  danmeiTags: string[];
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
  progressMode: ProgressMode;
  totalUnits: string;
  currentUnits: string;
  manualProgressPercent: string;
  volume: string;
  webFictionType: WebFictionType;
  danmeiTags: string;
  platform: string;
  country: string;
  cast: string;
  year: string;
  doubanUrl: string;
  coverUrl: string;
  lastSeenAt: string;
  rating: number;
  thought: string;
  thoughtQuote: string;
  thoughtMinute: string;
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
  textbook: "Textbook",
  web_fiction: "网络文学",
  light_novel: "轻小说",
  manga: "漫画",
};

export const webFictionTypeMeta: Record<Exclude<WebFictionType, "">, string> = {
  bg: "BG",
  danmei: "耽美",
  gen: "无性向",
  other: "其他",
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
  progressMode: ProgressMode = "units",
  progressPercent = 0,
  volume = 0,
) {
  const volumeText = volume > 0 ? `第 ${volume} 卷 · ` : "";
  if (mediaType === "movie" && movieMode === "cinema") {
    return "影院观看 · 已完成";
  }
  if (mediaType === "book" && progressMode === "percent") {
    return `${volumeText}${Math.min(100, Math.max(0, progressPercent))}%`;
  }
  if (!currentUnits && !totalUnits) return "";
  const unit = progressUnitMeta[progressUnit].unit;
  if (!totalUnits) return `${volumeText}${currentUnits} ${unit}`;
  return `${volumeText}${Math.min(currentUnits, totalUnits)} / ${totalUnits} ${unit}`;
}
