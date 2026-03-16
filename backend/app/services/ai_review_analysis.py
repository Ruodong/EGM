"""AI Review Analysis — 5-dimension automated domain review intelligence.

Dimensions:
  1. Risk Assessment — risk level, factors, recommended review depth
  2. Reference Cases — similar historical cases via RAG + outcome suggestion
  3. Consistency Analysis — contradiction detection within/across domains
  4. Completeness Analysis — information gap identification
  5. Accuracy Analysis — factual/technical error detection
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime
from typing import Optional

from openai import OpenAI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.utils.embeddings import find_similar_reviews

logger = logging.getLogger(__name__)

# ── LLM client ────────────────────────────────────────────────────────────────


def _get_llm_client() -> Optional[OpenAI]:
    """Return OpenAI-compatible client, or None if not configured."""
    if not settings.LLM_BASE_URL or not settings.LLM_API_KEY:
        return None
    return OpenAI(
        base_url=settings.LLM_BASE_URL,
        api_key=settings.LLM_API_KEY,
    )


def _llm_json_call_sync(client: OpenAI, system_prompt: str, user_content: str) -> Optional[dict]:
    """Call LLM with JSON output enforcement (sync). Returns parsed dict or None on failure."""
    try:
        resp = client.chat.completions.create(
            model=settings.LLM_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            temperature=0.3,
            max_tokens=4096,
            response_format={"type": "json_object"},
        )
        content = resp.choices[0].message.content
        return json.loads(content) if content else None
    except Exception as e:
        logger.error("LLM JSON call failed: %s", e)
        return None


async def _llm_json_call(client: OpenAI, system_prompt: str, user_content: str) -> Optional[dict]:
    """Async wrapper: runs sync LLM call in thread pool to avoid blocking event loop."""
    import asyncio
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _llm_json_call_sync, client, system_prompt, user_content)


# ── Context builder ───────────────────────────────────────────────────────────


async def _build_analysis_context(db: AsyncSession, domain_review_id: str) -> Optional[dict]:
    """Gather all context needed for analysis. Returns None if review not found."""

    # Review + request info
    row = (await db.execute(text("""
        SELECT dr.id, dr.domain_code, dr.status, dr.outcome,
               gr.id AS request_uuid, gr.request_id, gr.title AS gov_title,
               gr.project_name, gr.project_code, gr.project_proj_type,
               gr.project_description, gr.project_pm,
               gr.product_software_type, gr.product_end_user, gr.user_region,
               gr.third_party_vendor, gr.business_unit,
               gr.gov_project_type, gr.description AS gov_description,
               gr.requestor, gr.requestor_name,
               dn.domain_name
        FROM domain_review dr
        JOIN governance_request gr ON dr.request_id = gr.id
        LEFT JOIN domain_registry dn ON dr.domain_code = dn.domain_code
        WHERE dr.id = :rid
    """), {"rid": domain_review_id})).mappings().first()

    if not row:
        return None

    r = dict(row)
    request_uuid = str(r["request_uuid"])
    domain_code = r["domain_code"]

    # Questionnaire responses (this domain)
    q_rows = (await db.execute(text("""
        SELECT t.section, t.question_no, t.question_text, t.answer_type,
               rqr.answer, t.id AS template_id
        FROM request_questionnaire_response rqr
        JOIN domain_questionnaire_template t ON rqr.template_id = t.id
        WHERE rqr.request_id = :req_id
          AND rqr.domain_code = :dc
          AND t.is_active = TRUE
        ORDER BY t.sort_order, t.question_no
    """), {"req_id": request_uuid, "dc": domain_code})).mappings().all()

    # Parse QA pairs
    qa_pairs = []
    for q in q_rows:
        answer_data = q.get("answer")
        if isinstance(answer_data, str):
            try:
                answer_data = json.loads(answer_data)
            except (json.JSONDecodeError, TypeError):
                pass
        if isinstance(answer_data, dict):
            val = answer_data.get("value", "")
            if isinstance(val, list):
                val = ", ".join(val)
            other = answer_data.get("otherText", "")
            desc = answer_data.get("descriptionText", "")
            answer_str = str(val or "(no answer)")
            if other:
                answer_str += f" (Other: {other})"
            if desc:
                answer_str += f" — {desc}"
        else:
            answer_str = str(answer_data) if answer_data else "(no answer)"
        qa_pairs.append({
            "questionNo": q["question_no"],
            "questionText": q["question_text"],
            "section": q.get("section") or "General",
            "answer": answer_str,
            "answerType": q["answer_type"],
        })

    # Cross-domain questionnaire responses (for consistency analysis)
    cross_domain_qa = []
    other_q_rows = (await db.execute(text("""
        SELECT rqr.domain_code, t.section, t.question_no, t.question_text,
               rqr.answer, dn.domain_name
        FROM request_questionnaire_response rqr
        JOIN domain_questionnaire_template t ON rqr.template_id = t.id
        LEFT JOIN domain_registry dn ON rqr.domain_code = dn.domain_code
        WHERE rqr.request_id = :req_id
          AND rqr.domain_code != :dc
          AND t.is_active = TRUE
        ORDER BY rqr.domain_code, t.sort_order, t.question_no
    """), {"req_id": request_uuid, "dc": domain_code})).mappings().all()

    for q in other_q_rows:
        answer_data = q.get("answer")
        if isinstance(answer_data, str):
            try:
                answer_data = json.loads(answer_data)
            except (json.JSONDecodeError, TypeError):
                pass
        if isinstance(answer_data, dict):
            val = answer_data.get("value", "")
            if isinstance(val, list):
                val = ", ".join(val)
            answer_str = str(val or "(no answer)")
        else:
            answer_str = str(answer_data) if answer_data else "(no answer)"
        cross_domain_qa.append({
            "domainCode": q["domain_code"],
            "domainName": q.get("domain_name") or q["domain_code"],
            "questionNo": q["question_no"],
            "questionText": q["question_text"],
            "answer": answer_str,
        })

    return {
        "review": {
            "id": str(r["id"]),
            "domainCode": domain_code,
            "domainName": r.get("domain_name") or domain_code,
            "status": r["status"],
            "outcome": r.get("outcome"),
        },
        "request": {
            "requestId": r.get("request_id"),
            "title": r.get("gov_title"),
            "description": r.get("gov_description"),
            "projectName": r.get("project_name"),
            "projectType": r.get("project_proj_type") or r.get("gov_project_type"),
            "govProjectType": r.get("gov_project_type"),
            "businessUnit": r.get("business_unit"),
            "requestor": r.get("requestor_name") or r.get("requestor"),
            "projectManager": r.get("project_pm"),
            "softwareType": r.get("product_software_type"),
            "vendor": r.get("third_party_vendor"),
            "endUsers": r.get("product_end_user"),
            "regions": r.get("user_region"),
        },
        "questionnaire": qa_pairs,
        "crossDomainQuestionnaire": cross_domain_qa,
    }


def _build_context_text(ctx: dict) -> str:
    """Build a human-readable context string from the analysis context dict."""
    parts = []
    req = ctx["request"]
    rev = ctx["review"]

    parts.append(f"Domain: {rev['domainName']}")
    parts.append(f"Project: {req.get('projectName') or 'N/A'} ({req.get('govProjectType') or req.get('projectType') or 'N/A'})")
    parts.append(f"Description: {req.get('description') or 'N/A'}")
    parts.append(f"Business Unit: {req.get('businessUnit') or 'N/A'}")
    parts.append(f"Software Type: {req.get('softwareType') or 'N/A'}")
    if req.get("vendor"):
        parts.append(f"Vendor: {req['vendor']}")
    if req.get("endUsers"):
        eu = req["endUsers"]
        parts.append(f"End Users: {', '.join(eu) if isinstance(eu, list) else eu}")
    if req.get("regions"):
        ur = req["regions"]
        parts.append(f"Regions: {', '.join(ur) if isinstance(ur, list) else ur}")

    parts.append(f"\nQuestionnaire Responses ({rev['domainName']}):")
    current_section = None
    for qa in ctx["questionnaire"]:
        if qa["section"] != current_section:
            parts.append(f"\n  [{qa['section']}]")
            current_section = qa["section"]
        parts.append(f"  Q{qa['questionNo']}. {qa['questionText']}")
        parts.append(f"  A: {qa['answer']}")

    if ctx.get("crossDomainQuestionnaire"):
        parts.append("\nCross-Domain Questionnaire Responses:")
        current_domain = None
        for qa in ctx["crossDomainQuestionnaire"]:
            if qa["domainCode"] != current_domain:
                parts.append(f"\n  [{qa['domainName']}]")
                current_domain = qa["domainCode"]
            parts.append(f"  Q{qa['questionNo']}. {qa['questionText']}")
            parts.append(f"  A: {qa['answer']}")

    return "\n".join(parts)


def _compute_content_hash(ctx: dict) -> tuple[str, dict]:
    """Compute content hash and per-section hashes for change detection."""
    # Hash answers
    answers_str = json.dumps(ctx["questionnaire"], sort_keys=True, ensure_ascii=False)
    answers_hash = hashlib.sha256(answers_str.encode()).hexdigest()[:16]

    # Hash project info
    project_str = json.dumps(ctx["request"], sort_keys=True, ensure_ascii=False, default=str)
    project_hash = hashlib.sha256(project_str.encode()).hexdigest()[:16]

    # Hash cross-domain
    cross_str = json.dumps(ctx.get("crossDomainQuestionnaire", []), sort_keys=True, ensure_ascii=False)
    cross_hash = hashlib.sha256(cross_str.encode()).hexdigest()[:16]

    combined = f"{answers_hash}:{project_hash}:{cross_hash}"
    overall_hash = hashlib.sha256(combined.encode()).hexdigest()[:32]

    return overall_hash, {
        "answers": answers_hash,
        "project_info": project_hash,
        "cross_domain": cross_hash,
    }


def _detect_changed_dimensions(old_parts: dict, new_parts: dict) -> Optional[list[str]]:
    """Determine which dimensions need re-analysis based on what changed.
    Returns None if nothing changed (skip analysis entirely).
    Returns list of dimension names to re-run.
    """
    changed = set()

    if old_parts.get("answers") != new_parts.get("answers"):
        changed.update(["consistency_analysis", "completeness_analysis", "accuracy_analysis", "reference_cases"])

    if old_parts.get("project_info") != new_parts.get("project_info"):
        changed.update(["risk_assessment", "reference_cases"])

    if old_parts.get("cross_domain") != new_parts.get("cross_domain"):
        changed.add("consistency_analysis")

    # If answers changed, risk assessment may also be affected
    if old_parts.get("answers") != new_parts.get("answers"):
        changed.add("risk_assessment")

    return list(changed) if changed else None


# ── Dimension analyzers ───────────────────────────────────────────────────────

ALL_DIMENSIONS = [
    "risk_assessment", "reference_cases",
    "consistency_analysis", "completeness_analysis", "accuracy_analysis",
]


async def _analyze_risk(client: OpenAI, context_text: str, ctx: dict) -> Optional[dict]:
    """Dimension 1: Risk pre-assessment."""
    system_prompt = """You are an enterprise governance risk assessment expert.

