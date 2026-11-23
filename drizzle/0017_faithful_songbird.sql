ALTER TABLE `site_settings` ADD `email_domain_whitelist_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `email_domain_whitelist_json` text;