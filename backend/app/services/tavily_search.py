"""Tavily web search integration for Ask EGM external knowledge retrieval.

When configured (TAVILY_API_KEY is set), the LLM can invoke a web_search tool
to fetch external information (regulations, standards, vendor info, etc.)
and use it for cross-validation during governance review analysis.
"""

from __future__ import annotations

import asyncio
import logging
from functools import lru_cache
from typing import Optional

from app.config import settings

logger = logging.getLogger(__name__)

# ── OpenAI tool definition (function calling schema) ────────────────────────

WEB_SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": (
            "Search the web for current information about technologies, vendors, "
            "compliance standards (GDPR, ISO 27001, SOC 2, etc.), regulations, "
            "industry best practices, or other external topics relevant to the "
            "governance review. Use this when the user asks about something that "
            "requires up-to-date external knowledge beyond the review context."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query in English for best results",
                },
            },
            "required": ["query"],
        },
    },
}


def is_tavily_configured() -> bool:
    """Check if Tavily API key is set."""
    return bool(settings.TAVILY_API_KEY)


@lru_cache(maxsize=1)
def _get_tavily_client():
    """Lazy-init Tavily client (cached)."""
    from tavily import TavilyClient

    return TavilyClient(api_key=settings.TAVILY_API_KEY)


def _search_sync(query: str, max_results: int) -> dict:
    """Synchronous Tavily search call (run in executor)."""
    client = _get_tavily_client()
    return client.search(
        query=query,
        search_depth="advanced",
        max_results=max_results,
        include_answer=False,
    )


async def tavily_search(
    query: str,
    max_results: Optional[int] = None,
) -> list[dict]:
    """Execute a Tavily web search asynchronously.

    Returns a list of results: [{title, url, content, score}]
    Runs the sync SDK in a thread executor to avoid blocking the event loop.
    """
    if not is_tavily_configured():
        return []

    n = max_results or settings.TAVILY_SEARCH_MAX_RESULTS

    try:
        loop = asyncio.get_event_loop()
        raw = await loop.run_in_executor(None, _search_sync, query, n)
    except Exception as e:
        logger.warning("Tavily search failed for query '%s': %s", query, e)
        return []

    results = []
    for r in raw.get("results", []):
        results.append({
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "content": (r.get("content") or "")[:800],  # limit per-result size
            "score": r.get("score", 0),
        })

    logger.info("Tavily search '%s' returned %d results", query, len(results))
    return results


def format_search_results_for_llm(results: list[dict]) -> str:
    """Format Tavily results as text for injection into LLM context."""
    if not results:
        return "No relevant web results found."

    parts = ["Here are the web search results:\n"]
    for i, r in enumerate(results, 1):
        parts.append(f"**[{i}] {r['title']}**")
        parts.append(f"URL: {r['url']}")
        parts.append(f"{r['content']}")
        parts.append("")

    parts.append(
        "Use these sources to answer the user's question. "
        "Cite sources using markdown links like [Source Title](url)."
    )
    return "\n".join(parts)
