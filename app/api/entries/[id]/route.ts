import { ensureSchema, getD1 } from "@/db/runtime";

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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await ensureSchema();
  const { id } = await context.params;
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
  const now = new Date().toISOString();
  const lastSeenAt = text(body.lastSeenAt) || now.slice(0, 10);
  const thought = text(body.thought);
  const db = getD1();

  const statements = [
    db
      .prepare(
        `UPDATE entries SET
          title = ?, creator = ?, media_type = ?, book_category = ?, status = ?,
          progress_text = ?, progress_percent = ?, platform = ?,
          country = ?, last_seen_at = ?, completed_at = ?, rating = ?, updated_at = ?
        WHERE id = ?`,
      )
      .bind(
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
        status === "completed" ? lastSeenAt : "",
        rating,
        now,
        id,
      ),
  ];

  if (thought) {
    statements.push(
      db
        .prepare(
          "INSERT INTO notes (id, entry_id, content, progress_text, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(crypto.randomUUID(), id, thought, text(body.progressText), now),
    );
  }

  await db.batch(statements);
  return Response.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await ensureSchema();
  const { id } = await context.params;
  const db = getD1();
  await db.batch([
    db.prepare("DELETE FROM notes WHERE entry_id = ?").bind(id),
    db.prepare("DELETE FROM entries WHERE id = ?").bind(id),
  ]);
  return Response.json({ ok: true });
}
