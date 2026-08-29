CREATE TABLE `agent_definition` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL CHECK (length(`name`) BETWEEN 1 AND 80),
	`description` text NOT NULL CHECK (length(`description`) BETWEEN 1 AND 500),
	`instructions` text NOT NULL CHECK (length(`instructions`) BETWEEN 1 AND 20000),
	`runtime_kind` text NOT NULL CHECK (`runtime_kind` IN ('cursor', 'openai-agents')),
	`visibility` text NOT NULL CHECK (`visibility` IN ('private', 'workspace')),
	`creator_account_id` text NOT NULL REFERENCES `user`(`id`),
	`creating_agent_id` text REFERENCES `agent_definition`(`id`),
	`github_access` integer NOT NULL CHECK (`github_access` IN (0, 1)),
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_definition_creator_idx` ON `agent_definition` (`creator_account_id`);
