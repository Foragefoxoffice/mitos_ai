-- AlterTable
ALTER TABLE `ai_chat_message` ADD COLUMN `inputTokens` INTEGER NULL DEFAULT 0,
    ADD COLUMN `outputTokens` INTEGER NULL DEFAULT 0;
