CREATE TABLE `mailbox_quota` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`hour_bucket` text,
	`sent_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mailbox_quota_mailbox_id_unique` ON `mailbox_quota` (`mailbox_id`);--> statement-breakpoint
CREATE INDEX `mailbox_quota_user_kind_idx` ON `mailbox_quota` (`user_id`,`kind`);--> statement-breakpoint
CREATE INDEX `mailbox_quota_temp_bucket_idx` ON `mailbox_quota` (`user_id`,`kind`,`hour_bucket`);--> statement-breakpoint
CREATE TABLE `outbound_request` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`provider_config_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text NOT NULL,
	`provider_message_id` text,
	`message_id` text,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`usage_date` text NOT NULL,
	`quota_reserved` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbound_request_idempotency_key_unique` ON `outbound_request` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `outbound_request_user_idx` ON `outbound_request` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `outbound_request_status_idx` ON `outbound_request` (`status`,`updated_at`);--> statement-breakpoint
ALTER TABLE `telegram_update` ADD `status` text DEFAULT 'processed' NOT NULL;--> statement-breakpoint
ALTER TABLE `telegram_update` ADD `attempts` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `telegram_update` ADD `last_error` text;--> statement-breakpoint
ALTER TABLE `telegram_update` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `telegram_update` SET `updated_at` = unixepoch() WHERE `updated_at` = 0;--> statement-breakpoint
CREATE INDEX `telegram_update_status_idx` ON `telegram_update` (`status`,`updated_at`);