"use client";

import {
  ChangeEvent,
  ClipboardEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  listLocalDeletedEntries,
  listLocalEntries,
  removeLocalEntry,
  replaceLocalArchive,
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
  webFictionTypeMeta,
} from "./media-types";
import type {
  BookCategory,
  Entry,
  EntryForm,
  EntryStatus,
  MediaType,
  MovieMode,
  Note,
  NoteImage,
  ProgressMode,
  SeriesCategory,
  WebFictionType,
} from "./media-types";
import {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  mergeArchives,
  parseArchive,
  type LocalArchive,
} from "./sync-model";

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
  manualProgressPercent: string;
  progressMode: ProgressMode;
  volume: string;
  watchedAt: string;
  thought: string;
  quoteText: string;
  quoteMinute: string;
  images: NoteImage[];
  thoughtImages: NoteImage[];
  status: EntryStatus;
  rating: number;
  danmeiTags: string;
};

type ThoughtEditForm = {
  currentUnits: string;
  manualProgressPercent: string;
  progressMode: ProgressMode;
  volume: string;
  content: string;
  quoteText: string;
  quoteMinute: string;
  images: NoteImage[];
  thoughtImages: NoteImage[];
};

type HiddenWebFilter = "all" | Exclude<WebFictionType, "">;

type LocalUserProfile = {
  name: string;
  avatar: string;
};

type LanSyncStatus = {
  available: true;
  isHost: boolean;
  pairingCode: string | null;
  urls: string[];
  revision: number;
  updatedAt: string;
  entryCount: number;
};

const defaultUserProfile: LocalUserProfile = {
  name: "Nicosakiri",
  avatar: "nicosakiri-avatar.png",
};

const defaultHiddenWebFilters: HiddenWebFilter[] = ["all"];
const HIDDEN_WEB_FILTERS_KEY = "pma-hidden-web-filters";
const USER_PROFILE_KEY = "pma-local-user-profile";
const DEVICE_ID_KEY = "pma-device-id";
const LAN_PAIRING_CODE_KEY = "pma-lan-pairing-code";

