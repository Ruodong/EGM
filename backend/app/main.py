"""FastAPI application entry point."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth.middleware import AuthMiddleware
from app.routers import (
    auth,
    health,
    governance_requests,
    projects,
    intake,
    domain_registry,
    domain_reviews,
    dispatch_rules,
    dashboard,
    progress,
    audit_log,
    user_authorization,
    employees,
    questionnaire_templates,
    request_questionnaire,
    review_actions,
    system_config,
    ask_egm,
    review_analysis,
    dev,
)

app = FastAPI(title="EGM API", version="1.0.0", description="Enterprise Governance Management")

# Middleware — order matters: CORS first, then Auth
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(AuthMiddleware)

# Register routers
app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(governance_requests.router, prefix="/api/governance-requests", tags=["Governance Requests"])
app.include_router(projects.router, prefix="/api/projects", tags=["Projects"])
app.include_router(intake.router, prefix="/api/intake", tags=["Intake (deprecated)"])
app.include_router(domain_registry.router, prefix="/api/domains", tags=["Domain Registry"])
app.include_router(domain_reviews.router, prefix="/api/domain-reviews", tags=["Domain Reviews"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["Dashboard"])
app.include_router(progress.router, prefix="/api/progress", tags=["Progress"])
app.include_router(dispatch_rules.router, prefix="/api/dispatch-rules", tags=["Dispatch Rules"])
app.include_router(audit_log.router, prefix="/api/audit-log", tags=["Audit Log"])
app.include_router(user_authorization.router, prefix="/api/user-authorization", tags=["User Authorization"])
app.include_router(employees.router, prefix="/api/employees", tags=["Employees"])
app.include_router(questionnaire_templates.router, prefix="/api/questionnaire-templates", tags=["Questionnaire Templates"])
app.include_router(request_questionnaire.router, prefix="/api/request-questionnaire", tags=["Request Questionnaire"])
app.include_router(review_actions.router, prefix="/api/review-actions", tags=["Review Actions"])
app.include_router(system_config.router, prefix="/api/system-config", tags=["System Config"])
app.include_router(ask_egm.router, prefix="/api/ask-egm", tags=["Ask EGM"])
app.include_router(review_analysis.router, prefix="/api/review-analysis", tags=["AI Review Analysis"])
app.include_router(dev.router, prefix="/api/dev", tags=["Dev"])


if __name__ == "__main__":
    import uvicorn
    from app.config import settings
    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=True)