Analyze the provided governance review context and assess the risk level.

Output JSON with this exact structure:
{
  "riskLevel": "HIGH" | "MEDIUM" | "LOW",
  "riskFactors": ["factor1", "factor2", ...],
  "recommendedDepth": "FULL" | "STANDARD" | "LITE",
  "estimatedEffort": "X-Y hours",
  "projectTypeNote": "Brief note about how the project type affects risk"
}

Rules:
- HIGH risk: PII/sensitive data, cross-border, external vendors without certification, regulatory compliance
- MEDIUM risk: Internal data, single-region, established vendor, moderate complexity
- LOW risk: PoC/prototype, non-production, no sensitive data, internal only
- Consider project type: PoC → generally lower risk; New → higher scrutiny; Existing Enhancement → moderate
- Be specific about risk factors, referencing actual questionnaire answers
- estimatedEffort should be realistic for a domain reviewer"""

    return await _llm_json_call(client, system_prompt, context_text)


async def _analyze_reference_cases(client: OpenAI, db: AsyncSession, context_text: str, ctx: dict) -> Optional[dict]:
    """Dimension 2: Similar historical cases via RAG."""
    domain_code = ctx["review"]["domainCode"]
    domain_review_id = ctx["review"]["id"]

    # Find similar reviews via embedding
    similar = []
    try:
        similar = await find_similar_reviews(
            db, domain_review_id, domain_code, context_text, top_k=5
        )
    except Exception as e:
        logger.warning("Reference case embedding search failed: %s", e)
        try:
            await db.rollback()
        except Exception:
            pass

    if not similar:
        return {
            "suggestedOutcome": None,
            "confidence": 0.0,
            "similarCases": [],
            "keyDifferences": [],
            "attentionPoints": [],
            "note": "No historical cases available for comparison in this domain."
        }

    # Enrich similar cases with request_id and outcome
    enriched_cases = []
    for s in similar:
        detail = (await db.execute(text("""
            SELECT dr.outcome, dr.status, gr.request_id, gr.project_name
            FROM domain_review dr
            JOIN governance_request gr ON dr.request_id = gr.id
            WHERE dr.id = :rid
        """), {"rid": s["domain_review_id"]})).mappings().first()
        if detail:
            enriched_cases.append({
                "domainReviewId": s["domain_review_id"],
                "requestId": detail["request_id"],
                "projectName": detail["project_name"],
                "outcome": detail["outcome"] or detail["status"],
                "similarity": s["similarity"],
                "contentSummary": s["content_summary"][:300],
            })

    # Build LLM prompt with cases
    cases_text = "\n\n".join([
        f"Case #{i+1} (similarity: {c['similarity']}):\n"
        f"  Request: {c['requestId']} - {c['projectName']}\n"
        f"  Outcome: {c['outcome']}\n"
        f"  Summary: {c['contentSummary']}"
        for i, c in enumerate(enriched_cases)
    ])

    system_prompt = """You are a governance review advisor analyzing historical precedents.

