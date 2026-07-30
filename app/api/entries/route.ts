import { ensureSchema, getD1 } from "@/db/runtime";

type EntryRow = {
  id: string;
  title: string;
  creator: string;
  media_type: string;
  book_category: string;
  status: string;
  progress_text: string;
  progress_percent: number;
  platform: string;
  country: string;
  started_at: string;
  last_seen_at: string;
  completed_at: string;
  rating: number | null;
  created_at: string;
  updated_at: string;
};

type NoteRow = {
  id: string;
  entry_id: string;
  content: string;
  progress_text: string;
  created_at: string;
};

const allowedTypes = new Set(["book", "movie", "series"]);
const allowedBookCategories = new Set([
  "literary",
  "social_science",
  "web_fiction",
  "manga",
]);
const allowedStatuses = new Set(["in_progress", "completed", "paused"]);

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toEntry(row: EntryRow, notes: NoteRow[]) {
  return {
    id: row.id,
    title: row.title,
    creator: row.creator,
    mediaType: row.media_type,
    bookCategory: row.book_category,
    status: row.status,
    progressText: row.progress_text,
    progressPercent: row.progress_percent,
    platform: row.platform,
    country: row.country,
    startedAt: row.started_at,
    lastSeenAt: row.last_seen_at,
    completedAt: row.completed_at,
    rating: row.rating,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    notes: notes
      .filter((note) => note.entry_id === row.id)
      .map((note) => ({
        id: note.id,
        content: note.content,
        progressText: note.progress_text,
        createdAt: note.created_at,
      })),
  };
}

export async function GET() {
  await ensureSchema();
  const db = getD1();
  const [entryResult, noteResult] = await db.batch([
    db.prepare("SELECT * FROM entries ORDER BY updated_at DESC"),
    db.prepare("SELECT * FROM notes ORDER BY created_at DESC"),
  ]);
  const rows = (entryResult.results || []) as unknown as EntryRow[];
  const notes = (noteResult.results || []) as unknown as NoteRow[];
  return Response.json({
    entries: rows.map((row) => toEntry(row, notes)),
  });
}

export async function POST(request: Request) {
  await ensureSchema();
  const body = (await request.json()) as Record<string, unknown>;
  const title = text(body.title);
  if (!title) {
    return Response.json({ error: "作品名称不能为空" }, { status: 400 });
  }

  const mediaType = allowedTypes.has(text(body.mediaType))
    ? text(body.mediaType)
    : "book";
  const status = allowedStatuses.has(text(body.status))
    ? text(body.status)
    : "in_progress";
  const bookCategory =
    mediaType === "book" && allowedBookCategories.has(text(body.bookCategory))
      ? text(body.bookCategory)
      : "";
  const progressPercent = Math.max(
    0,
    Math.min(100, Number(body.progressPercent) || 0),
  );
  const ratingValue = Number(body.rating);
  const rating =
    status === "completed" && ratingValue >= 1 && ratingValue <= 10
      ? ratingValue
      : null;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const lastSeenAt = text(body.lastSeenAt) || now.slice(0, 10);
  const thought = text(body.thought);
  const noteId = thought ? crypto.randomUUID() : "";
  const db = getD1();

  const statements = [
    db
      .prepare(
        `INSERT INTO entries (
          id, title, creator, media_type, book_category, status, progress_text,
          progress_percent, platform, country, started_at, last_seen_at,
          completed_at, rating, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        title,
        text(body.creator),
        mediaType,
        bookCategory,
        status,
        text(body.progressText),
        progressPercent,
        text(body.platform),
        text(body.country),
        lastSeenAt,
        lastSeenAt,
        status === "completed" ? lastSeenAt : "",
        rating,
        now,
        now,
      ),
  ];

  if (thought) {
    statements.push(
      db
        .prepare(
          "INSERT INTO notes (id, entry_id, content, progress_text, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(noteId, id, thought, text(body.progressText), now),
    );
  }

  await db.batch(statements);
  return Response.json({ id }, { status: 201 });
}
