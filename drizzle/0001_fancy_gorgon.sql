ALTER TABLE `domain` ADD `allow_permanent_create` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `domain` ADD `allow_temp_create` integer DEFAULT true NOT NULL;