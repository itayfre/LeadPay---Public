"""
Email service — Resend provider with stub mode.

Stub mode (no RESEND_API_KEY configured): logs the would-be send and returns
a mock success.

Live mode: POSTs to api.resend.com/emails.
Docs: https://resend.com/docs/api-reference/emails/send-email
"""

from __future__ import annotations

import logging
import os
import uuid
from dataclasses import dataclass
from typing import List, Optional

import httpx

logger = logging.getLogger(__name__)


@dataclass
class EmailResult:
    """One outbound email attempt."""
    recipient: str
    success: bool
    provider_message_id: Optional[str] = None
    error: Optional[str] = None


class ResendClient:
    API_URL = "https://api.resend.com/emails"
    TIMEOUT_SECONDS = 30

    def __init__(self) -> None:
        self.api_key: Optional[str] = os.getenv("RESEND_API_KEY")
        self.from_email: str = os.getenv("RESEND_FROM_EMAIL", "LeadPay <onboarding@resend.dev>")
        self.is_stub = not self.api_key
        if self.is_stub:
            logger.info("ResendClient: stub mode — no RESEND_API_KEY configured")

    def send(
        self,
        to: str,
        subject: str,
        html: str,
        text: Optional[str] = None,
    ) -> EmailResult:
        """Send a single email."""
        if self.is_stub:
            return self._stub_send(to, subject, html)
        return self._live_send(to, subject, html, text)

    def send_bulk(
        self,
        recipients: List[dict],
    ) -> List[EmailResult]:
        """Send a list of personalized emails.

        Args:
            recipients: list of {'to': str, 'subject': str, 'html': str, 'text': str?}

        Resend doesn't have a true bulk endpoint with personalization — we loop.
        For ≤ ~100 emails this is fine. For larger batches, switch to a batch
        provider (or chunk with sleeps).
        """
        results = []
        for r in recipients:
            results.append(
                self.send(
                    to=r["to"],
                    subject=r["subject"],
                    html=r["html"],
                    text=r.get("text"),
                )
            )
        return results

    # ── Live path ─────────────────────────────────────────────────────────

    def _live_send(
        self,
        to: str,
        subject: str,
        html: str,
        text: Optional[str],
    ) -> EmailResult:
        body = {
            "from": self.from_email,
            "to": [to],
            "subject": subject,
            "html": html,
        }
        if text:
            body["text"] = text

        try:
            with httpx.Client(timeout=self.TIMEOUT_SECONDS) as client:
                resp = client.post(
                    self.API_URL,
                    json=body,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                )
        except httpx.HTTPError as e:
            logger.error("ResendClient: HTTP error %s", e)
            return EmailResult(recipient=to, success=False, error=f"HTTP error: {e}")

        if resp.status_code in (200, 201):
            try:
                data = resp.json()
                return EmailResult(
                    recipient=to,
                    success=True,
                    provider_message_id=data.get("id"),
                )
            except Exception as e:
                return EmailResult(
                    recipient=to,
                    success=True,
                    error=f"sent but malformed response: {e}",
                )

        # Failure path
        try:
            err = resp.json().get("message", resp.text[:200])
        except Exception:
            err = resp.text[:200]
        logger.error("ResendClient: send failed status=%s err=%s", resp.status_code, err)
        return EmailResult(recipient=to, success=False, error=f"HTTP {resp.status_code}: {err}")

    # ── Stub path ─────────────────────────────────────────────────────────

    def _stub_send(self, to: str, subject: str, html: str) -> EmailResult:
        logger.info(
            "[EMAIL STUB] Would send to %s — subject: %s (html %d chars)",
            to, subject, len(html),
        )
        return EmailResult(
            recipient=to,
            success=True,
            provider_message_id=f"stub-{uuid.uuid4().hex[:12]}",
        )
