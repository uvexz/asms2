ALTER TABLE `site_settings` ADD `captcha_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `new_account_send_cooldown_hours` integer DEFAULT 24 NOT NULL;--> statement-breakpoint
CREATE TABLE `rate_limit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limit_key_unique` ON `rate_limit` (`key`);--> statement-breakpoint
CREATE INDEX `rate_limit_last_request_idx` ON `rate_limit` (`last_request`);--> statement-breakpoint
CREATE TABLE `pow_challenge` (
	`salt` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pow_challenge_expires_idx` ON `pow_challenge` (`expires_at`);
