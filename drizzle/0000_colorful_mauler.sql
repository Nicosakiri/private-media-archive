CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`creator` text DEFAULT '' NOT NULL,
	`media_type` text NOT NULL,
	`book_category` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`progress_text` text DEFAULT '' NOT NULL,
	`progress_percent` integer DEFAULT 0 NOT NULL,
	`platform` text DEFAULT '' NOT NULL,
	`country` text DEFAULT '' NOT NULL,
	`started_at` text DEFAULT '' NOT NULL,
	`last_seen_at` text DEFAULT '' NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL,
	`rating` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`content` text NOT NULL,
	`progress_text` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade
);
