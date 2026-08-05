-- CreateTable
CREATE TABLE `ai_dictionary` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `term` VARCHAR(255) NOT NULL,
    `meaning` LONGTEXT NULL,
    `simpleExplanation` LONGTEXT NULL,
    `eli5` LONGTEXT NULL,
    `detailedExplanation` LONGTEXT NULL,
    `mnemonic` LONGTEXT NULL,
    `realLifeExample` LONGTEXT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `failureReason` TEXT NULL,
    `generatedByProvider` VARCHAR(20) NULL,
    `generatedByModel` VARCHAR(100) NULL,
    `manuallyEdited` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ai_dictionary_term_key`(`term`),
    INDEX `ai_dictionary_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_dictionary_mapping` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `dictionaryId` INTEGER NOT NULL,
    `questionId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_dictionary_mapping_questionId_idx`(`questionId`),
    UNIQUE INDEX `ai_dictionary_mapping_dictionaryId_questionId_key`(`dictionaryId`, `questionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ai_dictionary_mapping` ADD CONSTRAINT `ai_dictionary_mapping_dictionaryId_fkey` FOREIGN KEY (`dictionaryId`) REFERENCES `ai_dictionary`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
