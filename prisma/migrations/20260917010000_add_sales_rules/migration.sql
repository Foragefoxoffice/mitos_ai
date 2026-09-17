-- Admin-managed "quick rules" list appended to the WhatsApp sales agent's
-- system prompt — a lower-friction alternative to editing the full
-- knowledge-base markdown (saleknowledge table). Purely additive: one new
-- table.

-- CreateTable
CREATE TABLE `salesrule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `text` VARCHAR(500) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
