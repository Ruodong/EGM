"""Legal Plugin — load claude-for-legal/commercial-legal skill prompts.

Vendored at .claude/plugins/claude-for-legal/. This service exposes the skill
SKILL.md content as system prompts so EGM's existing OpenAI-compatible LLM
client can produce a "legal pre-review" draft against a domain review's
governance context.

The vendored CLAUDE.md template is *not* a populated practice profile (it
still contains [PLACEHOLDER] markers), so for the PoC we run the equivalent
of the plugin's "provisional" mode — generic vendor-side review against
first-principles risks — and tag the output accordingly.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

# Repo root is three levels above this file: backend/app/services -> repo
PLUGIN_ROOT = Path(__file__).resolve().parents[3] / ".claude" / "plugins" / "claude-for-legal" / "commercial-legal"

# Skills used for the "review" entry-point. The /commercial-legal:review skill
# itself is a router that dispatches into these. For the PoC we inline the
# union of the most relevant ones into the system prompt.
REVIEW_SKILL_FILES = [
    "skills/review/SKILL.md",
    "skills/vendor-agreement-review/SKILL.md",
    "skills/saas-msa-review/SKILL.md",
    "skills/nda-review/SKILL.md",
    "skills/escalation-flagger/SKILL.md",
]

# Keep each skill bounded so the combined system prompt stays under a sane
# size — the LLM context budget is also carrying review/questionnaire data.
_MAX_PER_SKILL_CHARS = 6000
_MAX_PROFILE_CHARS = 4000


@lru_cache(maxsize=1)
def _load_skill_bundle() -> dict:
    """Read the vendored plugin files from disk once and cache the result.

    Returns dict with `profile`, `skills` (list of {name, body}), and
    `loaded_from` (path) for traceability.
    """
    if not PLUGIN_ROOT.exists():
        raise FileNotFoundError(
            f"claude-for-legal plugin not found at {PLUGIN_ROOT}. "
            "Vendor it under .claude/plugins/claude-for-legal/."
        )

    profile_path = PLUGIN_ROOT / "CLAUDE.md"
    profile_text = ""
    if profile_path.exists():
        profile_text = profile_path.read_text(encoding="utf-8")[:_MAX_PROFILE_CHARS]

    skills = []
    for rel in REVIEW_SKILL_FILES:
        p = PLUGIN_ROOT / rel
        if not p.exists():
            logger.warning("Legal skill file missing: %s", p)
            continue
        body = p.read_text(encoding="utf-8")[:_MAX_PER_SKILL_CHARS]
        skills.append({"name": rel, "body": body})

    return {
        "profile": profile_text,
        "skills": skills,
        "loaded_from": str(PLUGIN_ROOT),
    }


def get_loaded_skill_names() -> list[str]:
    """Return the list of skill files actually loaded — for the response payload."""
    return [s["name"] for s in _load_skill_bundle()["skills"]]


def build_legal_system_prompt() -> str:
    """Compose a system prompt from the vendored commercial-legal skill files.

    The prompt instructs the LLM to act as the /commercial-legal:review skill
    would, but adapted to EGM's "pre-review draft for a human reviewer"
    deliverable shape (memo + action items), and to run in PROVISIONAL mode
    since no populated practice profile is wired up yet.
    """
    bundle = _load_skill_bundle()
    parts: list[str] = []

    parts.append(
        "You are running the `/commercial-legal:review` workflow from Anthropic's "
        "`claude-for-legal` plugin, embedded inside EGM (Enterprise Governance Management) "
        "as an AI **pre-review draft generator** for a human domain reviewer.\n\n"
        "## What you produce\n"
        "A review memo the human reviewer can edit and adopt. The memo must contain:\n"
        "1. **Routing decision** — which sub-skill(s) you'd apply (vendor-agreement-review, "
        "saas-msa-review, nda-review) given the governance request context.\n"
        "2. **Deal-breaker / high-risk findings** — top issues from first-principles legal review.\n"
        "3. **Term-by-term concerns** — for each, the playbook position, the risk, and a "
        "concrete redline suggestion (specific language, not vague advice).\n"
        "4. **Suggested Action Items for EGM** — at the end, a JSON array under "
        "`### Suggested Action Items (JSON)` with shape "
        "`[{\"title\": str, \"description\": str, \"priority\": \"P0\"|\"P1\"|\"P2\"|\"P3\", "
        "\"actionType\": \"Question\"|\"Risk\"|\"Required Change\"}]`. The human reviewer can "
        "adopt these one by one into the domain review.\n\n"
        "## Provisional mode\n"
        "No practice profile is configured for this EGM deployment. Run in **PROVISIONAL mode**: "
        "use generic in-house-counsel defaults (US jurisdiction, middle risk appetite, "
        "purchasing-side assumption) and tag the memo header `[PROVISIONAL — practice profile "
        "not configured]`. Flag the common purchasing-side risks from first principles.\n\n"
        "## Output language\n"
        "Mirror the language of the governance request context. If the request is mostly "
        "Chinese, write the memo in Chinese; otherwise English.\n\n"
        "## Boundaries\n"
        "- This is a DRAFT for attorney review, not legal advice.\n"
        "- Do NOT invent contract terms that aren't in the provided context — if the request "
        "doesn't include the contract itself, restrict the memo to (a) the routing decision "
        "the reviewer should make and (b) the checklist of issues the reviewer should look for, "
        "based on the governance request answers about vendor/data/scope.\n"
        "- Surface jurisdiction assumptions explicitly.\n"
    )

    if bundle["profile"]:
        parts.append("---\n## Practice profile (template — not populated)\n")
        parts.append(bundle["profile"])

    for skill in bundle["skills"]:
        parts.append(f"\n---\n## Skill reference: {skill['name']}\n")
        parts.append(skill["body"])

    return "\n".join(parts)
