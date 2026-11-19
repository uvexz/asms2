DROP INDEX `mailbox_address_idx`;--> statement-breakpoint
CREATE INDEX `mailbox_user_kind_created_idx` ON `mailbox` (`user_id`,`kind`,`created_at`);--> statement-breakpoint
DROP INDEX `webhook_endpoint_id_idx`;--> statement-breakpoint
DROP INDEX `message_mailbox_idx`;--> statement-breakpoint
DROP INDEX `message_user_idx`;--> statement-breakpoint
CREATE INDEX `message_trash_received_idx` ON `message` (`received_at`) WHERE "message"."folder" = 'trash';--> statement-breakpoint
CREATE INDEX `message_mailbox_idx` ON `message` (`mailbox_id`,`folder`,`received_at`,`id`);--> statement-breakpoint
CREATE INDEX `message_user_idx` ON `message` (`user_id`,`folder`,`received_at`,`id`);--> statement-breakpoint
CREATE INDEX `apikey_key_idx` ON `apikey` (`key`);--> statement-breakpoint
CREATE INDEX `session_expires_idx` ON `session` (`expires_at`);--> statement-breakpoint
CREATE INDEX `verification_expires_idx` ON `verification` (`expires_at`);--> statement-breakpoint
CREATE INDEX `unrouted_provider_msg_idx` ON `unrouted_message` (`provider_message_id`);--> statement-breakpoint
CREATE INDEX `telegram_bind_code_created_idx` ON `telegram_bind_code` (`created_at`);