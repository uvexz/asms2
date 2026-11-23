DROP INDEX `mailbox_domain_local_idx`;--> statement-breakpoint
CREATE INDEX `mailbox_domain_local_idx` ON `mailbox` (`domain_id`,`local_part`);--> statement-breakpoint
DROP INDEX `unrouted_provider_msg_idx`;--> statement-breakpoint
-- 去重后再建唯一索引:同一服务商邮件只保留最早一条墓碑
DELETE FROM `unrouted_message`
WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM `unrouted_message`
  GROUP BY `provider_config_id`, `provider_message_id`
);--> statement-breakpoint
CREATE UNIQUE INDEX `unrouted_provider_msg_idx` ON `unrouted_message` (`provider_config_id`,`provider_message_id`);