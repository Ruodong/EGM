"""Email notification utility for review action items.

Controlled by EGM_EMAIL_ENABLED env var (default: false).
When disabled, logs are created with status='skipped'.
"""
from __future__ import annotations

import os
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text


EMAIL_ENABLED = os.getenv("EGM_EMAIL_ENABLED", "false").lower() == "true"


async def send_action_notification(
    db: AsyncSession,
    action_id: str,
    email_type: str,
    recipient: str,
    recipient_email: str | None,
    subject: str,
) -> None:
    """Send an email notification and log the attempt.

    When EMAIL_ENABLED is False, simply logs with status='skipped'.
    """
    status = "skipped"
    error_message = None

    if EMAIL_ENABLED and recipient_email:
        # TODO: implement actual SMTP sending
        # For now, mark as skipped even when enabled (no SMTP configured)
        status = "skipped"
        error_message = "SMTP not configured"

    await db.execute(text("""
        INSERT INTO review_action_email_log
            (action_id, email_type, recipient, recipient_email, subject, status, error_message)
        VALUES (:action_id, :email_type, :recipient, :recipient_email, :subject, :status, :error)
    """), {
        "action_id": action_id,
        "email_type": email_type,
        "recipient": recipient,
        "recipient_email": recipient_email,
        "subject": subject,
        "status": status,
        "error": error_message,
    })
