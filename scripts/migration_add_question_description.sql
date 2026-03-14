-- Add question_description column to domain_questionnaire_template
ALTER TABLE domain_questionnaire_template ADD COLUMN IF NOT EXISTS question_description TEXT;
