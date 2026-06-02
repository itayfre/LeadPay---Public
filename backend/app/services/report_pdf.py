"""
PDF renderer — converts a report payload dict into PDF bytes using
WeasyPrint + Jinja2. The same template is used for local dev and Railway.
Fonts are bundled in app/static/fonts/ so no network access is needed.

WeasyPrint requires system libraries (GLib/Pango/Cairo). It is imported
lazily so the server starts even if those libs are missing; the PDF
endpoint will return a 503 in that case rather than crashing on startup.
"""
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

_BASE = Path(__file__).resolve().parent.parent
_TEMPLATES = _BASE / "templates"
_FONTS = _BASE / "static" / "fonts"

_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATES)),
    autoescape=select_autoescape(["html", "xml"]),
)


def render_report_pdf(payload: dict) -> bytes:
    try:
        from weasyprint import HTML
    except OSError as exc:
        raise RuntimeError(
            "WeasyPrint system libraries (GLib/Pango/Cairo) are not available "
            "in this environment. PDF export is unavailable."
        ) from exc
    template = _env.get_template("report.html.j2")
    html_str = template.render(payload=payload, font_dir=str(_FONTS))
    return HTML(string=html_str, base_url=str(_BASE)).write_pdf()


def render_tenant_report_pdf(payload: dict) -> bytes:
    try:
        from weasyprint import HTML
    except OSError as exc:
        raise RuntimeError(
            "WeasyPrint system libraries (GLib/Pango/Cairo) are not available "
            "in this environment. PDF export is unavailable."
        ) from exc
    template = _env.get_template("tenant_report.html.j2")
    html_str = template.render(payload=payload, font_dir=str(_FONTS))
    return HTML(string=html_str, base_url=str(_BASE)).write_pdf()
