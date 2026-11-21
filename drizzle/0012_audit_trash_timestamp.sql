ALTER TABLE `message` ADD `trashed_at` integer;--> statement-breakpoint
CREATE INDEX `message_trash_idx` ON `message` (`folder`,`trashed_at`);--> statement-breakpoint
-- 回填：存量回收站邮件从本次迁移开始重新计算保留期，避免上线后被立即清掉
UPDATE `message` SET `trashed_at` = unixepoch() WHERE `folder` = 'trash' AND `trashed_at` IS NULL;
