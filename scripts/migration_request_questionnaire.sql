-- Create request_questionnaire_response table for pre-submit domain questionnaire answers
CREATE TABLE IF NOT EXISTS request_questionnaire_response (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID NOT NULL REFERENCES governance_request(id) ON DELETE CASCADE,
    template_id     UUID NOT NULL REFERENCES domain_questionnaire_template(id),
    domain_code     VARCHAR NOT NULL,
    answer          JSONB,
    create_at       TIMESTAMPTZ DEFAULT NOW(),
    update_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(request_id, template_id)
);
