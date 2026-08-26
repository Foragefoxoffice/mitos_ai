-- Add source discriminator so questionId can be disambiguated between the
-- main `question` table (practice) and `testseriesquestionbank` (test_series).
ALTER TABLE `ai_dictionary_mapping` ADD COLUMN `source` VARCHAR(20) NOT NULL DEFAULT 'practice';

-- Add the new unique index BEFORE dropping the old one — dictionaryId has
-- a foreign key constraint that requires a covering index at all times,
-- so the old index can't be dropped until a replacement already exists.
ALTER TABLE `ai_dictionary_mapping` ADD UNIQUE INDEX `ai_dictionary_mapping_dictionaryId_questionId_source_key` (`dictionaryId`, `questionId`, `source`);
ALTER TABLE `ai_dictionary_mapping` DROP INDEX `ai_dictionary_mapping_dictionaryId_questionId_key`;

ALTER TABLE `ai_dictionary_mapping` ADD INDEX `ai_dictionary_mapping_source_questionId_idx` (`source`, `questionId`);
