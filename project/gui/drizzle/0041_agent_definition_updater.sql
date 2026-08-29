ALTER TABLE `agent_definition` ADD `updater_account_id` text REFERENCES `user`(`id`);
--> statement-breakpoint
UPDATE `agent_definition` SET `updater_account_id` = `creator_account_id` WHERE `updater_account_id` IS NULL;
