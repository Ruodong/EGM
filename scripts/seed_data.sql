-- EGM Seed Data
SET search_path TO egm;

-- ═══════════════════════════════════════════════════════
-- Domain Registry
-- ═══════════════════════════════════════════════════════

INSERT INTO domain_registry (domain_code, domain_name, description, integration_type, icon, sort_order) VALUES
('EA', 'Enterprise Architecture Review', 'Review solution architecture including business, application, and technical layers', 'external', 'Building2', 1),
('BIA', 'Business Impact Assessment', 'Assess business impact, risk level, and continuity requirements', 'internal', 'BarChart3', 2),
('RAI', 'Responsible AI Review', 'Evaluate AI ethics, fairness, transparency, and accountability', 'internal', 'Brain', 3),
('DATA_PRIVACY', 'Data Privacy Review', 'Assess data privacy impact, GDPR/PIPL compliance, and data handling practices', 'internal', 'Shield', 4)
ON CONFLICT (domain_code) DO NOTHING;

-- ═══════════════════════════════════════════════════════
-- Intake Templates: Scoping Questions
-- ═══════════════════════════════════════════════════════

INSERT INTO intake_template (section_type, section, question_no, question_text, answer_type, options, is_required, triggers_domain, sort_order) VALUES
('scoping', 'AI Usage', 1, 'Does this project involve AI/ML models or algorithms?', 'select', '["Yes", "No"]', true, '{RAI}', 1),
('scoping', 'AI Usage', 2, 'Does this project use generative AI (LLM, image generation, etc.)?', 'select', '["Yes", "No"]', true, '{RAI}', 2),
('scoping', 'Data Handling', 3, 'Does this project process personal identifiable information (PII)?', 'select', '["Yes", "No"]', true, '{DATA_PRIVACY}', 3),
('scoping', 'Data Handling', 4, 'Does this project handle cross-border data transfers?', 'select', '["Yes", "No"]', true, '{DATA_PRIVACY}', 4),
('scoping', 'Architecture', 5, 'Does this project introduce new technology components or platforms?', 'select', '["Yes", "No"]', true, '{EA}', 5),
('scoping', 'Architecture', 6, 'Does this project modify existing enterprise architecture?', 'select', '["Yes", "No"]', true, '{EA}', 6),
('scoping', 'Business Impact', 7, 'Is this a customer-facing application or service?', 'select', '["Yes", "No"]', true, '{BIA}', 7),
('scoping', 'Business Impact', 8, 'Does this project have potential revenue impact > $1M?', 'select', '["Yes", "No"]', true, '{BIA}', 8)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════
-- Intake Templates: Common Questionnaire
-- ═══════════════════════════════════════════════════════

INSERT INTO intake_template (section_type, section, question_no, question_text, answer_type, options, is_required, sort_order) VALUES
('common', 'Project Details', 1, 'Project Name', 'text', null, true, 10),
('common', 'Project Details', 2, 'Project ID / Code', 'text', null, false, 11),
('common', 'Project Details', 3, 'Project Description', 'textarea', null, true, 12),
('common', 'Project Details', 4, 'Project Phase', 'select', '["Planning", "Design", "Development", "Testing", "Deployment", "Maintenance"]', true, 13),
('common', 'Project Details', 5, 'Target Go-Live Date', 'date', null, false, 14),
('common', 'Business Scenarios', 6, 'Business Unit / Organization', 'text', null, true, 20),
('common', 'Business Scenarios', 7, 'Business Scenario Description', 'textarea', null, true, 21),
('common', 'Business Scenarios', 8, 'Target Users', 'select', '["Internal Employees", "External Customers", "Partners", "All"]', true, 22),
('common', 'Business Scenarios', 9, 'Expected User Volume', 'select', '["< 100", "100-1000", "1000-10000", "> 10000"]', false, 23),
('common', 'Data Info', 10, 'Data Sources', 'textarea', null, true, 30),
('common', 'Data Info', 11, 'Data Classification', 'select', '["Public", "Internal", "Confidential", "Restricted"]', true, 31),
('common', 'Data Info', 12, 'Data Storage Location', 'select', '["On-Premise", "Cloud - China", "Cloud - Global", "Hybrid"]', true, 32),
('common', 'Tech Overview', 13, 'Technology Stack', 'textarea', null, false, 40),
('common', 'Tech Overview', 14, 'Hosting Environment', 'select', '["On-Premise", "Public Cloud", "Private Cloud", "Hybrid"]', false, 41),
('common', 'Tech Overview', 15, 'Third-Party Services / APIs Used', 'textarea', null, false, 42)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════
-- Dispatch Rules (Level-1 seed rules, children added via UI)
-- ═══════════════════════════════════════════════════════

