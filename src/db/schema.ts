import { sqliteTable, text, index } from "drizzle-orm/sqlite-core";

export const urlsTable = sqliteTable(
  "urls",
  {
    shortenedUrl: text("shortened_url").notNull().unique().primaryKey(),
    originalUrl: text("original_url").notNull(),
  },
  (table) => [
    index("shortened_url_idx").on(table.shortenedUrl),
    index("original_url_idx").on(table.originalUrl),
  ]
);
