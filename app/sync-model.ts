import type { Entry } from "./media-types";

export const ARCHIVE_FORMAT = "private-media-archive";
export const ARCHIVE_VERSION = 1;

export type DeletedEntry = {
  id: string;
  deletedAt: string;
};

export type ArchivePreferences = {
  theme: "light" | "dark";
  hiddenWebFilters: string[];
  showHiddenEntries: boolean;
  userProfile: {
    name: string;
    avatar: string;
  };
};

export type LocalArchive = {
  format: typeof ARCHIVE_FORMAT;
  version: typeof ARCHIVE_VERSION;
  exportedAt: string;
  deviceId: string;
  entries: Entry[];
  deletedEntries: DeletedEntry[];
  preferences: ArchivePreferences;
};

function timestamp(value: string | undefined) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function laterEntry(left: Entry | undefined, right: Entry | undefined) {
  if (!left) return right;
  if (!right) return left;
  return timestamp(right.updatedAt) > timestamp(left.updatedAt) ? right : left;
}

export function mergeArchives(
  left: LocalArchive,
  right: LocalArchive,
): LocalArchive {
  const entries = new Map<string, Entry>();
  for (const entry of [...left.entries, ...right.entries]) {
    const selected = laterEntry(entries.get(entry.id), entry);
    if (selected) entries.set(entry.id, selected);
  }

  const deletions = new Map<string, DeletedEntry>();
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

  const rightIsNewer = timestamp(right.exportedAt) >= timestamp(left.exportedAt);
  const newest = rightIsNewer ? right : left;
  return {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt: new Date().toISOString(),
    deviceId: newest.deviceId,
    entries: Array.from(entries.values()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    ),
    deletedEntries: Array.from(deletions.values()),
    preferences: newest.preferences,
  };
}

export function parseArchive(value: unknown): LocalArchive {
  if (!value || typeof value !== "object") {
    throw new Error("同步包内容无效。");
  }
  const archive = value as Partial<LocalArchive>;
  if (
    archive.format !== ARCHIVE_FORMAT ||
    archive.version !== ARCHIVE_VERSION ||
    !Array.isArray(archive.entries) ||
    !Array.isArray(archive.deletedEntries) ||
    !archive.preferences ||
    typeof archive.exportedAt !== "string"
  ) {
    throw new Error("这不是可识别的 Private Media Archive 同步包。");
  }
  return archive as LocalArchive;
}