Compare the current review against similar historical cases and provide recommendations.

Output JSON with this exact structure:
{
  "suggestedOutcome": "Approved" | "Approved with Exception" | "Not Passed" | null,
  "confidence": 0.0-1.0,
  "similarCases": [
    {
      "index": 1,
      "keyDifference": "Brief description of key difference from current case"
    }
  ],
  "keyDifferences": ["Overall difference 1", "Overall difference 2"],
  "attentionPoints": ["Point requiring reviewer attention"]
}

Rules:
- Set suggestedOutcome to null if confidence < 0.6 or fewer than 3 completed cases
- Confidence should reflect how similar the cases truly are and how consistent their outcomes are
- Focus keyDifferences on factors that would change the review outcome
- attentionPoints should highlight areas where current case diverges from precedent
- Be conservative — when in doubt, lower confidence"""

    user_content = f"CURRENT REVIEW:\n{context_text}\n\nHISTORICAL CASES:\n{cases_text}"
    result = await _llm_json_call(client, system_prompt, user_content)

    if result:
        # Enforce confidence threshold
        if len(enriched_cases) < 3:
            result["suggestedOutcome"] = None
            result["confidence"] = min(result.get("confidence", 0), 0.5)
            result["note"] = "Fewer than 3 historical cases — suggestion withheld"
        elif result.get("confidence", 0) < 0.6:
            result["suggestedOutcome"] = None

        # Merge enriched case metadata
        for case in result.get("similarCases", []):
            idx = case.get("index", 1) - 1
            if 0 <= idx < len(enriched_cases):
                case["requestId"] = enriched_cases[idx]["requestId"]
                case["projectName"] = enriched_cases[idx]["projectName"]
                case["outcome"] = enriched_cases[idx]["outcome"]
                case["similarity"] = enriched_cases[idx]["similarity"]

    return result


async def _analyze_consistency(client: OpenAI, context_text: str, ctx: dict) -> Optional[dict]:
    """Dimension 3: Contradiction detection."""
    system_prompt = """You are an enterprise governance consistency auditor.

