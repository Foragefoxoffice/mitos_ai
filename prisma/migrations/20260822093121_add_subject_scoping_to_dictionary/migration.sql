-- Scope ai_dictionary entries by (term, subject) instead of term alone.
-- A word like "cell" or "horn" means something different in Biology than
-- in Physics/Chemistry — the old single-column unique constraint meant
-- whichever subject generated the entry first "won" that definition for
-- every other subject too. Existing rows are safe under the new
-- constraint: `term` was already globally unique, so (term, 'general')
-- is trivially unique for every existing row.

ALTER TABLE `ai_dictionary` DROP INDEX `ai_dictionary_term_key`;

ALTER TABLE `ai_dictionary` ADD COLUMN `subject` VARCHAR(20) NOT NULL DEFAULT 'general';

ALTER TABLE `ai_dictionary` ADD UNIQUE INDEX `ai_dictionary_term_subject_key`(`term`, `subject`);
