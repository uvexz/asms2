CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `apikey` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`start` text,
	`prefix` text,
	`key` text NOT NULL,
	`reference_id` text NOT NULL,
	`config_id` text DEFAULT 'default' NOT NULL,
	`refill_interval` integer,
	`refill_amount` integer,
	`last_refill_at` integer,
	`enabled` integer DEFAULT true,
	`rate_limit_enabled` integer DEFAULT true,
	`rate_limit_time_window` integer,
	`rate_limit_max` integer,
	`request_count` integer DEFAULT 0,
	`remaining` integer,
	`last_request` integer,
	`expires_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`permissions` text,
	`metadata` text,
	FOREIGN KEY (`reference_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `apikey_reference_id_idx` ON `apikey` (`reference_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`impersonated_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`role` text DEFAULT 'user',
	`banned` integer DEFAULT false,
	`ban_reason` text,
	`ban_expires` integer,
	`mailbox_limit` integer,
	`send_limit` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`provider_attachment_id` text,
	`filename` text NOT NULL,
	`content_type` text,
	`size` integer DEFAULT 0 NOT NULL,
	`is_inline` integer DEFAULT false NOT NULL,
	`content_id` text,
	FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attachment_message_idx` ON `attachment` (`message_id`);--> statement-breakpoint
CREATE TABLE `mailbox` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`domain_id` text NOT NULL,
	`local_part` text NOT NULL,
	`address` text NOT NULL,
	`display_name` text,
	`kind` text DEFAULT 'permanent' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` integer,
	`last_received_at` integer,
	`last_sent_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`domain_id`) REFERENCES `domain`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mailbox_address_unique` ON `mailbox` (`address`);--> statement-breakpoint
CREATE UNIQUE INDEX `mailbox_domain_local_idx` ON `mailbox` (`domain_id`,`local_part`);--> statement-breakpoint
CREATE INDEX `mailbox_user_kind_idx` ON `mailbox` (`user_id`,`kind`,`status`);--> statement-breakpoint
CREATE INDEX `mailbox_sweep_idx` ON `mailbox` (`kind`,`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `mailbox_address_idx` ON `mailbox` (`address`);--> statement-breakpoint
CREATE TABLE `message` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`direction` text NOT NULL,
	`folder` text DEFAULT 'inbox' NOT NULL,
	`provider_config_id` text NOT NULL,
	`provider_message_id` text,
	`internet_message_id` text,
	`thread_key` text,
	`from_name` text,
	`from_address` text NOT NULL,
	`to_json` text NOT NULL,
	`cc_json` text,
	`bcc_json` text,
	`reply_to_json` text,
	`subject` text,
	`snippet` text,
	`status` text DEFAULT 'received' NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`is_starred` integer DEFAULT false NOT NULL,
	`has_attachments` integer DEFAULT false NOT NULL,
	`attachment_count` integer DEFAULT 0 NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`sent_at` integer,
	`received_at` integer,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailbox`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `message_mailbox_idx` ON `message` (`mailbox_id`,`folder`,`received_at`);--> statement-breakpoint
CREATE INDEX `message_user_idx` ON `message` (`user_id`,`folder`,`received_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `message_provider_uidx` ON `message` (`provider_config_id`,`provider_message_id`);--> statement-breakpoint
CREATE INDEX `message_thread_idx` ON `message` (`thread_key`);--> statement-breakpoint
CREATE INDEX `message_imap_id_idx` ON `message` (`internet_message_id`);--> statement-breakpoint
CREATE TABLE `message_body` (
	`message_id` text PRIMARY KEY NOT NULL,
	`html_raw` text,
	`html_sanitized` text,
	`text_body` text,
	`headers_json` text,
	FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`actor_role` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`meta_json` text,
	`ip` text,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_actor_idx` ON `audit_log` (`actor_user_id`);--> statement-breakpoint
CREATE TABLE `daily_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`usage_date` text NOT NULL,
	`sent_count` integer DEFAULT 0 NOT NULL,
	`received_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_usage_user_date_idx` ON `daily_usage` (`user_id`,`usage_date`);--> statement-breakpoint
CREATE TABLE `unrouted_message` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_config_id` text,
	`provider_message_id` text,
	`from_address` text,
	`to_json` text,
	`subject` text,
	`reason` text NOT NULL,
	`payload_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`provider_config_id`) REFERENCES `provider_config`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `unrouted_created_idx` ON `unrouted_message` (`created_at`);--> statement-breakpoint
CREATE TABLE `webhook_event` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint_id` text NOT NULL,
	`provider_config_id` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`type` text NOT NULL,
	`payload_json` text,
	`status` text DEFAULT 'received' NOT NULL,
	`error` text,
	`attempts` integer DEFAULT 1 NOT NULL,
	`received_at` integer DEFAULT (unixepoch()) NOT NULL,
	`processed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_event_dedupe_idx` ON `webhook_event` (`endpoint_id`,`provider_event_id`);--> statement-breakpoint
CREATE INDEX `webhook_event_created_idx` ON `webhook_event` (`received_at`);--> statement-breakpoint
CREATE TABLE `domain` (
	`id` text PRIMARY KEY NOT NULL,
	`hostname` text NOT NULL,
	`provider_config_id` text NOT NULL,
	`provider_domain_id` text,
	`purpose` text DEFAULT 'both' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`receiving_enabled` integer DEFAULT false NOT NULL,
	`sending_enabled` integer DEFAULT false NOT NULL,
	`is_default_permanent` integer DEFAULT false NOT NULL,
	`is_default_temp` integer DEFAULT false NOT NULL,
	`dns_records_json` text,
	`last_checked_at` integer,
	`verified_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`provider_config_id`) REFERENCES `provider_config`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domain_hostname_unique` ON `domain` (`hostname`);--> statement-breakpoint
CREATE INDEX `domain_provider_idx` ON `domain` (`provider_config_id`);--> statement-breakpoint
CREATE INDEX `domain_status_idx` ON `domain` (`status`);--> statement-breakpoint
CREATE TABLE `provider_config` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'resend' NOT NULL,
	`label` text NOT NULL,
	`api_key_enc` text NOT NULL,
	`api_key_last4` text,
	`api_base_url` text,
	`capabilities_json` text,
	`is_default_for_send` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_checked_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_by` text,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `provider_config_kind_idx` ON `provider_config` (`kind`);--> statement-breakpoint
CREATE TABLE `webhook_endpoint` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_config_id` text NOT NULL,
	`label` text NOT NULL,
	`signing_secret_enc` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_event_at` integer,
	`event_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`provider_config_id`) REFERENCES `provider_config`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_endpoint_provider_idx` ON `webhook_endpoint` (`provider_config_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_endpoint_id_idx` ON `webhook_endpoint` (`id`);--> statement-breakpoint
CREATE TABLE `app_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_provider` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`display_name` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`client_id` text,
	`client_secret_enc` text,
	`issuer` text,
	`scopes` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_provider_provider_id_unique` ON `auth_provider` (`provider_id`);--> statement-breakpoint
CREATE TABLE `site_settings` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`site_name` text DEFAULT 'asms2' NOT NULL,
	`site_description` text DEFAULT 'A Simple Mail Server' NOT NULL,
	`logo_url` text,
	`favicon_url` text,
	`site_url` text,
	`contact_email` text,
	`icp_record` text,
	`footer_text` text,
	`registration_enabled` integer DEFAULT true NOT NULL,
	`email_verification_required` integer DEFAULT false NOT NULL,
	`default_mailbox_limit` integer DEFAULT 5 NOT NULL,
	`default_daily_send_limit` integer DEFAULT 5 NOT NULL,
	`permanent_prefix_min` integer DEFAULT 3 NOT NULL,
	`temp_prefix_min` integer DEFAULT 8 NOT NULL,
	`prefix_max` integer DEFAULT 32 NOT NULL,
	`temp_ttl_minutes` integer DEFAULT 60 NOT NULL,
	`temp_grace_minutes` integer DEFAULT 60 NOT NULL,
	`temp_cooldown_hours` integer DEFAULT 24 NOT NULL,
	`permanent_cooldown_days` integer DEFAULT 30 NOT NULL,
	`allow_temp_send` integer DEFAULT false NOT NULL,
	`allow_user_domain_choice` integer DEFAULT true NOT NULL,
	`admin_can_read_mail` integer DEFAULT false NOT NULL,
	`trash_retention_days` integer DEFAULT 30 NOT NULL,
	`orphan_retention_days` integer DEFAULT 7 NOT NULL,
	`timezone` text DEFAULT 'Asia/Shanghai' NOT NULL,
	`reserved_words_json` text,
	`extra_json` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_by` text
);
