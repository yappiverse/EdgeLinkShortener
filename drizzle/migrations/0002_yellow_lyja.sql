CREATE UNIQUE INDEX `urls_shortened_url_unique` ON `urls` (`shortened_url`);--> statement-breakpoint
CREATE INDEX `shortened_url_idx` ON `urls` (`shortened_url`);--> statement-breakpoint
CREATE INDEX `original_url_idx` ON `urls` (`original_url`);