import type { Entry } from "./media-types";
import { calculateProgress, deriveStatus } from "./media-types";

const DATABASE_NAME = "liuhen-local-journal";
const DATABASE_VERSION = 1;
const ENTRY_STORE = "entries";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(ENTRY_STORE)) {
        database.createObjectStore(ENTRY_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("本地数据库无法打开"));
  });
}

function runRequest<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
) {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(ENTRY_STORE, mode);
        const request = operation(transaction.objectStore(ENTRY_STORE));

        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(request.error ?? new Error("本地数据库操作失败"));
        transaction.oncomplete = () => database.close();
        transaction.onerror = () => {
          database.close();
          reject(transaction.error ?? new Error("本地数据库操作失败"));
        };
      }),
  );
}

export async function listLocalEntries() {
  const entries = await runRequest<Entry[]>("readonly", (store) =>
    store.getAll(),
  );
  return entries
    .map((entry) => {
      const legacyType = entry.mediaType as string;
      const seriesCategory: Entry["seriesCategory"] =
        legacyType === "variety"
          ? "variety"
          : entry.seriesCategory ||
            (legacyType === "series" ? "tv" : "");
      const normalizedStatus: Entry["status"] =
        (entry.status as string) === "paused" ? "abandoned" : entry.status;
      const notes = (entry.notes || []).map((note, index) => {
        const currentUnits =
          note.currentUnits ??
          Number(note.progressText?.match(/(\d+(?:\.\d+)?)/)?.[1] || 0);
        const progressPercent =
          note.progressPercent ??
          calculateProgress(entry.movieMode, entry.totalUnits, currentUnits);
        return {
          ...note,
          content: note.content || "",
          currentUnits,
          progressPercent,
          status:
            note.status ||
            deriveStatus(
              progressPercent,
              index === 0 && normalizedStatus === "abandoned",
            ),
          watchedAt:
            note.watchedAt ||
            note.createdAt?.slice(0, 10) ||
            entry.lastSeenAt?.slice(0, 10) ||
            entry.createdAt.slice(0, 10),
        };
      });
      if (!notes.length) {
        notes.push({
          id: `legacy-${entry.id}`,
          content: "",
          progressText: entry.progressText || "",
          currentUnits: entry.currentUnits || 0,
          progressPercent: entry.progressPercent || 0,
          status: normalizedStatus,
          watchedAt:
            entry.lastSeenAt?.slice(0, 10) ||
            entry.createdAt.slice(0, 10),
          createdAt: entry.updatedAt || entry.createdAt,
        });
      }
      return {
        ...entry,
        mediaType: legacyType === "variety" ? "series" : entry.mediaType,
        seriesCategory,
        originalTitle: entry.originalTitle || "",
        cast: entry.cast || "",
        year: entry.year || "",
        doubanUrl: entry.doubanUrl || "",
        coverUrl: entry.coverUrl || "",
        notes,
        status: normalizedStatus,
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveLocalEntry(entry: Entry) {
  return runRequest<IDBValidKey>("readwrite", (store) => store.put(entry));
}

export function removeLocalEntry(id: string) {
  return runRequest<undefined>("readwrite", (store) => store.delete(id));
}
