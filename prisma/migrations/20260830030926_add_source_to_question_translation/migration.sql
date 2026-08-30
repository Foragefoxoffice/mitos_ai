-- ai_question_translation was created with just [questionId, languageId]
-- unique, missing the same practice/test_series disambiguator
-- ai_dictionary_mapping needed for the identical reason: `question.id` and
-- `testseriesquestionbank.id` are independent sequences that can collide.
-- Caught before the table had any real rows (still empty at this point),
-- so this is a pure schema fix, no data migration involved.
ALTER TABLE `ai_question_translation` ADD COLUMN `source` VARCHAR(20) NOT NULL DEFAULT 'practice';

-- Add the new unique index BEFORE dropping the old one — same ordering
-- constraint as the ai_dictionary_mapping fix (no covering index gap).
ALTER TABLE `ai_question_translation` ADD UNIQUE INDEX `ai_question_translation_questionId_languageId_source_key` (`questionId`, `languageId`, `source`);
ALTER TABLE `ai_question_translation` DROP INDEX `ai_question_translation_questionId_languageId_key`;

ALTER TABLE `ai_question_translation` ADD INDEX `ai_question_translation_source_questionId_idx` (`source`, `questionId`);
