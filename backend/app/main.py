import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from .routers import buildings, tenants, statements, payments, messages, auth, users, expenses, transactions, settings, collecting, special_charges, imports as imports_router
from .routers.statements import transactions_router, vendor_mappings_router

APP_ENV = os.getenv("APP_ENV", "development")

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="LeadPay API",
    version="0.3.0",
    description="Building Management Payment Tracker API - Phase 3: WhatsApp Integration",
    docs_url=None if APP_ENV == "production" else "/docs",
    redoc_url=None if APP_ENV == "production" else "/redoc",
    redirect_slashes=False,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_frontend_url = os.getenv("FRONTEND_URL", "")
if _frontend_url:
    # Restrict to configured frontend origin(s)
    _allow_origins = [o.strip() for o in _frontend_url.split(",")]
    _allow_credentials = True
elif APP_ENV == "production":
    # L2: never fall back to a wildcard origin in production. Deny cross-origin
    # rather than open up if FRONTEND_URL was forgotten.
    import logging
    logging.getLogger(__name__).error(
        "FRONTEND_URL is not set in production — refusing to allow all origins. "
        "Set FRONTEND_URL to the Vercel domain to enable the frontend."
    )
    _allow_origins = []
    _allow_credentials = False
else:
    # Local dev / initial setup only — allow all origins.
    _allow_origins = ["*"]
    _allow_credentials = False  # required when allow_origins=["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_credentials=_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers_middleware(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    if APP_ENV == "production":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


# Include routers
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(buildings.router)
app.include_router(tenants.router)
app.include_router(statements.router)
app.include_router(transactions.router)
app.include_router(transactions_router)
app.include_router(vendor_mappings_router)
app.include_router(payments.router)
app.include_router(messages.router)
app.include_router(expenses.router)
app.include_router(settings.router)
app.include_router(collecting.router)
app.include_router(special_charges.router)
app.include_router(imports_router.router)


@app.get("/")
def root():
    return {"message": "LeadPay API is running!", "status": "ok"}


@app.get("/api/v1/health")
def health_check():
    return {"status": "healthy"}
