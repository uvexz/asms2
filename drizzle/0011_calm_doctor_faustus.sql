CREATE INDEX `account_provider_account_idx` ON `account` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `message_unread_idx` ON `message` (`mailbox_id`,`folder`,`is_read`) WHERE is_read = 0;--> statement-breakpoint
CREATE INDEX `message_direction_idx` ON `message` (`direction`);--> statement-breakpoint
CREATE INDEX `webhook_event_status_idx` ON `webhook_event` (`status`);--> statement-breakpoint
-- 回填历史空值：游标分页按 received_at 比较，NULL 行会永久被过滤掉
UPDATE `message` SET `received_at` = `created_at` WHERE `received_at` IS NULL;