Check the provided questionnaire responses for logical contradictions and inconsistencies.

Check three layers:
1. Intra-domain: contradictions within the same domain's answers
2. Cross-domain: contradictions between different domains' answers
3. Vs-description: answers that contradict the project description/metadata

Output JSON with this exact structure:
{
  "contradictions": [
    {
      "type": "intra_domain" | "cross_domain" | "vs_description",
      "severity": "HIGH" | "MEDIUM" | "LOW",
      "questionRefs": ["Q3", "Q7"],
      "description": "Clear description of the contradiction",
      "suggestedClarification": "Question to ask the requestor to resolve this"
    }
  ],
  "overallScore": 0.0-1.0
}

Rules:
- Only report genuine logical contradictions, not just incomplete information
- HIGH: Directly impacts risk judgment (e.g., PII claim vs data source contradiction)
- MEDIUM: Needs clarification but may have reasonable explanation
- LOW: Imprecise wording that might not be an actual contradiction
- overallScore: 1.0 = fully consistent, 0.0 = severely contradictory
- If no contradictions found, return empty array with overallScore: 1.0
- Never fabricate contradictions — it's OK to find none"""

    return await _llm_json_call(client, system_prompt, context_text)


async def _analyze_completeness(client: OpenAI, context_text: str, ctx: dict) -> Optional[dict]:
    """Dimension 4: Information gap identification."""
    project_type = ctx["request"].get("govProjectType") or ctx["request"].get("projectType") or "Unknown"

    system_prompt = f"""You are an enterprise governance completeness auditor.

Evaluate whether the questionnaire responses provide sufficient information for a governance reviewer to make a decision.

The project type is: {project_type}
- PoC: Lower information requirements; focus on data safety and scope containment
- New: Full information requirements across all governance dimensions
- Existing Enhancement: Focus on what's changing; existing baseline assumed

Output JSON with this exact structure:
{{
  "perQuestion": [
    {{
      "questionNo": "Q3",
      "quality": "SUFFICIENT" | "BRIEF" | "INADEQUATE",
      "missingDetails": ["detail1", "detail2"],
      "suggestedFollowup": "Follow-up question for the requestor"
    }}
  ],
  "informationGaps": [
    {{
      "topic": "Data Retention Policy",
      "importance": "HIGH" | "MEDIUM" | "LOW",
      "reason": "Why this information is needed",
      "suggestedQuestion": "Question to add or ask"
    }}
  ],
  "completenessScore": 0.0-1.0
}}

Rules:
- Only include perQuestion entries for BRIEF or INADEQUATE answers (omit SUFFICIENT)
- BRIEF: Has an answer but lacks critical details for governance judgment
- INADEQUATE: Answer does not substantively address the question
- informationGaps: Topics NOT covered by any existing question but needed for this project type
- Adjust expectations based on project type (PoC needs less than New)
- completenessScore: 1.0 = fully complete, 0.0 = severely lacking
- Be practical — don't demand information that's unreasonable for the project type"""

    return await _llm_json_call(client, system_prompt, context_text)