function createLocalId() {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === "function") {
    return webCrypto.randomUUID();
  }

  if (typeof webCrypto?.getRandomValues === "function") {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-");
  }

  return `pma-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}

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
  progressMode: "units",
  totalUnits: "",
  currentUnits: "",
  manualProgressPercent: "",
  volume: "",
  webFictionType: "",
  danmeiTags: "",
  platform: "",
  country: "",
  cast: "",
  year: "",
  doubanUrl: "",
  coverUrl: "",
  lastSeenAt: today(),
  rating: 0,
  thought: "",
  thoughtQuote: "",
  thoughtMinute: "",
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

function oneDecimalFromForm(value: string) {
  return Math.round(numberFromForm(value) * 10) / 10;
}

function entryMatchesHiddenFilter(
  entry: Entry,
  filters: HiddenWebFilter[],
) {
  if (entry.bookCategory !== "web_fiction") return false;
  return filters.includes("all") ||
    (entry.webFictionType !== "" && filters.includes(entry.webFictionType));
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
    manualProgressPercent:
      entry.progressMode === "percent" ? String(entry.progressPercent) : "",
    progressMode: entry.progressMode || "units",
    volume: entry.volume ? String(entry.volume) : "",
    watchedAt: today(),
    thought: "",
    quoteText: "",
    quoteMinute: "",
    images: [],
    thoughtImages: [],
    status: entry.status === "abandoned" ? "in_progress" : entry.status,
    rating: entry.rating || 0,
    danmeiTags: entry.danmeiTags.join("、"),
  };
}

function parseTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[、,，/／|｜]+/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
}

function calendarProgressLabel(entry: Entry, note: Note) {
  if (entry.mediaType === "movie" && entry.movieMode === "cinema") {
    return "影院观看";
  }
  if (entry.progressMode === "percent") {
    return note.progressText || `${note.progressPercent}%`;
  }
  if (!note.currentUnits) return note.progressText || "开始观看";
  return `${note.currentUnits}${progressUnitMeta[entry.progressUnit].unit}`;
}

function noteHasThought(note: Note) {
  return Boolean(
    note.content.trim() ||
      note.quoteText.trim() ||
      note.images.length ||
      note.thoughtImages.length,
  );
}

async function imageFileToAttachment(file: File): Promise<NoteImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("只能添加图片文件。");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("单张图片请控制在 5MB 以内。");
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  return {
    id: createLocalId(),
    name: file.name || "粘贴的图片",
    dataUrl,
  };
}

async function appendThoughtImages(
  files: File[],
  current: NoteImage[],
  onChange: (images: NoteImage[]) => void,
  onError: (message: string) => void,
) {
  const imageFiles = files.filter((file) => file.type.startsWith("image/"));
  if (!imageFiles.length) return;
  if (current.length + imageFiles.length > 6) {
    onError("每条感想最多保存 6 张图片。");
    return;
  }
  try {
    const attachments = await Promise.all(
      imageFiles.map((file) => imageFileToAttachment(file)),
    );
    onChange([...current, ...attachments]);
    onError("");
  } catch (error) {
    onError(error instanceof Error ? error.message : "图片没有读取成功。");
  }
}

function ThoughtComposer({
  images,
  mediaType,
  onChange,
  onError,
  onImagesChange,
  onQuoteChange,
  onQuoteMinuteChange,
  onThoughtImagesChange,
  placeholder,
  quoteMinute,
  quoteText,
  rows = 5,
  thoughtImages,
  value,
}: {
  images: NoteImage[];
  mediaType: MediaType;
  onChange: (value: string) => void;
  onError: (message: string) => void;
  onImagesChange: (images: NoteImage[]) => void;
  onQuoteChange: (value: string) => void;
  onQuoteMinuteChange: (value: string) => void;
  onThoughtImagesChange: (images: NoteImage[]) => void;
  placeholder: string;
  quoteMinute: string;
  quoteText: string;
  rows?: number;
  thoughtImages: NoteImage[];
  value: string;
}) {
  function pastedImageFiles(event: ClipboardEvent<HTMLElement>) {
    return Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
  }

  function handleReferencePaste(event: ClipboardEvent<HTMLElement>) {
    const files = pastedImageFiles(event);
    if (!files.length) return;
    event.preventDefault();
    void appendThoughtImages(files, images, onImagesChange, onError);
  }

  function handleThoughtPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = pastedImageFiles(event);
    if (!files.length) return;
    event.preventDefault();
    void appendThoughtImages(
      files,
      thoughtImages,
      onThoughtImagesChange,
      onError,
    );
  }

  return (
    <div className="thought-composer">
      <div
        aria-label={`${mediaType === "book" ? "原文" : "截图"}区域，可直接粘贴图片`}
        className="thought-reference-box"
        onPaste={handleReferencePaste}
        tabIndex={mediaType === "book" ? -1 : 0}
      >
        <div className="thought-reference-heading">
          <strong>{mediaType === "book" ? "原文" : "截图"}</strong>
          <small>可选</small>
        </div>
        {mediaType === "book" ? (
          <textarea
            className="quote-textarea"
            onChange={(event) => onQuoteChange(event.target.value)}
            placeholder="粘贴原文，也可以直接粘贴原文截图"
            rows={3}
            value={quoteText}
          />
        ) : (
          <label className="screenshot-minute-field">
            <span>对应分钟数</span>
            <input
              inputMode="numeric"
              min="0"
              onChange={(event) => onQuoteMinuteChange(event.target.value)}
              placeholder="例如：42"
              step="1"
              type="number"
              value={quoteMinute}
            />
          </label>
        )}
        {images.length > 0 && (
          <div className="thought-image-drafts">
            {images.map((image) => (
              <figure key={image.id}>
                <img alt={image.name} src={image.dataUrl} />
                <button
                  aria-label={`移除 ${image.name}`}
                  onClick={() =>
                    onImagesChange(images.filter((item) => item.id !== image.id))
                  }
                  type="button"
                >
                  ×
                </button>
              </figure>
            ))}
          </div>
        )}
        <div className="thought-composer-footer">
          <label title={mediaType === "book" ? "添加原文截图" : "添加截图"}>
            <span aria-hidden="true">＋</span>
            <input
              accept="image/*"
              multiple
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                event.target.value = "";
                void appendThoughtImages(files, images, onImagesChange, onError);
              }}
              type="file"
            />
          </label>
          <small>也可在上方直接粘贴{mediaType === "book" ? "原文截图" : "截图"}</small>
        </div>
      </div>
      <label className="thought-text-field">
        <span>感想</span>
        <textarea
          onChange={(event) => onChange(event.target.value)}
          onPaste={handleThoughtPaste}
          placeholder={placeholder}
          rows={rows}
          value={value}
        />
      </label>
      {thoughtImages.length > 0 && (
        <div className="thought-image-drafts thought-comment-image-drafts">
          {thoughtImages.map((image) => (
            <figure key={image.id}>
              <img alt={image.name} src={image.dataUrl} />
              <button
                aria-label={`移除 ${image.name}`}
                onClick={() =>
                  onThoughtImagesChange(
                    thoughtImages.filter((item) => item.id !== image.id),
                  )
                }
                type="button"
              >
                ×
              </button>
            </figure>
          ))}
        </div>
      )}
      <small className="thought-paste-hint">可直接在感想框中粘贴感想图片</small>
    </div>
  );
}

function ThoughtBody({
  mediaType,
  note,
  onImageOpen,
  preview = false,
}: {
  mediaType: MediaType;
  note: Note;
  onImageOpen?: (image: NoteImage) => void;
  preview?: boolean;
}) {
  const hasReference = Boolean(note.quoteText.trim() || note.images.length);
  return (
    <div className={preview ? "thought-body preview" : "thought-body"}>
      {hasReference && (
        <blockquote className="thought-reference">
          <header>
            <span>{mediaType === "book" ? "原文" : "截图"}</span>
            {mediaType !== "book" && note.quoteMinute > 0 && (
              <small>{note.quoteMinute} 分钟</small>
            )}
          </header>
          {note.quoteText && <p>{note.quoteText}</p>}
          {note.images.length > 0 && (
            <div className="thought-images">
              {note.images.map((image) => (
                onImageOpen ? (
                  <button
                    aria-label={`放大查看 ${image.name}`}
                    className="thought-image-button"
                    key={image.id}
                    onClick={() => onImageOpen(image)}
                    type="button"
                  >
                    <img alt={image.name} src={image.dataUrl} />
                  </button>
                ) : (
                  <img alt={image.name} key={image.id} src={image.dataUrl} />
                )
              ))}
            </div>
          )}
        </blockquote>
      )}
      {note.content && <p className="thought-copy">{note.content}</p>}
      {note.thoughtImages.length > 0 && (
        <div className="thought-images thought-comment-images">
          {note.thoughtImages.map((image) =>
            onImageOpen ? (
              <button
                aria-label={`放大查看 ${image.name}`}
                className="thought-image-button"
                key={image.id}
                onClick={() => onImageOpen(image)}
                type="button"
              >
                <img alt={image.name} src={image.dataUrl} />
              </button>
            ) : (
              <img alt={image.name} key={image.id} src={image.dataUrl} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function progressTimelineNotes(notes: Note[]) {
  return notes.filter((note, index) => {
    const previousProgress = notes[index + 1];
    if (!previousProgress) return true;
    return (
      note.currentUnits !== previousProgress.currentUnits ||
      note.progressPercent !== previousProgress.progressPercent ||
      note.volume !== previousProgress.volume ||
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

const countryAliases: Record<string, string> = {
  中国大陆: "中国",
  中国香港: "中国",
  中国台湾: "中国",
  香港: "中国",
  台湾: "中国",
  美国: "美国",
  美利坚合众国: "美国",
  英国: "英国",
  英格兰: "英国",
  俄罗斯: "俄罗斯",
  俄国: "俄罗斯",
  韩国: "韩国",
  南韩: "韩国",
  日本: "日本",
  法国: "法国",
  德国: "德国",
  意大利: "意大利",
  西班牙: "西班牙",
  加拿大: "加拿大",
  墨西哥: "墨西哥",
  巴西: "巴西",
  阿根廷: "阿根廷",
  印度: "印度",
  埃及: "埃及",
  南非: "南非",
  澳大利亚: "澳大利亚",
  澳洲: "澳大利亚",
  新西兰: "新西兰",
  朝鲜: "朝鲜",
  北韩: "朝鲜",
  越南: "越南",
  泰国: "泰国",
  新加坡: "新加坡",
  马来西亚: "马来西亚",
  印尼: "印度尼西亚",
  印度尼西亚: "印度尼西亚",
  荷兰: "荷兰",
  比利时: "比利时",
  瑞典: "瑞典",
  挪威: "挪威",
  丹麦: "丹麦",
  芬兰: "芬兰",
  葡萄牙: "葡萄牙",
  波兰: "波兰",
  奥地利: "奥地利",
  瑞士: "瑞士",
};

function normalizeCountryName(value: string) {
  return countryAliases[value.trim()] || value.trim();
}

function countryKeys(value: string) {
  return value
    .split(/[\/／、,，&和·]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeCountryName);
}

type WorldFeature = {
  type: "Feature";
  properties: {
    name: string;
    nameEn: string;
    isoA2: string;
    isoA3: string;
  };
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
};

type WorldGeoJson = {
  type: "FeatureCollection";
  features: WorldFeature[];
};

function projectedPoint([longitude, latitude]: number[]) {
  const x = ((longitude + 180) / 360) * 1000;
  const y = ((84 - latitude) / 144) * 500;
  return [x, y];
}

function polygonPath(polygon: number[][][]) {
  return polygon
    .map((ring) =>
      `${ring
        .map((point, index) => {
          const [x, y] = projectedPoint(point);
          return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(" ")} Z`,
    )
    .join(" ");
}

function featurePath(feature: WorldFeature) {
  return feature.geometry.type === "Polygon"
    ? polygonPath(feature.geometry.coordinates as number[][][])
    : (feature.geometry.coordinates as number[][][][])
        .map(polygonPath)
        .join(" ");
}

function mapFill(count: number, maxCount: number) {
  if (!count) return "var(--map-empty)";
  const strength = 0.24 + (count / maxCount) * 0.76;
  const start = [183, 176, 218];
  const end = [91, 72, 183];
  const rgb = start.map((channel, index) =>
    Math.round(channel + (end[index] - channel) * strength),
  );
  return `rgb(${rgb.join(",")})`;
}

function WorldHeatMap({ counts }: { counts: Record<string, number> }) {
  const [features, setFeatures] = useState<WorldFeature[]>([]);
  const [mapError, setMapError] = useState(false);
  const [hovered, setHovered] = useState<{ name: string; count: number } | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    fetch("world-countries.geojson")
      .then((response) => {
        if (!response.ok) throw new Error("World map unavailable");
        return response.json() as Promise<WorldGeoJson>;
      })
      .then((data) => {
        if (active) setFeatures(data.features);
      })
      .catch(() => {
        if (active) setMapError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const maxCount = Math.max(1, ...Object.values(counts));
  const mappedKeys = new Set(
    features.map((feature) => normalizeCountryName(feature.properties.name)),
  );
  const unmapped = Object.entries(counts)
    .filter(([country]) => country !== "未记录" && !mappedKeys.has(country))
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="world-map-wrap">
      <div className="world-heat-map">
        {hovered && (
          <div className="world-map-tooltip" role="status">
            <strong>{hovered.name}</strong>
            <span>{hovered.count} 部作品</span>
          </div>
        )}
        {mapError ? (
          <p className="world-map-error">世界地图没有载入成功。</p>
        ) : (
          <svg
            aria-label="作品国家与地区世界地图；将鼠标移到国家上可查看作品数量"
            className="world-map-svg"
            role="img"
            viewBox="0 0 1000 500"
          >
            {features.map((feature) => {
              const country = normalizeCountryName(feature.properties.name);
              const count = counts[country] || 0;
              return (
                <path
                  aria-label={`${country}：${count} 部作品`}
                  className={count ? "active" : ""}
                  d={featurePath(feature)}
                  fill={mapFill(count, maxCount)}
                  key={`${feature.properties.isoA3}-${feature.properties.nameEn}`}
                  onBlur={() => setHovered(null)}
                  onFocus={() => setHovered({ name: country, count })}
                  onMouseEnter={() => setHovered({ name: country, count })}
                  onMouseLeave={() => setHovered(null)}
                  tabIndex={0}
                >
                  <title>{country}：{count} 部作品</title>
                </path>
              );
            })}
          </svg>
        )}
      </div>
      <div className="world-map-legend">
        <span>少</span><i /><i /><i /><i /><span>多</span>
      </div>
      {unmapped.length > 0 && (
        <div className="unmapped-countries">
          {unmapped.map(([country, count]) => (
            <span key={country}>{country} · {count}</span>
          ))}
        </div>
      )}
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
            <th><span className="property-icon">⌁</span>平台 / 版本 / 学科</th>
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
  const [webArea, setWebArea] = useState<"danmei" | "other">("danmei");
  const [chart, setChart] = useState<Chart>("primary");
  const scopedEntries =
    scope === "web"
      ? entries.filter(
          (entry) =>
            entry.bookCategory === "web_fiction" &&
            (webArea === "danmei"
              ? entry.webFictionType === "danmei"
              : entry.webFictionType !== "danmei"),
        )
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
      label: "教科书",
      count: scopedEntries.filter(
        (entry) => entry.bookCategory === "textbook",
      ).length,
      color: "#7b8799",
    },
    {
      label: "漫画",
      count: scopedEntries.filter((entry) => entry.bookCategory === "manga")
        .length,
      color: "#b0b0aa",
    },
    {
      label: "轻小说",
      count: scopedEntries.filter(
        (entry) => entry.bookCategory === "light_novel",
      ).length,
      color: "#8f7aaa",
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
      const countries = countryKeys(entry.country);
      if (!countries.length) result["未记录"] = (result["未记录"] || 0) + 1;
      countries.forEach((country) => {
        result[country] = (result[country] || 0) + 1;
      });
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
  const danmeiTagMap = completed.reduce<Record<string, number>>(
    (result, entry) => {
      entry.danmeiTags.forEach((tag) => {
        result[tag] = (result[tag] || 0) + 1;
      });
      return result;
    },
    {},
  );
  const danmeiTagCounts: ChartDatum[] = Object.entries(danmeiTagMap)
    .map(([label, count]) => ({ label, count, color: "#7968c5" }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
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
          : webArea === "danmei"
            ? danmeiTagCounts
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
          : webArea === "danmei"
            ? "耽美题材标签"
            : "完成状态分布"
        : chart === "primary"
          ? "类型分布"
          : "国家 / 地区分布";
  const maxCount = Math.max(1, ...activeData.map((item) => item.count));
  const favoriteType = [...typeCounts].sort((a, b) => b.count - a.count)[0];
  const topCountry = countryCounts.find((item) => item.label !== "未记录");
  const topPlatform = platformCounts.find((item) => item.label !== "未记录");
  const topDanmeiTag = danmeiTagCounts[0];
  const topStatus = [...statusCounts].sort((a, b) => b.count - a.count)[0];
  const thoughtCount = scopedEntries.reduce(
    (sum, entry) => sum + entry.notes.filter(noteHasThought).length,
    0,
  );

  function changeScope(nextScope: "media" | "web") {
    setScope(nextScope);
    setChart("primary");
  }

  function changeWebArea(nextArea: "danmei" | "other") {
    setWebArea(nextArea);
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
        {scope === "web" && (
          <div className="web-insight-tabs" aria-label="网络小说统计分区">
            <button
              className={webArea === "danmei" ? "active" : ""}
              onClick={() => changeWebArea("danmei")}
              type="button"
            >
              👬 耽美
            </button>
            <button
              className={webArea === "other" ? "active" : ""}
              onClick={() => changeWebArea("other")}
              type="button"
            >
              其他网文
            </button>
          </div>
        )}
      </div>

      <div className="insight-summary">
        <div>
          <span>
            {scope === "web"
              ? webArea === "danmei"
                ? "耽美小说"
                : "其他网文"
              : "书影音记录"}
          </span>
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
              {scope === "web"
                ? webArea === "danmei"
                  ? "题材标签"
                  : "完成状态"
                : "国家 / 地区"}
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

        {scopedEntries.length && scope === "media" && chart === "secondary" ? (
          <WorldHeatMap counts={countryMap} />
        ) : scopedEntries.length ? (
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
            {scope === "web" ? "最常用的平台" : "最常看的类型"}
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
                ? `共 ${topPlatform.count} 部来自这个平台。`
                : "填写阅读平台后自动汇总。"
              : favoriteType?.count
                ? `共 ${favoriteType.count} 部，占当前记录最多。`
                : "添加记录后自动计算。"}
          </p>
        </article>
        <article>
          <span>
            {scope === "web"
              ? webArea === "danmei"
                ? "最常见的耽美题材"
                : "最常见的阅读状态"
              : "记录最多的国家 / 地区"}
          </span>
          <strong>
            {scope === "web"
              ? webArea === "danmei"
                ? topDanmeiTag?.label || "暂无"
                : topStatus?.count
                  ? topStatus.label
                  : "暂无"
              : topCountry?.label || "暂无"}
          </strong>
          <p>
            {scope === "web"
              ? webArea === "danmei"
                ? topDanmeiTag
                  ? `在已完成作品中出现 ${topDanmeiTag.count} 次。`
                  : "小说完成时填写题材标签后自动统计。"
                : topStatus?.count
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
  const [theme, setTheme] = useState<"light" | "dark">("dark");
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
  const [formImages, setFormImages] = useState<NoteImage[]>([]);
  const [formThoughtImages, setFormThoughtImages] = useState<NoteImage[]>([]);
  const [saving, setSaving] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [recordForm, setRecordForm] = useState<ViewingRecordForm | null>(null);
  const [entryDeleteConfirmOpen, setEntryDeleteConfirmOpen] = useState(false);
  const [activeThoughtId, setActiveThoughtId] = useState<string | null>(null);
  const [thoughtEditForm, setThoughtEditForm] = useState<ThoughtEditForm | null>(
    null,
  );
  const [zoomedImage, setZoomedImage] = useState<NoteImage | null>(null);
  const [thoughtsExpanded, setThoughtsExpanded] = useState(false);
  const [movieLookupQuery, setMovieLookupQuery] = useState("");
  const [movieLookupResults, setMovieLookupResults] = useState<
    DoubanLookupResult[]
  >([]);
  const [movieLookupMessage, setMovieLookupMessage] = useState("");
  const [movieLookupLoading, setMovieLookupLoading] = useState(false);
  const [showHiddenEntries, setShowHiddenEntries] = useState(false);
  const [hiddenWebFilters, setHiddenWebFilters] = useState<HiddenWebFilter[]>(
    defaultHiddenWebFilters,
  );
  const [userProfile, setUserProfile] = useState<LocalUserProfile>(
    defaultUserProfile,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsHiddenDraft, setSettingsHiddenDraft] = useState<
    HiddenWebFilter[]
  >(defaultHiddenWebFilters);
  const [settingsShowHiddenDraft, setSettingsShowHiddenDraft] = useState(false);
  const [settingsProfileDraft, setSettingsProfileDraft] =
    useState<LocalUserProfile>(defaultUserProfile);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncMode, setSyncMode] = useState<"lan" | "airdrop">("lan");
  const [lanStatus, setLanStatus] = useState<LanSyncStatus | null>(null);
  const [lanPairingCode, setLanPairingCode] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const syncFileInput = useRef<HTMLInputElement>(null);
  const lastLanRevision = useRef(0);

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

  function localDeviceId() {
    const saved = window.localStorage.getItem(DEVICE_ID_KEY);
    if (saved) return saved;
    const id = createLocalId();
    window.localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  }

  async function createLocalArchive(): Promise<LocalArchive> {
    return {
      format: ARCHIVE_FORMAT,
      version: ARCHIVE_VERSION,
      exportedAt: new Date().toISOString(),
      deviceId: localDeviceId(),
      entries,
      deletedEntries: await listLocalDeletedEntries(),
      preferences: {
        theme,
        hiddenWebFilters,
        showHiddenEntries,
        userProfile,
      },
    };
  }

  async function applyLocalArchive(archive: LocalArchive) {
    await replaceLocalArchive(archive.entries, archive.deletedEntries);
    const allowedFilters = new Set<HiddenWebFilter>([
      "all",
      "bg",
      "danmei",
      "gen",
      "other",
    ]);
    const nextFilters = archive.preferences.hiddenWebFilters.filter(
      (item): item is HiddenWebFilter => allowedFilters.has(item as HiddenWebFilter),
    );
    const nextProfile = {
      name: archive.preferences.userProfile.name?.trim() || defaultUserProfile.name,
      avatar: archive.preferences.userProfile.avatar || defaultUserProfile.avatar,
    };
    setTheme(archive.preferences.theme);
    document.documentElement.dataset.theme = archive.preferences.theme;
    setHiddenWebFilters(nextFilters);
    setShowHiddenEntries(Boolean(archive.preferences.showHiddenEntries));
    setUserProfile(nextProfile);
    window.localStorage.setItem("liuhen-theme", archive.preferences.theme);
    window.localStorage.setItem(HIDDEN_WEB_FILTERS_KEY, JSON.stringify(nextFilters));
    window.localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(nextProfile));
    setSelected(null);
    await loadEntries();
  }

  async function fetchLanStatus() {
    const response = await fetch("/__pma/sync/status", { cache: "no-store" });
    if (!response.ok) throw new Error("当前页面没有连接到电脑端同步服务。");
    return (await response.json()) as LanSyncStatus;
  }

  async function performLanSync(
    code = lanPairingCode,
    statusOverride?: LanSyncStatus,
  ) {
    const status = statusOverride || lanStatus;
    if (!status) throw new Error("请先连接电脑端同步服务。");
    if (!status.isHost && !/^\d{6}$/.test(code.trim())) {
      throw new Error("请输入电脑上显示的六位配对码。");
    }

    const response = await fetch("/__pma/sync/merge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(status.isHost ? {} : { "X-PMA-Pairing-Code": code.trim() }),
      },
      body: JSON.stringify({ archive: await createLocalArchive() }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "局域网同步失败。");
    const archive = parseArchive(result.archive);
    await applyLocalArchive(archive);
    lastLanRevision.current = Number(result.revision) || 0;
    setLanStatus((current) =>
      current
        ? {
            ...current,
            revision: lastLanRevision.current,
            updatedAt: result.updatedAt || new Date().toISOString(),
            entryCount: archive.entries.length,
          }
        : current,
    );
    if (!status.isHost) {
      window.sessionStorage.setItem(LAN_PAIRING_CODE_KEY, code.trim());
    }
    setSyncMessage(
      status.isHost
        ? "电脑主数据库已准备好，手机现在可以连接并同步。"
        : `同步完成：手机和电脑现在共有 ${archive.entries.length} 条记录。`,
    );
  }

  async function openSyncCenter() {
    setSyncOpen(true);
    setSyncMessage("");
    if (window.location.hostname.endsWith(".github.io")) {
      setSyncMode("airdrop");
      setLanStatus(null);
      setSyncBusy(false);
      return;
    }
    setSyncMode("lan");
    setLanPairingCode(
      window.sessionStorage.getItem(LAN_PAIRING_CODE_KEY) || "",
    );
    setSyncBusy(true);
    try {
      const status = await fetchLanStatus();
      setLanStatus(status);
      lastLanRevision.current = status.revision;
      if (status.isHost) await performLanSync("", status);
    } catch (syncError) {
      setLanStatus(null);
      setSyncMessage(
        syncError instanceof Error
          ? syncError.message
          : "当前页面没有连接到电脑端同步服务。",
      );
    } finally {
      setSyncBusy(false);
    }
  }

  async function syncFromLan() {
    setSyncBusy(true);
    setSyncMessage("");
    try {
      await performLanSync();
    } catch (syncError) {
      setSyncMessage(
        syncError instanceof Error ? syncError.message : "局域网同步失败。",
      );
    } finally {
      setSyncBusy(false);
    }
  }

  async function exportSyncPackage() {
    setSyncBusy(true);
    setSyncMessage("");
    try {
      const archive = await createLocalArchive();
      const date = new Date().toISOString().slice(0, 10);
      const file = new File([JSON.stringify(archive)], `PMA-${date}.pma`, {
        type: "application/json",
      });
      let canShareFile = false;
      try {
        canShareFile = Boolean(
          typeof navigator.share === "function" &&
            navigator.canShare?.({ files: [file] }),
        );
      } catch {
        canShareFile = false;
      }

      if (canShareFile) {
        try {
          await navigator.share({
            files: [file],
            title: "Private Media Archive 同步包",
          });
          setSyncMessage("同步包已经交给系统分享菜单。");
          return;
        } catch (shareError) {
          if (
            shareError instanceof DOMException &&
            shareError.name === "AbortError"
          ) {
            setSyncMessage("已取消分享。");
            return;
          }
        }
      }

      {
        const url = URL.createObjectURL(file);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setSyncMessage("同步包已下载，可以通过 AirDrop 发送到另一台设备。");
      }
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") {
        setSyncMessage("已取消分享。");
      } else {
        setSyncMessage("同步包没有导出成功，请重试。");
      }
    } finally {
      setSyncBusy(false);
    }
  }

  async function importSyncPackage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setSyncBusy(true);
    setSyncMessage("");
    try {
      const incoming = parseArchive(JSON.parse(await file.text()));
      const merged = mergeArchives(await createLocalArchive(), incoming);
      await applyLocalArchive(merged);
      setSyncMessage(`导入完成：当前设备共有 ${merged.entries.length} 条记录。`);
    } catch (importError) {
      setSyncMessage(
        importError instanceof Error ? importError.message : "同步包导入失败。",
      );
    } finally {
      setSyncBusy(false);
    }
  }

  useEffect(() => {
    void loadEntries();
  }, []);

  useEffect(() => {
    if (!["127.0.0.1", "localhost"].includes(window.location.hostname)) return;
    const localSession = new EventSource("/__pma/session");
    return () => localSession.close();
  }, []);

  useEffect(() => {
    if (!lanStatus?.isHost) return;
    let checking = false;
    const interval = window.setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const status = await fetchLanStatus();
        setLanStatus(status);
        if (status.revision > lastLanRevision.current) {
          const response = await fetch("/__pma/sync/pull", { cache: "no-store" });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "同步数据读取失败。");
          const archive = parseArchive(result.archive);
          await applyLocalArchive(archive);
          lastLanRevision.current = Number(result.revision) || status.revision;
          setSyncMessage(
            `已收到手机的新数据，电脑主数据库现在有 ${archive.entries.length} 条记录。`,
          );
        }
      } catch {
        // 下一轮继续检查，避免短暂断网打断本地使用。
      } finally {
        checking = false;
      }
    }, 2500);
    return () => window.clearInterval(interval);
  }, [lanStatus?.isHost]);

  useEffect(() => {
    const saved = window.localStorage.getItem("liuhen-theme");
    const preferred =
      saved === "light" || saved === "dark"
        ? saved
        : "dark";
    setTheme(preferred);
    document.documentElement.dataset.theme = preferred;

    try {
      const savedFilters = JSON.parse(
        window.localStorage.getItem(HIDDEN_WEB_FILTERS_KEY) || "null",
      ) as HiddenWebFilter[] | null;
      if (Array.isArray(savedFilters)) setHiddenWebFilters(savedFilters);
    } catch {
      setHiddenWebFilters(defaultHiddenWebFilters);
    }

    try {
      const savedProfile = JSON.parse(
        window.localStorage.getItem(USER_PROFILE_KEY) || "null",
      ) as Partial<LocalUserProfile> | null;
      if (savedProfile?.name || savedProfile?.avatar) {
        setUserProfile({
          name: savedProfile.name?.trim() || defaultUserProfile.name,
          avatar: savedProfile.avatar || defaultUserProfile.avatar,
        });
      }
    } catch {
      setUserProfile(defaultUserProfile);
    }
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("liuhen-theme", next);
  }

  function openSettings() {
    setSettingsHiddenDraft(hiddenWebFilters);
    setSettingsShowHiddenDraft(showHiddenEntries);
    setSettingsProfileDraft(userProfile);
    setSettingsOpen(true);
  }

  function toggleHiddenFilter(filter: HiddenWebFilter) {
    setSettingsHiddenDraft((current) => {
      if (filter === "all") return current.includes("all") ? [] : ["all"];
      const withoutAll = current.filter((item) => item !== "all");
      return withoutAll.includes(filter)
        ? withoutAll.filter((item) => item !== filter)
        : [...withoutAll, filter];
    });
  }

  function uploadUserAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("请选择图片文件作为头像。");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("头像图片请控制在 2MB 以内。");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setSettingsProfileDraft((current) => ({
        ...current,
        avatar:
          typeof reader.result === "string"
            ? reader.result
            : defaultUserProfile.avatar,
      }));
      setError("");
    };
    reader.onerror = () => setError("头像没有读取成功，请换一张再试。");
    reader.readAsDataURL(file);
  }

  function saveSettings(event: FormEvent) {
    event.preventDefault();
    const nextProfile = {
      name: settingsProfileDraft.name.trim() || defaultUserProfile.name,
      avatar: settingsProfileDraft.avatar || defaultUserProfile.avatar,
    };
    setHiddenWebFilters(settingsHiddenDraft);
    setUserProfile(nextProfile);
    setShowHiddenEntries(settingsShowHiddenDraft);
    window.localStorage.setItem(
      HIDDEN_WEB_FILTERS_KEY,
      JSON.stringify(settingsHiddenDraft),
    );
    window.localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(nextProfile));
    setSettingsOpen(false);
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
      const matchesHiddenPreference =
        showHiddenEntries || !entryMatchesHiddenFilter(entry, hiddenWebFilters);
      return (
        matchesSearch &&
        matchesStatus &&
        matchesType &&
        matchesHiddenPreference
      );
    });
  }, [
    entries,
    hiddenWebFilters,
    search,
    showHiddenEntries,
    statusFilter,
    typeFilter,
  ]);

  const settingsHiddenEntryCount = useMemo(
    () =>
      entries.filter((entry) =>
        entryMatchesHiddenFilter(entry, settingsHiddenDraft),
      ).length,
    [entries, settingsHiddenDraft],
  );

  const summaryEntries = useMemo(
    () =>
      showHiddenEntries
        ? entries
        : entries.filter(
            (entry) => !entryMatchesHiddenFilter(entry, hiddenWebFilters),
          ),
    [entries, hiddenWebFilters, showHiddenEntries],
  );

  const stats = useMemo(
    () => ({
      active: summaryEntries.filter((entry) => entry.status === "in_progress")
        .length,
      completed: summaryEntries.filter((entry) => entry.status === "completed")
        .length,
      notes: summaryEntries.reduce(
        (sum, entry) =>
          sum + entry.notes.filter(noteHasThought).length,
        0,
      ),
    }),
    [summaryEntries],
  );

  const totalUnits = numberFromForm(form.totalUnits);
  const currentUnits = Math.min(
    totalUnits || Number.POSITIVE_INFINITY,
    numberFromForm(form.currentUnits),
  );
  const computedProgress =
    form.mediaType === "book" && form.progressMode === "percent"
      ? Math.min(100, oneDecimalFromForm(form.manualProgressPercent))
      : calculateProgress(form.movieMode, totalUnits, currentUnits);
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
      ? selected.mediaType === "book" && recordForm.progressMode === "percent"
        ? Math.min(100, oneDecimalFromForm(recordForm.manualProgressPercent))
        : calculateProgress(
            selected.movieMode,
            selected.totalUnits,
            recordCurrentUnits,
          )
      : 0;
  const recordStatus =
    recordForm &&
    deriveStatus(recordProgress, recordForm.status === "abandoned");
  const activeThought =
    selected?.notes.find((note) => note.id === activeThoughtId) || null;
  const thoughtEditCurrentUnits =
    selected && thoughtEditForm
      ? Math.min(
          selected.totalUnits || Number.POSITIVE_INFINITY,
          numberFromForm(thoughtEditForm.currentUnits),
        )
      : 0;
  const thoughtEditProgress =
    selected && thoughtEditForm
      ? selected.mediaType === "book" &&
        thoughtEditForm.progressMode === "percent"
        ? Math.min(
            100,
            oneDecimalFromForm(thoughtEditForm.manualProgressPercent),
          )
        : calculateProgress(
            selected.movieMode,
            selected.totalUnits,
            thoughtEditCurrentUnits,
          )
      : 0;

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setFormImages([]);
    setFormThoughtImages([]);
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
    setActiveThoughtId(null);
    setThoughtEditForm(null);
    setZoomedImage(null);
    setThoughtsExpanded(false);
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
      progressMode: entry.progressMode || "units",
      totalUnits: entry.totalUnits ? String(entry.totalUnits) : "",
      currentUnits: entry.currentUnits ? String(entry.currentUnits) : "",
      manualProgressPercent:
        entry.progressMode === "percent" ? String(entry.progressPercent) : "",
      volume: entry.volume ? String(entry.volume) : "",
      webFictionType: entry.webFictionType || "",
      danmeiTags: entry.danmeiTags.join("、"),
      platform: entry.platform,
      country: entry.country,
      cast: entry.cast || "",
      year: entry.year || "",
      doubanUrl: entry.doubanUrl || "",
      coverUrl: entry.coverUrl || "",
      lastSeenAt: entry.lastSeenAt.slice(0, 10),
      rating: entry.rating || 0,
      thought: "",
      thoughtQuote: "",
      thoughtMinute: "",
    });
    setFormImages([]);
    setFormThoughtImages([]);
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
      progressMode: "units",
      status: "in_progress",
      totalUnits: "",
      currentUnits: "",
      manualProgressPercent: "",
      volume: "",
      webFictionType: "",
      danmeiTags: "",
      rating: 0,
      thoughtQuote: "",
      thoughtMinute: "",
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
      const progressPercent =
        form.mediaType === "book" && form.progressMode === "percent"
          ? Math.min(100, oneDecimalFromForm(form.manualProgressPercent))
          : calculateProgress(form.movieMode, totalUnits, currentUnits);
      const status = deriveStatus(
        progressPercent,
        form.status === "abandoned",
      );
      const storedCurrentUnits =
        form.progressMode === "percent"
          ? 0
          : progressPercent === 100 && totalUnits
            ? totalUnits
            : currentUnits;
      const volume = numberFromForm(form.volume);
      const progressText = makeProgressText(
        form.mediaType,
        form.movieMode,
        form.progressUnit,
        totalUnits,
        storedCurrentUnits,
        form.progressMode,
        progressPercent,
        volume,
      );
      const thought = form.thought.trim();
      const notes: Note[] = editing ? [...editing.notes] : [];
      if (!editing) {
        notes.unshift({
          id: createLocalId(),
          content: thought,
          quoteText: form.thoughtQuote.trim(),
          quoteMinute: numberFromForm(form.thoughtMinute),
          images: formImages,
          thoughtImages: formThoughtImages,
          progressText,
          currentUnits: storedCurrentUnits,
          progressPercent,
          volume,
          status,
          watchedAt: form.lastSeenAt,
          createdAt: now,
        });
      }
      const entry: Entry = {
        id: editing?.id ?? createLocalId(),
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
        progressMode: form.mediaType === "book" ? form.progressMode : "units",
        totalUnits,
        currentUnits: storedCurrentUnits,
        volume: form.mediaType === "book" ? volume : 0,
        webFictionType:
          form.bookCategory === "web_fiction" ? form.webFictionType : "",
        danmeiTags:
          status === "completed" &&
          form.bookCategory === "web_fiction" &&
          form.webFictionType === "danmei"
            ? parseTags(form.danmeiTags)
            : [],
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
      setFormImages([]);
      setFormThoughtImages([]);
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
        recordForm.progressMode === "percent"
          ? 0
          : recordProgress === 100 && selected.totalUnits
            ? selected.totalUnits
            : recordCurrentUnits;
      const volume = numberFromForm(recordForm.volume);
      const progressText = makeProgressText(
        selected.mediaType,
        selected.movieMode,
        selected.progressUnit,
        selected.totalUnits,
        storedCurrentUnits,
        recordForm.progressMode,
        recordProgress,
        volume,
      );
      const note: Note = {
        id: createLocalId(),
        content: recordForm.thought.trim(),
        quoteText: recordForm.quoteText.trim(),
        quoteMinute: numberFromForm(recordForm.quoteMinute),
        images: recordForm.images,
        thoughtImages: recordForm.thoughtImages,
        progressText,
        currentUnits: storedCurrentUnits,
        progressPercent: recordProgress,
        volume,
        status: recordStatus,
        watchedAt: recordForm.watchedAt,
        createdAt: now,
      };
      const updated: Entry = {
        ...selected,
        status: recordStatus,
        progressText,
        progressPercent: recordProgress,
        progressMode: recordForm.progressMode,
        currentUnits: storedCurrentUnits,
        volume,
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
        danmeiTags:
          recordStatus === "completed" &&
          selected.bookCategory === "web_fiction" &&
          selected.webFictionType === "danmei"
            ? parseTags(recordForm.danmeiTags)
            : selected.danmeiTags,
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
      setEntryDeleteConfirmOpen(false);
      setSelected(null);
      setError("");
    } catch {
      setError("删除失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  async function deleteThought(noteId: string) {
    if (!selected) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const updated: Entry = {
        ...selected,
        updatedAt: now,
        notes: selected.notes.map((note) =>
          note.id === noteId
            ? {
                ...note,
                content: "",
                quoteText: "",
                quoteMinute: 0,
                images: [],
                thoughtImages: [],
              }
            : note,
        ),
      };
      await saveLocalEntry(updated);
      setEntries((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
      setSelected(updated);
      setActiveThoughtId(null);
      setThoughtEditForm(null);
      setError("");
    } catch {
      setError("这条感想没有删除成功，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  function startEditingThought(note: Note) {
    const progressMode: ProgressMode =
      selected?.mediaType === "book" &&
      (note.progressText.includes("%") ||
        (note.currentUnits === 0 &&
          note.progressPercent > 0 &&
          selected.progressMode === "percent"))
        ? "percent"
        : "units";
    setThoughtEditForm({
      currentUnits: note.currentUnits ? String(note.currentUnits) : "",
      manualProgressPercent:
        progressMode === "percent" ? String(note.progressPercent) : "",
      progressMode,
      volume: note.volume ? String(note.volume) : "",
      content: note.content,
      quoteText: note.quoteText,
      quoteMinute: note.quoteMinute ? String(note.quoteMinute) : "",
      images: note.images,
      thoughtImages: note.thoughtImages,
    });
  }

  async function saveThoughtEdit(event: FormEvent) {
    event.preventDefault();
    if (!selected || !activeThought || !thoughtEditForm) return;
    setSaving(true);
    try {
      const progressMode =
        selected.mediaType === "book"
          ? thoughtEditForm.progressMode
          : "units";
      const storedCurrentUnits =
        progressMode === "percent"
          ? 0
          : thoughtEditProgress === 100 && selected.totalUnits
            ? selected.totalUnits
            : thoughtEditCurrentUnits;
      const volume =
        selected.mediaType === "book"
          ? numberFromForm(thoughtEditForm.volume)
          : 0;
      const status = deriveStatus(
        thoughtEditProgress,
        activeThought.status === "abandoned",
      );
      const progressText = makeProgressText(
        selected.mediaType,
        selected.movieMode,
        selected.progressUnit,
        selected.totalUnits,
        storedCurrentUnits,
        progressMode,
        thoughtEditProgress,
        volume,
      );
      const editsLatestProgress = selected.notes[0]?.id === activeThought.id;
      const updated: Entry = {
        ...selected,
        ...(editsLatestProgress
          ? {
              status,
              progressText,
              progressPercent: thoughtEditProgress,
              progressMode,
              currentUnits: storedCurrentUnits,
              volume,
              lastSeenAt: activeThought.watchedAt,
              completedAt:
                status === "completed"
                  ? selected.completedAt || activeThought.watchedAt
                  : "",
              rating: status === "completed" ? selected.rating : null,
            }
          : {}),
        updatedAt: new Date().toISOString(),
        notes: selected.notes.map((note) =>
          note.id === activeThought.id
            ? {
                ...note,
                progressText,
                currentUnits: storedCurrentUnits,
                progressPercent: thoughtEditProgress,
                volume,
                status,
                content: thoughtEditForm.content.trim(),
                quoteText: thoughtEditForm.quoteText.trim(),
                quoteMinute: numberFromForm(thoughtEditForm.quoteMinute),
                images: thoughtEditForm.images,
                thoughtImages: thoughtEditForm.thoughtImages,
              }
            : note,
        ),
      };
      await saveLocalEntry(updated);
      setEntries((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
      setSelected(updated);
      setThoughtEditForm(null);
      setError("");
    } catch {
      setError("这条感想没有保存成功，请稍后重试。");
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
          <div>
            <span>本地数据</span>
            <button
              aria-label="打开数据同步"
              onClick={() => void openSyncCenter()}
              title="同步与数据包"
              type="button"
            >
              🔄
            </button>
          </div>
          <p>可通过同一 Wi‑Fi 或 AirDrop 在设备间同步。</p>
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
            <button
              aria-label={theme === "light" ? "切换到深色模式" : "切换到浅色模式"}
              className="theme-toggle"
              onClick={toggleTheme}
              title={theme === "light" ? "深色模式" : "浅色模式"}
              type="button"
            >
              <span aria-hidden="true">{theme === "light" ? "🌙" : "☀️"}</span>
            </button>
            <button className="toolbar-button" onClick={openSettings} type="button">
              设置
            </button>
            <button className="primary-button" onClick={openCreate} type="button">
              <span>＋</span> 新增观看
            </button>
            <button
              aria-label={`当前用户 ${userProfile.name}，打开设置`}
              className="user-profile-button"
              onClick={openSettings}
              type="button"
            >
              <img alt="" src={userProfile.avatar} />
              <span>{userProfile.name}</span>
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

      {syncOpen && (
        <div className="modal-backdrop sync-backdrop" role="presentation">
          <div
            aria-label="数据同步"
            aria-modal="true"
            className="sync-modal"
            role="dialog"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">LOCAL SYNC</span>
                <h2>数据同步</h2>
                <p>电脑作为主数据库，合并后两台设备都会获得最新版。</p>
              </div>
              <button
                aria-label="关闭数据同步"
                className="close-button"
                onClick={() => setSyncOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>

            <div className="sync-mode-tabs" aria-label="同步方式">
              <button
                className={syncMode === "lan" ? "active" : ""}
                onClick={() => setSyncMode("lan")}
                type="button"
              >
                <span>⌁</span>
                <div>
                  <strong>同一 Wi‑Fi</strong>
                  <small>手机与电脑直接合并</small>
                </div>
              </button>
              <button
                className={syncMode === "airdrop" ? "active" : ""}
                onClick={() => setSyncMode("airdrop")}
                type="button"
              >
                <span>↗</span>
                <div>
                  <strong>AirDrop 数据包</strong>
                  <small>导出或导入完整记录</small>
                </div>
              </button>
            </div>

            {syncMode === "lan" ? (
              <section className="sync-panel">
                {lanStatus?.isHost ? (
                  <>
                    <div className="sync-host-status">
                      <span className="sync-ready-dot" />
                      <div>
                        <strong>电脑主数据库已开启</strong>
                        <small>保持本地应用和这个页面开启，等待手机连接。</small>
                      </div>
                    </div>
                    <div className="sync-address-card">
                      <span>手机访问地址</span>
                      {lanStatus.urls.map((url, index) => (
                        <code key={url}>
                          {url}
                          {index === 0 && <small>推荐</small>}
                        </code>
                      ))}
                      <p>优先使用带 .local 的地址；打不开时再尝试数字 IP 地址。</p>
                    </div>
                    <div className="pairing-code-card">
                      <div>
                        <span>本次配对码</span>
                        <strong>{lanStatus.pairingCode}</strong>
                      </div>
                      <small>每次重新启动电脑端都会更换。</small>
                    </div>
                    <button
                      className="secondary-button sync-wide-button"
                      disabled={syncBusy}
                      onClick={() => void syncFromLan()}
                      type="button"
                    >
                      {syncBusy ? "正在准备…" : "更新电脑同步副本"}
                    </button>
                  </>
                ) : lanStatus ? (
                  <>
                    <div className="sync-host-status">
                      <span className="sync-ready-dot" />
                      <div>
                        <strong>已找到电脑端</strong>
                        <small>输入电脑屏幕上的配对码，再同步手机中的新记录。</small>
                      </div>
                    </div>
                    <label className="pairing-input-field">
                      <span>六位配对码</span>
                      <input
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        maxLength={6}
                        onChange={(event) =>
                          setLanPairingCode(event.target.value.replace(/\D/g, ""))
                        }
                        placeholder="000000"
                        value={lanPairingCode}
                      />
                    </label>
                    <button
                      className="primary-button sync-wide-button"
                      disabled={syncBusy}
                      onClick={() => void syncFromLan()}
                      type="button"
                    >
                      {syncBusy ? "正在合并…" : "同步到电脑并取回最新版"}
                    </button>
                  </>
                ) : (
                  <div className="sync-unavailable">
                    <strong>这里没有检测到电脑端同步服务</strong>
                    <p>
                      请先在电脑上打开本地 App，再让手机使用电脑同步窗口显示的地址访问。
                    </p>
                  </div>
                )}
                <div className="sync-steps">
                  <span>1&nbsp; 手机上传新数据</span>
                  <i>→</i>
                  <span>2&nbsp; 电脑合并主库</span>
                  <i>→</i>
                  <span>3&nbsp; 手机取回最新版</span>
                </div>
              </section>
            ) : (
              <section className="sync-panel airdrop-panel">
                <div className="airdrop-option">
                  <span aria-hidden="true">↗</span>
                  <div>
                    <strong>导出同步包</strong>
                    <p>生成包含条目、感想、图片和设置的文件，再选择 AirDrop。</p>
                  </div>
                  <button
                    className="secondary-button"
                    disabled={syncBusy}
                    onClick={() => void exportSyncPackage()}
                    type="button"
                  >
                    导出 / AirDrop
                  </button>
                </div>
                <div className="airdrop-option">
                  <span aria-hidden="true">↓</span>
                  <div>
                    <strong>导入同步包</strong>
                    <p>选择另一台设备传来的 .pma 文件，自动与本机数据合并。</p>
                  </div>
                  <button
                    className="secondary-button"
                    disabled={syncBusy}
                    onClick={() => syncFileInput.current?.click()}
                    type="button"
                  >
                    选择文件
                  </button>
                  <input
                    aria-label="选择 PMA 同步包"
                    hidden
                    onChange={(event) => void importSyncPackage(event)}
                    ref={syncFileInput}
                    type="file"
                  />
                </div>
                <p className="airdrop-note">
                  导入采用合并方式，不会直接清空本机数据；删除记录也会随同步包传递。
                </p>
              </section>
            )}

            {syncMessage && (
              <div className="sync-message" role="status">
                {syncMessage}
              </div>
            )}
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-backdrop settings-backdrop" role="presentation">
          <div
            aria-label="设置"
            aria-modal="true"
            className="settings-modal"
            role="dialog"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">SETTINGS</span>
                <h2>设置</h2>
              </div>
              <button
                aria-label="关闭设置"
                className="close-button"
                onClick={() => setSettingsOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <form onSubmit={saveSettings}>
              <section className="settings-section">
                <div>
                  <h3>隐藏书目类别</h3>
                  <p>只影响首页表格，不会删除记录，也不影响统计图。</p>
                </div>
                <div className="hidden-filter-options">
                  <button
                    aria-pressed={settingsHiddenDraft.includes("all")}
                    className={settingsHiddenDraft.includes("all") ? "active" : ""}
                    onClick={() => toggleHiddenFilter("all")}
                    type="button"
                  >
                    <i />
                    全部网络小说
                  </button>
                  {(
                    ["danmei", "bg", "gen", "other"] as Exclude<
                      WebFictionType,
                      ""
                    >[]
                  ).map((filter) => (
                    <button
                      aria-pressed={settingsHiddenDraft.includes(filter)}
                      className={
                        settingsHiddenDraft.includes(filter) ? "active" : ""
                      }
                      key={filter}
                      onClick={() => toggleHiddenFilter(filter)}
                      type="button"
                    >
                      <i />
                      {filter === "danmei" ? "👬 " : ""}
                      {webFictionTypeMeta[filter]}
                    </button>
                  ))}
                </div>
                <small>
                  当前将隐藏：
                  {settingsHiddenDraft.includes("all")
                    ? "全部网络小说"
                    : settingsHiddenDraft.length
                      ? settingsHiddenDraft
                          .map((filter) =>
                            filter === "all"
                              ? "全部网络小说"
                              : webFictionTypeMeta[filter],
                          )
                          .join("、")
                      : "无"}
                </small>
                <button
                  aria-pressed={settingsShowHiddenDraft}
                  className={
                    settingsShowHiddenDraft
                      ? "hidden-visibility-toggle active"
                      : "hidden-visibility-toggle"
                  }
                  disabled={!settingsHiddenEntryCount}
                  onClick={() =>
                    setSettingsShowHiddenDraft((current) => !current)
                  }
                  type="button"
                >
                  <span aria-hidden="true">{settingsShowHiddenDraft ? "◉" : "○"}</span>
                  <div>
                    <strong>
                      {settingsShowHiddenDraft
                        ? "首页正在显示隐藏书目"
                        : "显示隐藏书目"}
                    </strong>
                    <small>
                      {settingsHiddenEntryCount
                        ? `当前有 ${settingsHiddenEntryCount} 条隐藏记录`
                        : "当前没有隐藏记录"}
                    </small>
                  </div>
                </button>
              </section>

              <section className="settings-section profile-settings-section">
                <div>
                  <h3>用户</h3>
                  <p>头像和用户名会显示在页面右上角。</p>
                </div>
                <div className="profile-settings-row">
                  <div className="profile-avatar-editor">
                    <img alt="当前用户头像" src={settingsProfileDraft.avatar} />
                    <div>
                      <label>
                        更换头像
                        <input
                          accept="image/*"
                          onChange={uploadUserAvatar}
                          type="file"
                        />
                      </label>
                      <button
                        onClick={() =>
                          setSettingsProfileDraft((current) => ({
                            ...current,
                            avatar: defaultUserProfile.avatar,
                          }))
                        }
                        type="button"
                      >
                        恢复默认
                      </button>
                    </div>
                  </div>
                  <label className="field settings-name-field">
                    <span>用户名</span>
                    <input
                      maxLength={32}
                      onChange={(event) =>
                        setSettingsProfileDraft({
                          ...settingsProfileDraft,
                          name: event.target.value,
                        })
                      }
                      placeholder="Nicosakiri"
                      type="text"
                      value={settingsProfileDraft.name}
                    />
                  </label>
                </div>
              </section>

              <div className="modal-actions">
                <button
                  className="secondary-button"
                  onClick={() => setSettingsOpen(false)}
                  type="button"
                >
                  取消
                </button>
                <button className="primary-button" type="submit">
                  保存设置
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
                      {(["literary", "social_science", "textbook"] as BookCategory[]).map(
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
                      {(["web_fiction", "light_novel", "manga"] as BookCategory[]).map(
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

              {form.mediaType === "book" &&
                form.bookCategory === "web_fiction" && (
                  <div className="series-category-field web-fiction-type-field">
                    <span>网络文学类型</span>
                    <div>
                      {(Object.keys(webFictionTypeMeta) as Exclude<WebFictionType, "">[]).map(
                        (webType) => (
                          <button
                            className={form.webFictionType === webType ? "active" : ""}
                            key={webType}
                            onClick={() => setForm({ ...form, webFictionType: webType })}
                            type="button"
                          >
                            {webType === "danmei" ? "👬 " : ""}
                            {webFictionTypeMeta[webType]}
                          </button>
                        ),
                      )}
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
                    {form.mediaType === "book" && form.bookCategory === "textbook"
                      ? "学科"
                      : isCinema
                        ? "影院名称（可选）"
                        : "观看平台 / 版本"}
                  </span>
                  <input
                    onChange={(event) =>
                      setForm({ ...form, platform: event.target.value })
                    }
                    placeholder={
                      form.mediaType === "book" && form.bookCategory === "textbook"
                        ? "例如：经济学、数学、语言学"
                        : isCinema
                          ? "例如：百丽宫影城"
                          : "微信读书、Netflix…"
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
                      <span>{form.progressMode === "percent" ? "直接填写进度" : "自动计算进度"}</span>
                      <small>
                        {editing
                          ? "总量可以修正；当前位置请通过“添加记录”更新。"
                          : form.progressMode === "percent"
                            ? "适合无法确认页数的电子书或网盘资源。"
                            : "填写总量和当前位置后，系统自动换算百分比。"}
                      </small>
                    </div>
                    <strong>{computedProgress}%</strong>
                  </div>
                  {form.mediaType === "book" && (
                    <div className="progress-mode-switch" aria-label="书籍进度填写方式">
                      <button
                        className={form.progressMode === "units" ? "active" : ""}
                        onClick={() => setForm({ ...form, progressMode: "units" })}
                        type="button"
                      >
                        按页数
                      </button>
                      <button
                        className={form.progressMode === "percent" ? "active" : ""}
                        onClick={() => setForm({ ...form, progressMode: "percent" })}
                        type="button"
                      >
                        直接填百分比
                      </button>
                    </div>
                  )}
                  {form.mediaType === "book" && form.progressMode === "percent" ? (
                    <div className="field-row">
                      <label className="field">
                        <span>当前进度（%）</span>
                        <input
                          disabled={Boolean(editing)}
                          max="100"
                          min="0"
                          onChange={(event) => setForm({ ...form, manualProgressPercent: event.target.value })}
                          placeholder="0–100"
                          step="0.1"
                          type="number"
                          value={form.manualProgressPercent}
                        />
                      </label>
                      {form.bookCategory === "light_novel" && (
                        <label className="field">
                          <span>看到第几卷</span>
                          <input
                            disabled={Boolean(editing)}
                            min="0"
                            onChange={(event) => setForm({ ...form, volume: event.target.value })}
                            placeholder="例如：3"
                            step="1"
                            type="number"
                            value={form.volume}
                          />
                        </label>
                      )}
                    </div>
                  ) : (
                    <>
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
                  {form.mediaType === "book" && form.bookCategory === "light_novel" && (
                    <label className="field">
                      <span>看到第几卷</span>
                      <input
                        disabled={Boolean(editing)}
                        min="0"
                        onChange={(event) => setForm({ ...form, volume: event.target.value })}
                        placeholder="例如：3"
                        step="1"
                        type="number"
                        value={form.volume}
                      />
                    </label>
                  )}
                    </>
                  )}
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

              {computedProgress === 100 &&
                automaticStatus !== "abandoned" &&
                form.mediaType === "book" &&
                form.bookCategory === "web_fiction" &&
                form.webFictionType === "danmei" && (
                  <label className="field danmei-tags-field">
                    <span>耽美题材标签</span>
                    <input
                      onChange={(event) =>
                        setForm({ ...form, danmeiTags: event.target.value })
                      }
                      placeholder="例如：现代、ABO、骨科（用顿号分隔）"
                      type="text"
                      value={form.danmeiTags}
                    />
                    <small>随完成评分一起保存，用于耽美统计区。</small>
                  </label>
                )}

              {!editing && (
                <ThoughtComposer
                  images={formImages}
                  mediaType={form.mediaType}
                  onChange={(thought) => setForm({ ...form, thought })}
                  onError={setError}
                  onImagesChange={setFormImages}
                  onQuoteChange={(thoughtQuote) => setForm({ ...form, thoughtQuote })}
                  onQuoteMinuteChange={(thoughtMinute) => setForm({ ...form, thoughtMinute })}
                  onThoughtImagesChange={setFormThoughtImages}
                  placeholder="写下这次的感想（可选）"
                  quoteMinute={form.thoughtMinute}
                  quoteText={form.thoughtQuote}
                  rows={4}
                  thoughtImages={formThoughtImages}
                  value={form.thought}
                />
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
            className={`detail-drawer ${thoughtsExpanded ? "thoughts-expanded" : ""}`}
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
                onClick={() => {
                  setSelected(null);
                  setThoughtsExpanded(false);
                  setActiveThoughtId(null);
                }}
                type="button"
              >
                ×
              </button>
            </div>
            <button
              aria-label={
                selected.coverUrl
                  ? `放大查看《${selected.title}》封面`
                  : undefined
              }
              className={`detail-cover media-${selected.mediaType} ${
                selected.coverUrl ? "has-image" : ""
              }`}
              disabled={!selected.coverUrl}
              onClick={() => {
                if (!selected.coverUrl) return;
                setZoomedImage({
                  id: `cover-${selected.id}`,
                  name: `《${selected.title}》封面`,
                  dataUrl: selected.coverUrl,
                });
              }}
              type="button"
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
            </button>
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
                <dt>
                  {selected.bookCategory === "textbook" ? "学科" : "平台 / 版本"}
                </dt>
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
              {selected.bookCategory === "web_fiction" && selected.webFictionType && (
                <div>
                  <dt>网络文学类型</dt>
                  <dd>
                    {selected.webFictionType === "danmei" ? "👬 " : ""}
                    {webFictionTypeMeta[selected.webFictionType]}
                  </dd>
                </div>
              )}
              {selected.webFictionType === "danmei" &&
                selected.danmeiTags.length > 0 && (
                  <div>
                    <dt>耽美题材</dt>
                    <dd>{selected.danmeiTags.join(" · ")}</dd>
                  </div>
                )}
              {selected.bookCategory === "light_novel" && selected.volume > 0 && (
                <div>
                  <dt>当前卷数</dt>
                  <dd>第 {selected.volume} 卷</dd>
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
              <div className="history-heading-row">
              <div className="history-tabs" role="tablist">
                <button
                  aria-selected={detailTab === "progress"}
                  className={detailTab === "progress" ? "active" : ""}
                  onClick={() => {
                    setDetailTab("progress");
                    setThoughtsExpanded(false);
                  }}
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
                      selected.notes.filter(noteHasThought).length
                    }
                  </span>
                </button>
              </div>
                {detailTab === "thoughts" && (
                  <button
                    aria-label={thoughtsExpanded ? "退出大屏查看" : "大屏查看感想"}
                    className="expand-thoughts-button"
                    onClick={() => setThoughtsExpanded((expanded) => !expanded)}
                    type="button"
                  >
                    {thoughtsExpanded ? "收起" : "大屏"} ⛶
                  </button>
                )}
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
                  selected.notes.filter(noteHasThought).length ? (
                    selected.notes
                      .filter(noteHasThought)
                      .map((note) => (
                        <article className="thought-history-item" key={note.id}>
                          <i className={note.status} />
                          <button
                            className="thought-entry-button"
                            onClick={() => setActiveThoughtId(note.id)}
                            type="button"
                          >
                            <div>
                              <span>{note.progressText || "观看记录"}</span>
                              <time>{formatDate(note.watchedAt)}</time>
                            </div>
                            <ThoughtBody mediaType={selected.mediaType} note={note} preview />
                          </button>
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
              onClick={() => setEntryDeleteConfirmOpen(true)}
              type="button"
            >
              删除这条记录
            </button>
          </aside>
        </div>
      )}

      {selected && activeThought && (
        <div className="modal-backdrop thought-detail-backdrop" role="presentation">
          <article
            aria-label={`《${selected.title}》的感想`}
            aria-modal="true"
            className="thought-detail-modal"
            role="dialog"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">THOUGHT</span>
                <h2>{activeThought.progressText || "感想"}</h2>
                <p>{formatDate(activeThought.watchedAt)}</p>
              </div>
              <button
                aria-label="关闭感想"
                className="close-button"
                onClick={() => {
                  setActiveThoughtId(null);
                  setThoughtEditForm(null);
                }}
                type="button"
              >
                ×
              </button>
            </div>
            {thoughtEditForm ? (
              <form className="thought-edit-form" onSubmit={saveThoughtEdit}>
                {selected.mediaType === "movie" &&
                selected.movieMode === "cinema" ? (
                  <div className="record-cinema-progress thought-progress-editor">
                    <span className="title-status-dot completed" />
                    <div>
                      <strong>影院观看 · 进度 100%</strong>
                      <small>影院记录默认保持完成状态。</small>
                    </div>
                  </div>
                ) : (
                  <section className="automatic-progress thought-progress-editor">
                    <div className="automatic-progress-heading">
                      <div>
                        <span>这条感想的进度</span>
                        <small>
                          {selected.notes[0]?.id === activeThought.id
                            ? "保存后，首页的最新进度也会同步更新。"
                            : "保存后，只修改这条历史进度。"}
                        </small>
                      </div>
                      <strong>{thoughtEditProgress}%</strong>
                    </div>

                    {selected.mediaType === "book" && (
                      <div
                        aria-label="书籍进度填写方式"
                        className="progress-mode-switch"
                      >
                        <button
                          className={
                            thoughtEditForm.progressMode === "units"
                              ? "active"
                              : ""
                          }
                          onClick={() =>
                            setThoughtEditForm({
                              ...thoughtEditForm,
                              progressMode: "units",
                            })
                          }
                          type="button"
                        >
                          按页数
                        </button>
                        <button
                          className={
                            thoughtEditForm.progressMode === "percent"
                              ? "active"
                              : ""
                          }
                          onClick={() =>
                            setThoughtEditForm({
                              ...thoughtEditForm,
                              progressMode: "percent",
                            })
                          }
                          type="button"
                        >
                          直接填百分比
                        </button>
                      </div>
                    )}

                    {selected.mediaType === "book" &&
                    thoughtEditForm.progressMode === "percent" ? (
                      <label className="field">
                        <span>当时进度（%）</span>
                        <input
                          max="100"
                          min="0"
                          onChange={(event) =>
                            setThoughtEditForm({
                              ...thoughtEditForm,
                              manualProgressPercent: event.target.value,
                            })
                          }
                          placeholder="0–100"
                          required
                          step="0.1"
                          type="number"
                          value={thoughtEditForm.manualProgressPercent}
                        />
                      </label>
                    ) : (
                      <label className="field">
                        <span>
                          {progressUnitMeta[selected.progressUnit].current}
                        </span>
                        <input
                          max={selected.totalUnits || undefined}
                          min="0"
                          onChange={(event) =>
                            setThoughtEditForm({
                              ...thoughtEditForm,
                              currentUnits: event.target.value,
                            })
                          }
                          placeholder="0"
                          required
                          step="1"
                          type="number"
                          value={thoughtEditForm.currentUnits}
                        />
                      </label>
                    )}

                    {selected.mediaType === "book" &&
                      selected.bookCategory === "light_novel" && (
                        <label className="field">
                          <span>当时看到第几卷</span>
                          <input
                            min="0"
                            onChange={(event) =>
                              setThoughtEditForm({
                                ...thoughtEditForm,
                                volume: event.target.value,
                              })
                            }
                            placeholder="例如：3"
                            step="1"
                            type="number"
                            value={thoughtEditForm.volume}
                          />
                        </label>
                      )}

                    <ProgressBar percent={thoughtEditProgress} />
                  </section>
                )}
                <ThoughtComposer
                  images={thoughtEditForm.images}
                  mediaType={selected.mediaType}
                  onChange={(content) =>
                    setThoughtEditForm({ ...thoughtEditForm, content })
                  }
                  onError={setError}
                  onImagesChange={(images) =>
                    setThoughtEditForm({ ...thoughtEditForm, images })
                  }
                  onQuoteChange={(quoteText) =>
                    setThoughtEditForm({ ...thoughtEditForm, quoteText })
                  }
                  onQuoteMinuteChange={(quoteMinute) =>
                    setThoughtEditForm({ ...thoughtEditForm, quoteMinute })
                  }
                  onThoughtImagesChange={(thoughtImages) =>
                    setThoughtEditForm({ ...thoughtEditForm, thoughtImages })
                  }
                  placeholder="修改这条感想"
                  quoteMinute={thoughtEditForm.quoteMinute}
                  quoteText={thoughtEditForm.quoteText}
                  rows={8}
                  thoughtImages={thoughtEditForm.thoughtImages}
                  value={thoughtEditForm.content}
                />
                <div className="modal-actions">
                  <button
                    className="secondary-button"
                    onClick={() => setThoughtEditForm(null)}
                    type="button"
                  >
                    取消
                  </button>
                  <button className="primary-button" disabled={saving} type="submit">
                    {saving ? "正在保存…" : "保存修改"}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <ThoughtBody
                  mediaType={selected.mediaType}
                  note={activeThought}
                  onImageOpen={setZoomedImage}
                />
                <div className="thought-detail-actions">
                  <button
                    className="secondary-button"
                    onClick={() => startEditingThought(activeThought)}
                    type="button"
                  >
                    编辑感想
                  </button>
                  <button
                    className="delete-thought-button"
                    disabled={saving}
                    onClick={() => void deleteThought(activeThought.id)}
                    type="button"
                  >
                    删除这条感想
                  </button>
                </div>
              </>
            )}
          </article>
        </div>
      )}

      {zoomedImage && (
        <div
          aria-label="截图放大查看"
          aria-modal="true"
          className="image-lightbox-backdrop"
          onClick={() => setZoomedImage(null)}
          role="dialog"
        >
          <button
            aria-label="关闭大图"
            className="image-lightbox-close"
            onClick={() => setZoomedImage(null)}
            type="button"
          >
            ×
          </button>
          <img
            alt={zoomedImage.name}
            onClick={(event) => event.stopPropagation()}
            referrerPolicy="no-referrer"
            src={zoomedImage.dataUrl}
          />
        </div>
      )}

      {selected && entryDeleteConfirmOpen && (
        <div
          className="modal-backdrop delete-confirm-backdrop"
          onClick={() => !saving && setEntryDeleteConfirmOpen(false)}
          role="presentation"
        >
          <section
            aria-labelledby="delete-entry-title"
            aria-modal="true"
            className="delete-confirm-dialog"
            onClick={(event) => event.stopPropagation()}
            role="alertdialog"
          >
            <span aria-hidden="true" className="delete-confirm-mark">!</span>
            <div>
              <span className="eyebrow">DELETE ENTRY</span>
              <h2 id="delete-entry-title">删除《{selected.title}》？</h2>
              <p>条目资料、观看进度和全部感想都会一起删除，且无法恢复。</p>
            </div>
            <div className="modal-actions">
              <button
                className="secondary-button"
                disabled={saving}
                onClick={() => setEntryDeleteConfirmOpen(false)}
                type="button"
              >
                取消
              </button>
              <button
                className="delete-confirm-button"
                disabled={saving}
                onClick={() => void deleteEntry()}
                type="button"
              >
                {saving ? "正在删除…" : "确认删除"}
              </button>
            </div>
          </section>
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
                  {selected.mediaType === "book" && (
                    <div className="progress-mode-switch" aria-label="书籍进度填写方式">
                      <button
                        className={recordForm.progressMode === "units" ? "active" : ""}
                        onClick={() => setRecordForm({ ...recordForm, progressMode: "units" })}
                        type="button"
                      >
                        按页数
                      </button>
                      <button
                        className={recordForm.progressMode === "percent" ? "active" : ""}
                        onClick={() => setRecordForm({ ...recordForm, progressMode: "percent" })}
                        type="button"
                      >
                        直接填百分比
                      </button>
                    </div>
                  )}
                  {selected.mediaType === "book" && recordForm.progressMode === "percent" ? (
                    <label className="field">
                      <span>当前进度（%）</span>
                      <input
                        autoFocus
                        max="100"
                        min="0"
                        onChange={(event) => setRecordForm({ ...recordForm, manualProgressPercent: event.target.value })}
                        placeholder="0–100"
                        required
                        step="0.1"
                        type="number"
                        value={recordForm.manualProgressPercent}
                      />
                    </label>
                  ) : (
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
                  )}
                  {selected.mediaType === "book" && selected.bookCategory === "light_novel" && (
                    <label className="field">
                      <span>看到第几卷</span>
                      <input
                        min="0"
                        onChange={(event) => setRecordForm({ ...recordForm, volume: event.target.value })}
                        placeholder="例如：3"
                        step="1"
                        type="number"
                        value={recordForm.volume}
                      />
                    </label>
                  )}
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
                <>
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
                  {selected.bookCategory === "web_fiction" &&
                    selected.webFictionType === "danmei" && (
                      <label className="field danmei-tags-field">
                        <span>耽美题材标签</span>
                        <input
                          onChange={(event) =>
                            setRecordForm({
                              ...recordForm,
                              danmeiTags: event.target.value,
                            })
                          }
                          placeholder="例如：现代、ABO、骨科（用顿号分隔）"
                          type="text"
                          value={recordForm.danmeiTags}
                        />
                        <small>可填写多个，完成后会进入耽美题材统计。</small>
                      </label>
                    )}
                </>
              )}

              <ThoughtComposer
                images={recordForm.images}
                mediaType={selected.mediaType}
                onChange={(thought) => setRecordForm({ ...recordForm, thought })}
                onError={setError}
                onImagesChange={(images) => setRecordForm({ ...recordForm, images })}
                onQuoteChange={(quoteText) => setRecordForm({ ...recordForm, quoteText })}
                onQuoteMinuteChange={(quoteMinute) => setRecordForm({ ...recordForm, quoteMinute })}
                onThoughtImagesChange={(thoughtImages) =>
                  setRecordForm({ ...recordForm, thoughtImages })
                }
                placeholder="写下这次的感想（可选）"
                quoteMinute={recordForm.quoteMinute}
                quoteText={recordForm.quoteText}
                thoughtImages={recordForm.thoughtImages}
                value={recordForm.thought}
              />

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
