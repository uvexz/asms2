ALTER TABLE `mailbox` ADD `retained_at` integer;--> statement-breakpoint
-- 旧规则下「收到过邮件」的临时邮箱，在新规则里应视为已永久保留
UPDATE `mailbox`
SET `retained_at` = `last_received_at`,
    `expires_at` = NULL,
    `status` = 'active'
WHERE `kind` = 'temp'
  AND `last_received_at` IS NOT NULL
  AND `status` IN ('active', 'expired');
