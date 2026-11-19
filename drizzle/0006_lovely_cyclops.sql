DROP INDEX `message_trash_received_idx`;--> statement-breakpoint
CREATE INDEX `message_folder_received_idx` ON `message` (`folder`,`received_at`);