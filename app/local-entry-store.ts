import type { Entry } from "./media-types";
import { calculateProgress, deriveStatus } from "./media-types";
import type { DeletedEntry } from "./sync-model";

const DATABASE_NAME = "liuhen-local-journal";
const DATABASE_VERSION = 2;
const ENTRY_STORE = "entries";
const DELETION_STORE = "deleted_entries";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(ENTRY_STORE)) {
        database.createObjectStore(ENTRY_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(DELETION_STORE)) {
        database.createObjectStore(DELETION_STORE, { keyPath: "id" });
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
      const webFictionType: Entry["webFictionType"] =
        entry.webFictionType || "";
      const mangaProgressUnit: Entry["mangaProgressUnit"] =
        entry.mangaProgressUnit || "";
      const hasStoredNotes = Array.isArray(entry.notes);
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
          quoteText: note.quoteText || "",
          quoteMinute: note.quoteMinute || 0,
          images: note.images || [],
          thoughtImages: note.thoughtImages || [],
          volume: note.volume || 0,
          segmentCurrentUnits: note.segmentCurrentUnits || 0,
          segmentTotalUnits: note.segmentTotalUnits || 0,
          segmentProgressPercent: note.segmentProgressPercent || 0,
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
      if (!hasStoredNotes) {
        notes.push({
          id: `legacy-${entry.id}`,
          content: "",
          quoteText: "",
          quoteMinute: 0,
          images: [],
          thoughtImages: [],
          progressText: entry.progressText || "",
          currentUnits: entry.currentUnits || 0,
          segmentCurrentUnits: entry.segmentCurrentUnits || 0,
          segmentTotalUnits: entry.segmentTotalUnits || 0,
          segmentProgressPercent: entry.segmentProgressPercent || 0,
          progressPercent: entry.progressPercent || 0,
          volume: entry.volume || 0,
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
        progressMode: entry.progressMode || "units",
        mangaProgressUnit,
        totalVolumes: entry.totalVolumes || 0,
        segmentCurrentUnits: entry.segmentCurrentUnits || 0,
        segmentTotalUnits: entry.segmentTotalUnits || 0,
        segmentProgressPercent: entry.segmentProgressPercent || 0,
        volume: entry.volume || 0,
        webFictionType,
        danmeiTags: entry.danmeiTags || [],
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
  return openDatabase().then(
    (database) =>
      new Promise<IDBValidKey>((resolve, reject) => {
        const transaction = database.transaction(
          [ENTRY_STORE, DELETION_STORE],
          "readwrite",
        );
        const request = transaction.objectStore(ENTRY_STORE).put(entry);
        transaction.objectStore(DELETION_STORE).delete(entry.id);
        request.onsuccess = () => resolve(request.result);
        transaction.oncomplete = () => database.close();
        transaction.onerror = () => {
          database.close();
          reject(transaction.error ?? new Error("本地数据库操作失败"));
        };
      }),
  );
}

export function removeLocalEntry(id: string) {
  return openDatabase().then(
    (database) =>
      new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(
          [ENTRY_STORE, DELETION_STORE],
          "readwrite",
        );
        transaction.objectStore(ENTRY_STORE).delete(id);
        transaction.objectStore(DELETION_STORE).put({
          id,
          deletedAt: new Date().toISOString(),
        } satisfies DeletedEntry);
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error ?? new Error("本地数据库操作失败"));
        };
      }),
  );
}

export function listLocalDeletedEntries() {
  return openDatabase().then(
    (database) =>
      new Promise<DeletedEntry[]>((resolve, reject) => {
        const transaction = database.transaction(DELETION_STORE, "readonly");
        const request = transaction.objectStore(DELETION_STORE).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(request.error ?? new Error("删除记录没有读取成功"));
        transaction.oncomplete = () => database.close();
        transaction.onerror = () => {
          database.close();
          reject(transaction.error ?? new Error("删除记录没有读取成功"));
        };
      }),
  );
}

export function replaceLocalArchive(
  entries: Entry[],
  deletedEntries: DeletedEntry[],
) {
  return openDatabase().then(
    (database) =>
      new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(
          [ENTRY_STORE, DELETION_STORE],
          "readwrite",
        );
        const entryStore = transaction.objectStore(ENTRY_STORE);
        const deletionStore = transaction.objectStore(DELETION_STORE);
        entryStore.clear();
        deletionStore.clear();
        for (const entry of entries) entryStore.put(entry);
        for (const deletion of deletedEntries) deletionStore.put(deletion);
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error ?? new Error("同步数据没有保存成功"));
        };
      }),
  );
}
