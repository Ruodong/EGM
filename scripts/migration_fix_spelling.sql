-- Migration: Fix English spelling/grammar errors in reference data
-- Date: 2026-03-16

SET search_path TO egm;

-- 1. domain_registry: "Trade Complaince" → "Trade Compliance"
UPDATE domain_registry SET domain_name = 'Trade Compliance' WHERE domain_code = 'TC';

-- 2. dispatch_rule: extra space before comma in INTERNAL rule description
UPDATE dispatch_rule SET description = 'Lenovo internal project, support both Lenovo internal business operation and also external customer/partner facing sales/service/collaboration' WHERE rule_code = 'INTERNAL';

-- 3. domain_questionnaire_template: lowercase "protection" + remove duplicate "are"
UPDATE domain_questionnaire_template SET question_text = 'Are there sufficient data protection or security measures in place to protect the data in-scope of this Project?' WHERE domain_code = 'DP' AND section = 'Privacy Office Review' AND question_text LIKE '%sufficient data Protection or security measures are in place%';

-- 4. domain_questionnaire_template: add space before "(DSAR)"
UPDATE domain_questionnaire_template SET question_text = 'The stakeholders, systems and/or information relevant for the Data Subject Access Rights (DSAR) process has/have been identified.' WHERE domain_code = 'DP' AND section = 'Privacy Office Review' AND question_text LIKE '%Rights(DSAR)%';
