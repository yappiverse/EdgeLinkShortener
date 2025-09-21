import { sqliteTable, text, index } from "drizzle-orm/sqlite-core";

export const urlsTable = sqliteTable(
  "urls",
  {
    shortenedUrl: text("shortened_url").notNull().primaryKey(),
    originalUrl: text("original_url").notNull(),
  }
);
