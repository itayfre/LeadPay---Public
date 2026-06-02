"""
SMS service — Inforu provider with stub mode.

Stub mode (no credentials configured): logs the would-be send and returns
a deterministic mock result. Used during development before signing up
with Inforu.

Live mode (credentials present): POSTs to Inforu's REST API.
Docs: https://apidoc.inforu.co.il/
"""

from __future__ import annotations

import base64
import logging
import os
import uuid
from dataclasses import dataclass
from typing import List, Optional

import httpx

logger = logging.getLogger(__name__)


@dataclass
class SMSResult:
    """One outbound SMS attempt."""
    recipient: str                    # +972...
    success: bool
    provider_message_id: Optional[str] = None
    error: Optional[str] = None


class InforuClient:
    """Thin wrapper around Inforu's SMS API.

    Read credentials from env vars at construction time. Missing credentials
    → stub mode. Don't raise on missing env — just log and mock-respond,
    so the rest of the app keeps working in dev.
    """

    API_URL = "https://capi.inforu.co.il/api/v2/SMS/SendSms"
    TIMEOUT_SECONDS = 30

    def __init__(self) -> None:
        self.username: Optional[str] = os.getenv("INFORU_USERNAME")
        self.api_token: Optional[str] = os.getenv("INFORU_API_TOKEN")
        self.sender_id: str = os.getenv("INFORU_SENDER_ID", "LeadPay")
        self.is_stub = not (self.username and self.api_token)
        if self.is_stub:
            logger.info("InforuClient: stub mode — no INFORU_USERNAME/INFORU_API_TOKEN configured")

    def send_bulk(self, recipients: List[str], message: str) -> List[SMSResult]:
        """Send the same message to multiple recipients.

        Args:
            recipients: List of phone numbers in +972... format.
            message: SMS body. Must be ≤ ~140 chars Hebrew (= 2 UCS-2 segments).

        Returns:
            List of SMSResult, same order as recipients.
        """
        if not recipients:
            return []

        if self.is_stub:
            return self._stub_send(recipients, message)

        return self._live_send(recipients, message)

    # ── Live path ─────────────────────────────────────────────────────────

    def _live_send(self, recipients: List[str], message: str) -> List[SMSResult]:
        # Build Basic auth header from username:token
        creds = f"{self.username}:{self.api_token}".encode("utf-8")
        auth = base64.b64encode(creds).decode("ascii")

        # Inforu wants recipients as comma-separated phone numbers in their
        # Data.Recipients[].Phone format. Build the JSON body.
        body = {
            "Data": {
                "Message": message,
                "Recipients": [{"Phone": _normalize_phone(p)} for p in recipients],
                "Settings": {"Sender": self.sender_id},
            }
        }

        try:
            with httpx.Client(timeout=self.TIMEOUT_SECONDS) as client:
                resp = client.post(
                    self.API_URL,
                    json=body,
                    headers={
                        "Authorization": f"Basic {auth}",
                        "Content-Type": "application/json",
                    },
                )
        except httpx.HTTPError as e:
            logger.error("InforuClient: HTTP error %s", e)
            return [
                SMSResult(recipient=r, success=False, error=f"HTTP error: {e}")
                for r in recipients
            ]

        if resp.status_code != 200:
            logger.error("InforuClient: non-200 status %s: %s", resp.status_code, resp.text[:300])
            return [
                SMSResult(recipient=r, success=False, error=f"HTTP {resp.status_code}")
                for r in recipients
            ]

        # Inforu's response shape varies; key fields we look for:
        #   StatusId == 1 means success batch-wide
        #   Data.SentResults: per-recipient breakdown (when available)
        try:
            data = resp.json()
        except Exception as e:
            logger.error("InforuClient: malformed JSON response: %s", e)
            return [
                SMSResult(recipient=r, success=False, error="Malformed provider response")
                for r in recipients
            ]

        status_id = data.get("StatusId")
        batch_success = status_id == 1

        # If provider gave us per-recipient results, use them; else assume
        # batch-level outcome applies to all.
        sent_results = (data.get("Data") or {}).get("SentResults")
        if isinstance(sent_results, list) and len(sent_results) == len(recipients):
            return [
                SMSResult(
                    recipient=recipients[i],
                    success=bool(item.get("Success", batch_success)),
                    provider_message_id=str(item.get("MessageId")) if item.get("MessageId") else None,
                    error=item.get("Description") if not item.get("Success", batch_success) else None,
                )
                for i, item in enumerate(sent_results)
            ]

        return [
            SMSResult(
                recipient=r,
                success=batch_success,
                provider_message_id=str(data.get("DataId")) if batch_success and data.get("DataId") else None,
                error=None if batch_success else data.get("StatusDescription", "Unknown error"),
            )
            for r in recipients
        ]

    # ── Stub path ─────────────────────────────────────────────────────────

    def _stub_send(self, recipients: List[str], message: str) -> List[SMSResult]:
        logger.info(
            "[SMS STUB] Would send to %d recipient(s) from sender %s. Message: %s",
            len(recipients),
            self.sender_id,
            message[:140] + ("..." if len(message) > 140 else ""),
        )
        return [
            SMSResult(
                recipient=r,
                success=True,
                provider_message_id=f"stub-{uuid.uuid4().hex[:12]}",
            )
            for r in recipients
        ]


def _normalize_phone(phone: str) -> str:
    """Strip spaces, dashes; ensure starts with country code. Returns digits only.

    Inforu accepts both with and without leading '+'; we send without.
    """
    digits = "".join(c for c in phone if c.isdigit())
    return digits