async def _analyze_accuracy(client: OpenAI, context_text: str, ctx: dict) -> Optional[dict]:
    """Dimension 5: Factual/technical error detection."""
    system_prompt = """You are a technical accuracy reviewer for enterprise governance.

Check the provided responses for objectively verifiable factual or technical errors.

Output JSON with this exact structure:
{
  "factualIssues": [
    {
      "questionNo": "Q5",
      "claim": "The specific claim made",
      "issue": "Why this is factually incorrect",
      "severity": "HIGH" | "MEDIUM" | "LOW",
      "type": "technical_error" | "standard_mismatch" | "terminology_error"
    }
  ],
  "plausibilityConcerns": [
    {
      "description": "Description of the concern",
      "type": "scale_mismatch" | "timeline_concern" | "cost_estimate"
    }
  ]
}

Rules:
- ONLY flag objectively verifiable errors (wrong algorithm names, impossible specifications, etc.)
- Do NOT flag subjective judgments, opinions, or future plans
- Do NOT flag incomplete information (that's the completeness dimension's job)
- Do NOT use words like "dishonest" or "false" — use "may need verification"
- plausibilityConcerns are softer flags for things that seem unlikely but aren't provably wrong
- It is PERFECTLY OK to return empty arrays if no issues are found
- Prefer false negatives over false positives — only flag high-confidence issues"""

    return await _llm_json_call(client, system_prompt, context_text)


