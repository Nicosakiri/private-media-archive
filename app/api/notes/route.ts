import { ensureSchema, getD1 } from "@/db/runtime";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  await ensureSchema();
  const body = (await request.json()) as Record<string, unknown>;
  const entryId = text(body.entryId);
  const content = text(body.content);
  if (!entryId || !content) {
    return Response.json({ error: "感想内容不能为空" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const progressText = text(body.progressText);
  const db = getD1();
  await db.batch([
    db
      .prepare(
        "INSERT INTO notes (id, entry_id, content, progress_text, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(id, entryId, content, progressText, now),
    db
      .prepare("UPDATE entries SET updated_at = ? WHERE id = ?")
      .bind(now, entryId),
  ]);

  return Response.json(
    {
      note: {
        id,
        content,
        progressText,
        createdAt: now,
      },
    },
    { status: 201 },
  );
}
