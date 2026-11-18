CREATE TABLE `telegram_bind_code` (
	`code` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `telegram_bind_code_user_idx` ON `telegram_bind_code` (`user_id`);--> statement-breakpoint
CREATE TABLE `telegram_bot` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`bot_token_enc` text,
	`bot_token_last4` text,
	`bot_id` text,
	`bot_username` text,
	`webhook_secret_enc` text,
	`webhook_secret_last4` text,
	`webhook_url` text,
	`webhook_set_at` integer,
	`last_error` text,
	`last_error_at` integer,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
CREATE TABLE `telegram_link` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`tg_user_id` text,
	`tg_username` text,
	`tg_first_name` text,
	`notify_enabled` integer DEFAULT true NOT NULL,
	`notify_scope` text DEFAULT 'all' NOT NULL,
	`linked_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_notified_at` integer,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_link_chat_id_unique` ON `telegram_link` (`chat_id`);--> statement-breakpoint
CREATE INDEX `telegram_link_user_idx` ON `telegram_link` (`user_id`);--> statement-breakpoint
CREATE TABLE `telegram_update` (
	`update_id` integer PRIMARY KEY NOT NULL,
	`chat_id` text,
	`kind` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `telegram_update_created_idx` ON `telegram_update` (`created_at`);