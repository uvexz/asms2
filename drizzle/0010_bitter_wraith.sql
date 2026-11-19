ALTER TABLE `auth_provider` ADD `kind` text DEFAULT 'oidc' NOT NULL;--> statement-breakpoint
UPDATE `auth_provider` SET `kind` = `provider_id` WHERE `provider_id` IN ('email', 'google', 'github', 'oidc', 'passkey');
