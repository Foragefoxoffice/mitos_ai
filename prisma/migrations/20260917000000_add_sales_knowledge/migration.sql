-- WhatsApp sales agent's "business brain" knowledge base — admin-editable
-- at runtime instead of a static file. Purely additive: one new table.

-- CreateTable
CREATE TABLE `saleknowledge` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `content` LONGTEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
