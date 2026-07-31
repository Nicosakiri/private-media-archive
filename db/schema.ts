import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const entries = sqliteTable("entries", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  creator: text("creator").notNull().default(""),
  mediaType: text("media_type").notNull(),
  bookCategory: text("book_category").notNull().default(""),
  status: text("status").notNull().default("in_progress"),
  progressText: text("progress_text").notNull().default(""),
  progressPercent: integer("progress_percent").notNull().default(0),
  platform: text("platform").notNull().default(""),
  country: text("country").notNull().default(""),
  startedAt: text("started_at").notNull().default(""),
  lastSeenAt: text("last_seen_at").notNull().default(""),
  completedAt: text("completed_at").notNull().default(""),
  rating: integer("rating"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  entryId: text("entry_id")
    .notNull()
    .references(() => entries.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  progressText: text("progress_text").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