INSERT INTO dispatch_rule (rule_code, rule_name, description, sort_order, create_by) VALUES
('INTERNAL', '内部项目', '仅面向企业内部使用的项目', 1, 'system'),
('EXTERNAL', '外部项目', '面向客户或合作伙伴的外部产品/服务', 2, 'system'),
('AI', 'AI项目', '涉及 AI/ML 模型或生成式 AI', 3, 'system'),
('PII', 'PII数据', '处理个人可识别信息或敏感数据', 4, 'system'),
('OPEN_SOURCE', '开源方案', '使用或发布开源软件/组件', 5, 'system')
ON CONFLICT (rule_code) DO UPDATE SET parent_rule_code = NULL, sort_order = EXCLUDED.sort_order;

-- Level-2 child rules under INTERNAL
INSERT INTO dispatch_rule (rule_code, rule_name, parent_rule_code, sort_order, create_by) VALUES
('INTERNAL_ONLY', 'Internal employee using', 'INTERNAL', 1, 'system'),
('EXTERNAL_USING', 'Have external user (customer, partner)', 'INTERNAL', 2, 'system')
ON CONFLICT (rule_code) DO UPDATE SET parent_rule_code = EXCLUDED.parent_rule_code, sort_order = EXCLUDED.sort_order;

-- ═══════════════════════════════════════════════════════
-- Dispatch Rule-Domain Matrix (in/out relationships)
-- ═══════════════════════════════════════════════════════

INSERT INTO dispatch_rule_domain (rule_id, domain_code, relationship, create_by)
SELECT cr.id, d.domain_code,
  CASE
    WHEN cr.rule_code = 'INTERNAL'    AND d.domain_code = 'EA' THEN 'in'
    WHEN cr.rule_code = 'EXTERNAL'    AND d.domain_code = 'EA' THEN 'in'
    WHEN cr.rule_code = 'AI'          AND d.domain_code = 'RAI' THEN 'in'
    WHEN cr.rule_code = 'PII'         AND d.domain_code = 'DP' THEN 'in'
    WHEN cr.rule_code = 'OPEN_SOURCE' AND d.domain_code = 'OSC' THEN 'in'
    ELSE 'out'
  END,
  'system'
FROM dispatch_rule cr
CROSS JOIN domain_registry d
WHERE d.is_active = TRUE
ON CONFLICT (rule_id, domain_code) DO NOTHING;

-- EXTERNAL_USING -> DD domain (in) — only if DD domain exists
INSERT INTO dispatch_rule_domain (rule_id, domain_code, relationship, create_by)
SELECT dr.id, 'DD', 'in', 'system'
FROM dispatch_rule dr WHERE dr.rule_code = 'EXTERNAL_USING'
  AND EXISTS (SELECT 1 FROM domain_registry WHERE domain_code = 'DD')
ON CONFLICT (rule_id, domain_code) DO NOTHING;

-- ═══════════════════════════════════════════════════════
-- Dispatch Rule Exclusions (mutual exclusion relationships)
-- ═══════════════════════════════════════════════════════

INSERT INTO dispatch_rule_exclusion (rule_code, excluded_rule_code, create_by) VALUES
('INTERNAL_ONLY', 'EXTERNAL_USING', 'system'),
('EXTERNAL_USING', 'INTERNAL_ONLY', 'system')
ON CONFLICT (rule_code, excluded_rule_code) DO NOTHING;
