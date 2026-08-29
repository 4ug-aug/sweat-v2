CREATE TABLE `oneshot_usage` (
	`run_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `oneshot_usage_account_created_idx` ON `oneshot_usage` (`account_id`, `created_at`);
