-- 旧邮箱必须有配额行，否则首次新建会绕过计数。
-- 新邮箱由创建逻辑在插入前预占；创建失败由清理任务回收。
INSERT INTO `mailbox_quota` (`id`, `user_id`, `kind`, `mailbox_id`, `hour_bucket`, `sent_at`)
SELECT `id`, `user_id`, `kind`, `id`,
  CASE WHEN `kind` = 'temp' THEN CAST(`created_at` / 3600 AS TEXT) ELSE NULL END,
  `created_at`
FROM `mailbox`
WHERE `status` != 'deleted';
--> statement-breakpoint
-- 历史问题修复：不要依赖 provider_config -> webhook_endpoint 的外键级联。
DELETE FROM `webhook_endpoint`
WHERE NOT EXISTS (
  SELECT 1 FROM `provider_config` WHERE `provider_config`.`id` = `webhook_endpoint`.`provider_config_id`
);
