-- Regional Language Translation — see
-- docs/superpowers/specs/2026-08-24-regional-language-translation-design.md
-- Purely additive: three new tables, no changes to any existing table.

-- CreateTable
CREATE TABLE `ai_language` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(10) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `nativeName` VARCHAR(50) NOT NULL,
    `isRTL` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ai_language_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_question_translation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `questionId` INTEGER NOT NULL,
    `languageId` INTEGER NOT NULL,
    `question` LONGTEXT NULL,
    `optionA` LONGTEXT NULL,
    `optionB` LONGTEXT NULL,
    `optionC` LONGTEXT NULL,
    `optionD` LONGTEXT NULL,
    `hint` LONGTEXT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `failureReason` TEXT NULL,
    `generatedByProvider` VARCHAR(20) NULL,
    `generatedByModel` VARCHAR(100) NULL,
    `manuallyEdited` BOOLEAN NOT NULL DEFAULT false,
    `promptVersion` INTEGER NOT NULL DEFAULT 1,
    `sourceHash` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ai_question_translation_languageId_status_idx`(`languageId`, `status`),
    UNIQUE INDEX `ai_question_translation_questionId_languageId_key`(`questionId`, `languageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_dictionary_translation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `dictionaryId` INTEGER NOT NULL,
    `languageId` INTEGER NOT NULL,
    `term` VARCHAR(255) NULL,
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
    `promptVersion` INTEGER NOT NULL DEFAULT 1,
    `sourceHash` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ai_dictionary_translation_languageId_status_idx`(`languageId`, `status`),
    UNIQUE INDEX `ai_dictionary_translation_dictionaryId_languageId_key`(`dictionaryId`, `languageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ai_question_translation` ADD CONSTRAINT `ai_question_translation_languageId_fkey` FOREIGN KEY (`languageId`) REFERENCES `ai_language`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_dictionary_translation` ADD CONSTRAINT `ai_dictionary_translation_dictionaryId_fkey` FOREIGN KEY (`dictionaryId`) REFERENCES `ai_dictionary`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_dictionary_translation` ADD CONSTRAINT `ai_dictionary_translation_languageId_fkey` FOREIGN KEY (`languageId`) REFERENCES `ai_language`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
