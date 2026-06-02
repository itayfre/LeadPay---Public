"""
Reminder Message Templates
---------------------------

Per-channel and per-language templates used by the new SendRemindersModal flow.
Three channels: WHATSAPP_LINK (rich formatting), SMS (≤140 chars, opt-out), EMAIL (HTML).

The existing WhatsAppService templates are richer and stay where they are for the
legacy single-tenant "Generate Reminders" endpoint. These templates are scoped
to the new bulk-send flow.

Placeholders use Python str.format() syntax: {tenant_name}, {apartment_number},
{building_name}, {amount}, {period}, {city}.
"""
from __future__ import annotations

from typing import Dict


# ─────────────────────────────────────────────────────────────────────────────
# WhatsApp templates (rich — emoji, line breaks, no length limit)
# ─────────────────────────────────────────────────────────────────────────────

WHATSAPP_TEMPLATES: Dict[str, Dict[str, str]] = {
    "he": {
        "standard": (
            "שלום {tenant_name},\n"
            "תזכורת לתשלום ועד הבית.\n\n"
            "🏠 דירה: {apartment_number}\n"
            "💰 סכום: ₪{amount}\n"
            "📅 תקופה: {period}\n\n"
            "תודה,\nועד הבית — {building_name}"
        ),
        "late": (
            "שלום {tenant_name},\n"
            "שים לב — התשלום עבור {period} עדיין לא התקבל.\n\n"
            "🏠 דירה: {apartment_number}\n"
            "💰 סכום: ₪{amount}\n\n"
            "אנא הסדר/י בהקדם.\n\n"
            "תודה,\nועד הבית — {building_name}"
        ),
    },
    "en": {
        "standard": (
            "Hello {tenant_name},\n"
            "Friendly reminder for building maintenance payment.\n\n"
            "🏠 Apartment: {apartment_number}\n"
            "💰 Amount: ₪{amount}\n"
            "📅 Period: {period}\n\n"
            "Thank you,\nHouse Committee — {building_name}"
        ),
        "late": (
            "Hello {tenant_name},\n"
            "Please note — payment for {period} has not yet been received.\n\n"
            "🏠 Apartment: {apartment_number}\n"
            "💰 Amount: ₪{amount}\n\n"
            "Please settle as soon as possible.\n\n"
            "Thank you,\nHouse Committee — {building_name}"
        ),
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# SMS templates (≤140 chars Hebrew = 2 UCS-2 segments max; ends with opt-out)
# ─────────────────────────────────────────────────────────────────────────────

SMS_TEMPLATES: Dict[str, Dict[str, str]] = {
    "he": {
        "standard": (
            "שלום {tenant_name}, תזכורת לתשלום ₪{amount} עבור {period} "
            "(דירה {apartment_number}). תודה, ועד {building_name}. להסרה השב 'הסר'."
        ),
        "late": (
            "{tenant_name}, התשלום עבור {period} (₪{amount}) באיחור. "
            "אנא הסדר/י בהקדם. ועד {building_name}. להסרה השב 'הסר'."
        ),
    },
    "en": {
        "standard": (
            "Hi {tenant_name}, reminder to pay ₪{amount} for {period} "
            "(apt {apartment_number}). - {building_name}. Reply STOP to opt out."
        ),
        "late": (
            "{tenant_name}, payment for {period} (₪{amount}) is overdue. "
            "Please settle soon. - {building_name}. Reply STOP to opt out."
        ),
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# Email templates (HTML with RTL support, brand styling)
# ─────────────────────────────────────────────────────────────────────────────

EMAIL_SUBJECTS: Dict[str, Dict[str, str]] = {
    "he": {
        "standard": "תזכורת תשלום — {building_name}, {period}",
        "late": "תשלום באיחור — {building_name}, {period}",
    },
    "en": {
        "standard": "Payment reminder — {building_name}, {period}",
        "late": "Overdue payment — {building_name}, {period}",
    },
}


_EMAIL_HTML_HE = """<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f3ee;font-family:Heebo,Assistant,Arial,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f3ee;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background:#ffffff;border:1px solid #e6e3dc;border-radius:14px;overflow:hidden;">
        <tr><td style="background:#2d5b4e;color:#ffffff;padding:18px 24px;font-size:16px;font-weight:700;">
          🏢 LeadPay — {building_name}
        </td></tr>
        <tr><td style="padding:24px;">
          <p style="margin:0 0 14px;font-size:16px;">שלום {tenant_name},</p>
          <p style="margin:0 0 18px;font-size:14.5px;line-height:1.6;">{intro_line}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fafaf7;border-radius:10px;margin:6px 0 18px;">
            <tr><td style="padding:14px 18px;font-size:14px;">
              <div style="margin-bottom:6px;"><strong>דירה:</strong> {apartment_number}</div>
              <div style="margin-bottom:6px;"><strong>סכום:</strong> ₪{amount}</div>
              <div><strong>תקופה:</strong> {period}</div>
            </td></tr>
          </table>
          <p style="margin:0 0 6px;font-size:13.5px;color:#6b6b6b;">תודה,<br/>ועד הבית — {building_name}</p>
        </td></tr>
        <tr><td style="background:#fafaf7;padding:12px 24px;font-size:11.5px;color:#9a9a9a;border-top:1px solid #efece5;">
          הודעה אוטומטית מ-LeadPay. אם קיבלת זאת בטעות, אפשר להתעלם.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


_EMAIL_HTML_EN = """<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f3ee;font-family:Arial,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f3ee;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background:#ffffff;border:1px solid #e6e3dc;border-radius:14px;overflow:hidden;">
        <tr><td style="background:#2d5b4e;color:#ffffff;padding:18px 24px;font-size:16px;font-weight:700;">
          🏢 LeadPay — {building_name}
        </td></tr>
        <tr><td style="padding:24px;">
          <p style="margin:0 0 14px;font-size:16px;">Hello {tenant_name},</p>
          <p style="margin:0 0 18px;font-size:14.5px;line-height:1.6;">{intro_line}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fafaf7;border-radius:10px;margin:6px 0 18px;">
            <tr><td style="padding:14px 18px;font-size:14px;">
              <div style="margin-bottom:6px;"><strong>Apartment:</strong> {apartment_number}</div>
              <div style="margin-bottom:6px;"><strong>Amount:</strong> ₪{amount}</div>
              <div><strong>Period:</strong> {period}</div>
            </td></tr>
          </table>
          <p style="margin:0 0 6px;font-size:13.5px;color:#6b6b6b;">Thank you,<br/>House Committee — {building_name}</p>
        </td></tr>
        <tr><td style="background:#fafaf7;padding:12px 24px;font-size:11.5px;color:#9a9a9a;border-top:1px solid #efece5;">
          Automated message from LeadPay. If received in error, please ignore.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


EMAIL_INTRO_LINES: Dict[str, Dict[str, str]] = {
    "he": {
        "standard": "זוהי תזכורת ידידותית לתשלום דמי ועד הבית.",
        "late": "שים/שימי לב — התשלום עדיין לא התקבל. אנא הסדר/י בהקדם האפשרי.",
    },
    "en": {
        "standard": "This is a friendly reminder for the building maintenance payment.",
        "late": "Please note — the payment has not been received yet. Kindly settle as soon as possible.",
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# Public renderer — call this from messaging_service
# ─────────────────────────────────────────────────────────────────────────────

def render(
    channel: str,
    template_id: str,
    language: str,
    *,
    tenant_name: str,
    apartment_number: int,
    building_name: str,
    amount: float,
    period: str,
    custom_text: str | None = None,
) -> dict:
    """
    Render a message for the given channel + language + template.

    Returns a dict:
      {"text": str}                                — for SMS / WHATSAPP_LINK
      {"subject": str, "html": str, "text": str}   — for EMAIL

    `custom_text` (if provided and template_id == 'custom') is used verbatim
    for SMS/WhatsApp. For email, it goes into the body; the subject defaults
    to the standard subject.

    Placeholders supported in custom_text: {tenant_name}, {apartment_number},
    {building_name}, {amount}, {period}.
    """
    lang = language if language in ("he", "en") else "he"
    tpl_id = template_id if template_id in ("standard", "late", "custom") else "standard"

    fmt = dict(
        tenant_name=tenant_name,
        apartment_number=apartment_number,
        building_name=building_name,
        amount=f"{amount:.0f}",
        period=period,
    )

    if tpl_id == "custom" and custom_text:
        try:
            text = custom_text.format(**fmt)
        except (KeyError, IndexError):
            # If user typed an unknown placeholder, fall back to raw text
            text = custom_text
    else:
        if channel == "EMAIL":
            text = ""  # built below from HTML template
        elif channel == "SMS":
            text = SMS_TEMPLATES[lang][tpl_id].format(**fmt)
        else:  # WHATSAPP_LINK
            text = WHATSAPP_TEMPLATES[lang][tpl_id].format(**fmt)

    if channel == "EMAIL":
        subject_tpl = EMAIL_SUBJECTS[lang].get(tpl_id, EMAIL_SUBJECTS[lang]["standard"])
        subject = subject_tpl.format(**fmt)

        intro = EMAIL_INTRO_LINES[lang].get(tpl_id, EMAIL_INTRO_LINES[lang]["standard"])
        html_tpl = _EMAIL_HTML_HE if lang == "he" else _EMAIL_HTML_EN

        if tpl_id == "custom" and custom_text:
            # Custom body — render as plain text inside the styled wrapper,
            # converting newlines to <br> for readability.
            safe_body = (
                custom_text.format(**fmt)
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\n", "<br/>")
            )
            html = html_tpl.format(**fmt, intro_line=safe_body)
            text = custom_text.format(**fmt)
        else:
            html = html_tpl.format(**fmt, intro_line=intro)
            # Plain-text fallback for clients that don't render HTML
            text = WHATSAPP_TEMPLATES[lang][tpl_id].format(**fmt)

        return {"subject": subject, "html": html, "text": text}

    return {"text": text}


def count_sms_segments(text: str) -> int:
    """Hebrew SMS = UCS-2 = 70 chars per segment. Latin = 160 chars per segment.
    Simple heuristic: if any non-ASCII character is present, treat as UCS-2."""
    if not text:
        return 1
    if any(ord(c) > 127 for c in text):
        return max(1, -(-len(text) // 70))  # ceil division
    return max(1, -(-len(text) // 160))