# ── Orchestrator ──────────────────────────────────────────────────────────────


async def run_analysis(
    db: AsyncSession,
    domain_review_id: str,
    trigger_event: str,
    trigger_by: str,
    dimensions: Optional[list[str]] = None,
) -> dict:
    """Main entry point: run AI analysis for a domain review.

    Returns the analysis record dict.
    """
    client = _get_llm_client()
    if not client:
        raise RuntimeError("LLM not configured")

    # 1. Build context
    ctx = await _build_analysis_context(db, domain_review_id)
    if not ctx:
        raise ValueError(f"Domain review not found: {domain_review_id}")

    context_text = _build_context_text(ctx)
    content_hash, hash_parts = _compute_content_hash(ctx)

    # 2. Determine version and changed dimensions
    prev = (await db.execute(text("""
        SELECT version, content_hash, changed_dimensions,
               risk_assessment, reference_cases,
               consistency_analysis, completeness_analysis, accuracy_analysis
        FROM ai_review_analysis
        WHERE domain_review_id = :rid AND status = 'completed'
        ORDER BY version DESC LIMIT 1
    """), {"rid": domain_review_id})).mappings().first()

    new_version = (prev["version"] + 1) if prev else 1
    changed_dims = None  # None = all dimensions

    if prev and prev["content_hash"]:
        # Parse previous hash parts from stored hash
        # Previous hash parts are not stored separately, so re-analyze based on full hash comparison
        if prev["content_hash"] == content_hash:
            # Nothing changed — skip analysis entirely
            return {
                "analysisId": None,
                "version": prev["version"],
                "status": "no_change",
                "message": "Content unchanged since last analysis",
            }
        # Content changed — run all dimensions for simplicity on version > 1
        # (In future, could store hash_parts for granular change detection)
        changed_dims = dimensions or ALL_DIMENSIONS
    else:
        changed_dims = dimensions or ALL_DIMENSIONS

    # 3. Create pending record
    row = (await db.execute(text("""
        INSERT INTO ai_review_analysis
            (domain_review_id, version, trigger_event, trigger_by, status,
             content_hash, changed_dimensions, started_at)
        VALUES (:rid, :ver, :event, :by, 'running', :hash, :dims, NOW())
        RETURNING id
    """), {
        "rid": domain_review_id,
        "ver": new_version,
        "event": trigger_event,
        "by": trigger_by,
        "hash": content_hash,
        "dims": changed_dims,
    })).mappings().first()
    await db.commit()

    analysis_id = str(row["id"])

    # 4. Run each dimension
    try:
        results = {}

        if "risk_assessment" in changed_dims:
            results["risk_assessment"] = await _analyze_risk(client, context_text, ctx)
        elif prev:
            results["risk_assessment"] = prev["risk_assessment"]

        if "reference_cases" in changed_dims:
            results["reference_cases"] = await _analyze_reference_cases(client, db, context_text, ctx)
        elif prev:
            results["reference_cases"] = prev["reference_cases"]

        if "consistency_analysis" in changed_dims:
            results["consistency_analysis"] = await _analyze_consistency(client, context_text, ctx)
        elif prev:
            results["consistency_analysis"] = prev["consistency_analysis"]

        if "completeness_analysis" in changed_dims:
            results["completeness_analysis"] = await _analyze_completeness(client, context_text, ctx)
        elif prev:
            results["completeness_analysis"] = prev["completeness_analysis"]

        if "accuracy_analysis" in changed_dims:
            results["accuracy_analysis"] = await _analyze_accuracy(client, context_text, ctx)
        elif prev:
            results["accuracy_analysis"] = prev["accuracy_analysis"]

        # 5. Compute overall score
        scores = []
        if results.get("consistency_analysis") and isinstance(results["consistency_analysis"], dict):
            s = results["consistency_analysis"].get("overallScore")
            if s is not None:
                scores.append(float(s))
        if results.get("completeness_analysis") and isinstance(results["completeness_analysis"], dict):
            s = results["completeness_analysis"].get("completenessScore")
            if s is not None:
                scores.append(float(s))
        # Risk contributes inversely
        risk_map = {"LOW": 1.0, "MEDIUM": 0.6, "HIGH": 0.3}
        if results.get("risk_assessment") and isinstance(results["risk_assessment"], dict):
            rl = results["risk_assessment"].get("riskLevel", "").upper()
            if rl in risk_map:
                scores.append(risk_map[rl])

        overall_score = round(sum(scores) / len(scores), 2) if scores else None

        # 6. Build summary
        summary_parts = []
        if results.get("risk_assessment") and isinstance(results["risk_assessment"], dict):
            rl = results["risk_assessment"].get("riskLevel", "N/A")
            summary_parts.append(f"Risk: {rl}")
        if results.get("consistency_analysis") and isinstance(results["consistency_analysis"], dict):
            contradictions = results["consistency_analysis"].get("contradictions", [])
            high_count = sum(1 for c in contradictions if c.get("severity") == "HIGH")
            if high_count:
                summary_parts.append(f"{high_count} high-severity contradiction(s)")
            elif contradictions:
                summary_parts.append(f"{len(contradictions)} minor inconsistency(ies)")
            else:
                summary_parts.append("No contradictions")
        if results.get("completeness_analysis") and isinstance(results["completeness_analysis"], dict):
            gaps = results["completeness_analysis"].get("informationGaps", [])
            high_gaps = sum(1 for g in gaps if g.get("importance") == "HIGH")
            if high_gaps:
                summary_parts.append(f"{high_gaps} critical information gap(s)")
        if results.get("accuracy_analysis") and isinstance(results["accuracy_analysis"], dict):
            issues = results["accuracy_analysis"].get("factualIssues", [])
            if issues:
                summary_parts.append(f"{len(issues)} factual issue(s)")
        if results.get("reference_cases") and isinstance(results["reference_cases"], dict):
            suggested = results["reference_cases"].get("suggestedOutcome")
            conf = results["reference_cases"].get("confidence", 0)
            if suggested:
                summary_parts.append(f"Suggested outcome: {suggested} ({conf:.0%})")

        summary = ". ".join(summary_parts) + "." if summary_parts else None

        # 7. Update record
        await db.execute(text("""
            UPDATE ai_review_analysis SET
                status = 'completed',
                risk_assessment = :ra,
                reference_cases = :rc,
                consistency_analysis = :ca,
                completeness_analysis = :cpa,
                accuracy_analysis = :aa,
                overall_score = :score,
                summary = :summary,
                completed_at = NOW()
            WHERE id = :id
        """), {
            "id": analysis_id,
            "ra": json.dumps(results.get("risk_assessment")) if results.get("risk_assessment") else None,
            "rc": json.dumps(results.get("reference_cases")) if results.get("reference_cases") else None,
            "ca": json.dumps(results.get("consistency_analysis")) if results.get("consistency_analysis") else None,
            "cpa": json.dumps(results.get("completeness_analysis")) if results.get("completeness_analysis") else None,
            "aa": json.dumps(results.get("accuracy_analysis")) if results.get("accuracy_analysis") else None,
            "score": overall_score,
            "summary": summary,
        })
        await db.commit()

        return {
            "analysisId": analysis_id,
            "version": new_version,
            "status": "completed",
            "changedDimensions": changed_dims,
            "overallScore": overall_score,
            "summary": summary,
        }

    except Exception as e:
        logger.error("AI analysis failed for %s: %s", domain_review_id, e, exc_info=True)
        try:
            await db.rollback()
        except Exception:
            pass
        try:
            await db.execute(text("""
                UPDATE ai_review_analysis SET
                    status = 'failed', error_message = :err, completed_at = NOW()
                WHERE id = :id
            """), {"id": analysis_id, "err": str(e)[:500]})
            await db.commit()
        except Exception as db_err:
            logger.error("Failed to record analysis error: %s", db_err)
        return {
            "analysisId": analysis_id,
            "version": new_version,
            "status": "failed",
            "error": str(e),
        }
