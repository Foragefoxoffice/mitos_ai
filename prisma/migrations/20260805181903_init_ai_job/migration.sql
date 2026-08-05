-- CreateTable
CREATE TABLE `ai_job` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` VARCHAR(50) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `cursor` INTEGER NOT NULL DEFAULT 0,
    `batchSize` INTEGER NOT NULL DEFAULT 20,
    `totalProcessed` INTEGER NOT NULL DEFAULT 0,
    `totalCreated` INTEGER NOT NULL DEFAULT 0,
    `totalSkipped` INTEGER NOT NULL DEFAULT 0,
    `totalFailed` INTEGER NOT NULL DEFAULT 0,
    `lastError` TEXT NULL,
    `startedAt` DATETIME(3) NULL,
    `lastRunAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ai_job_type_key`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
