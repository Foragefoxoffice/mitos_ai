-- AlterTable
ALTER TABLE `ai_job` ADD COLUMN `currentActivity` VARCHAR(255) NULL,
    ADD COLUMN `currentBatchProcessed` INTEGER NULL,
    ADD COLUMN `currentBatchTotal` INTEGER NULL;
