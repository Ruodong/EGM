"""Governance Requests router — CRUD + lifecycle."""
from __future__ import annotations

from datetime import date as dt_date, timedelta
from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File as FastAPIFile
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.utils.pagination import PaginationParams, paginated_response
from app.utils.filters import multi_value_condition
from app.utils.audit import write_audit
from app.auth import require_permission, get_current_user, AuthUser, Role

router = APIRouter()


def _is_requestor_only(user: AuthUser) -> bool:
    """True if user has ONLY the Requestor role (no admin/lead/reviewer)."""
    return all(r == Role.REQUESTOR for r in user.roles)


def _is_domain_reviewer_only(user: AuthUser) -> bool:
    """True when highest role is domain_reviewer (no admin/lead)."""
    return (
        Role.DOMAIN_REVIEWER in user.roles
        and Role.ADMIN not in user.roles
        and Role.GOVERNANCE_LEAD not in user.roles
    )

ALLOWED_SORT = {"request_id", "title", "status", "create_at", "update_at", "requestor", "project_name"}


async def _validate_mandatory_rules(db: AsyncSession, all_saved_codes: set[str]):
    """Validate that all active mandatory dispatch rules are satisfied.

    A mandatory rule is satisfied if:
    1. It is directly included in the selected/auto-aggregated codes, OR
    2. It is excluded by a rule that IS selected (mutual exclusion exemption).
    """
    mandatory_rows = (await db.execute(text(
        "SELECT rule_code FROM dispatch_rule WHERE is_mandatory = TRUE AND is_active = TRUE"
    ))).scalars().all()

    if not mandatory_rows:
        return  # No mandatory rules configured

    missing = []
    for mcode in mandatory_rows:
        if mcode in all_saved_codes:
            continue  # Directly satisfied

        # Check exclusion exemption
        if all_saved_codes:
            conflict = (await db.execute(text("""
                SELECT 1 FROM dispatch_rule_exclusion
                WHERE rule_code = ANY(:selected) AND excluded_rule_code = :mcode
                LIMIT 1
            """), {"selected": list(all_saved_codes), "mcode": mcode})).scalar()
            if conflict:
                continue  # Exempt via mutual exclusion

        missing.append(mcode)

    if missing:
        raise HTTPException(status_code=400, detail=f"Missing mandatory rules: {', '.join(sorted(missing))}")


async def _validate_dependencies(db: AsyncSession, all_saved_codes: set[str]):
    """Validate that all dependency constraints are satisfied.

    A dependency is satisfied if at least one of the required rules (OR semantics)
    is present in the saved codes (including auto-aggregated parents).
    """
    if not all_saved_codes:
        return

    dep_rows = (await db.execute(text(
        "SELECT rule_code, required_rule_code FROM dispatch_rule_dependency "
        "WHERE rule_code = ANY(:codes)"
    ), {"codes": list(all_saved_codes)})).mappings().all()

    if not dep_rows:
        return

    # Group by rule_code → list of required codes (OR semantics)
    deps: dict[str, list[str]] = {}
    for row in dep_rows:
        deps.setdefault(row["rule_code"], []).append(row["required_rule_code"])

    violations = []
    for rule_code, required_codes in deps.items():
        # OR semantics: at least one required code must be in saved codes
        if not any(rc in all_saved_codes for rc in required_codes):
            violations.append(f"{rule_code} requires {' or '.join(sorted(required_codes))}")

    if violations:
        raise HTTPException(status_code=400, detail=f"Unsatisfied dependencies: {'; '.join(violations)}")


def _map(r: dict) -> dict:
    result = {
        "id": str(r["id"]),
        "requestId": r["request_id"],
        "title": r.get("title"),
        "description": r.get("description"),
        "govProjectType": r.get("gov_project_type"),
        "businessUnit": r.get("business_unit"),
        "projectId": r.get("project_id"),
        "projectType": r.get("project_type"),
        "projectCode": r.get("project_code"),
        "projectName": r.get("project_name"),
        "projectProjType": r.get("project_proj_type"),
        "projectStatus": r.get("project_status"),
        "projectDescription": r.get("project_description"),
        "projectPm": r.get("project_pm"),
        "projectPmItcode": r.get("project_pm_itcode"),
        "projectDtLead": r.get("project_dt_lead"),
        "projectDtLeadItcode": r.get("project_dt_lead_itcode"),
        "projectItLead": r.get("project_it_lead"),
        "projectItLeadItcode": r.get("project_it_lead_itcode"),
        "projectStartDate": r.get("project_start_date"),
        "projectGoLiveDate": r.get("project_go_live_date"),
        "projectEndDate": r.get("project_end_date"),
        "projectAiRelated": r.get("project_ai_related"),
        "productSoftwareType": r.get("product_software_type"),
        "productSoftwareTypeOther": r.get("product_software_type_other"),
        "productEndUser": list(r.get("product_end_user") or []),
        "userRegion": list(r.get("user_region") or []),
        "thirdPartyVendor": r.get("third_party_vendor"),
        "requestor": r["requestor"],
        "requestorName": r.get("requestor_name"),
        "status": r["status"],
        "lifecycleStatus": r.get("lifecycle_status", "Active"),
        "createBy": r.get("create_by"),
        "createAt": r["create_at"].isoformat() if r.get("create_at") else None,
        "updateAt": r["update_at"].isoformat() if r.get("update_at") else None,
    }
    return result


# Project snapshot fields for INSERT/UPDATE
_PROJECT_COLS = [
    "project_type", "project_code", "project_name", "project_proj_type",
    "project_status", "project_description", "project_pm", "project_pm_itcode",
    "project_dt_lead", "project_dt_lead_itcode", "project_it_lead",
    "project_it_lead_itcode", "project_start_date", "project_go_live_date",
    "project_end_date", "project_ai_related",
]


@router.get("", dependencies=[Depends(require_permission("governance_request", "read"))])
async def list_requests(
    status: str | None = Query(None),
    lifecycleStatus: str | None = Query(None),
    requestor: str | None = Query(None),
    search: str | None = Query(None),
    domain: str | None = Query(None),
    dateFrom: str | None = Query(None),
    dateTo: str | None = Query(None),
    pg: PaginationParams = Depends(),
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conditions: list[str] = []
    params: dict = {}

    # Requestor-only users can only see their own requests
    if _is_requestor_only(user):
        conditions.append("gr.requestor = :current_user")
        params["current_user"] = user.id
    # Domain reviewers see only non-Draft requests with matching domains
    elif _is_domain_reviewer_only(user):
        conditions.append("gr.status != 'Draft'")
        if user.domain_codes:
            conditions.append("""EXISTS (
                SELECT 1
                FROM governance_request_rule grr
                JOIN dispatch_rule cr ON cr.rule_code = grr.rule_code AND cr.is_active = true
                JOIN dispatch_rule_domain crd ON crd.rule_id = cr.id AND crd.relationship = 'in'
                WHERE grr.request_id = gr.id AND crd.domain_code = ANY(:reviewer_domains)
            )""")
            params["reviewer_domains"] = user.domain_codes
        else:
            conditions.append("FALSE")

    # Lifecycle status filter: default to Active if not specified
    if lifecycleStatus:
        conditions.append(multi_value_condition("gr.lifecycle_status", "lifecycle_status", lifecycleStatus, params))
    else:
        conditions.append("gr.lifecycle_status = 'Active'")

    if status:
        conditions.append(multi_value_condition("gr.status", "status", status, params))
    if requestor:
        params["requestor"] = f"%{requestor}%"
        conditions.append("(gr.requestor ILIKE :requestor OR gr.requestor_name ILIKE :requestor)")
    if search:
        params["search"] = f"%{search}%"
        conditions.append("(gr.request_id ILIKE :search OR gr.project_name ILIKE :search OR gr.title ILIKE :search)")
    if domain:
        params["domain_filter"] = domain
        conditions.append("""EXISTS (
            SELECT 1
            FROM governance_request_rule grr
            JOIN dispatch_rule cr ON cr.rule_code = grr.rule_code AND cr.is_active = true
            JOIN dispatch_rule_domain crd ON crd.rule_id = cr.id AND crd.relationship = 'in'
            WHERE grr.request_id = gr.id AND crd.domain_code = :domain_filter
        )""")
    if dateFrom:
        params["date_from"] = dt_date.fromisoformat(dateFrom)
        conditions.append("gr.create_at >= :date_from")
    if dateTo:
        params["date_to"] = dt_date.fromisoformat(dateTo) + timedelta(days=1)
        conditions.append("gr.create_at < :date_to")

    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""

    # Count
    count_sql = f"SELECT COUNT(*) FROM governance_request gr{where}"
    total = (await db.execute(text(count_sql), params)).scalar() or 0

    # Sort
    sort_col = pg.sort_field if pg.sort_field in ALLOWED_SORT else "create_at"
    sort_dir = "ASC" if pg.sort_order and pg.sort_order.upper() == "ASC" else "DESC"

    data_sql = f"""
        SELECT gr.*
        FROM governance_request gr
        {where}
        ORDER BY gr.{sort_col} {sort_dir}
        LIMIT :limit OFFSET :offset
    """
    params["limit"] = pg.page_size
    params["offset"] = pg.offset

    rows = (await db.execute(text(data_sql), params)).mappings().all()

    # Batch-resolve domain review statuses for all rows
    row_ids = [r["id"] for r in rows]
    review_map: dict[str, list[dict]] = {}
    if row_ids:
        review_rows = (await db.execute(text("""
            SELECT dr.request_id, dr.domain_code, dr.status, dr.outcome
            FROM domain_review dr
            WHERE dr.request_id = ANY(:ids)
            ORDER BY dr.domain_code
        """), {"ids": row_ids})).mappings().all()
        for rv in review_rows:
            rid = str(rv["request_id"])
            review_map.setdefault(rid, []).append({
                "domainCode": rv["domain_code"],
                "status": rv["status"],
                "outcome": rv["outcome"],
            })

    mapped = []
    for r in rows:
        m = _map(dict(r))
        m["domainReviews"] = review_map.get(str(r["id"]), [])
        mapped.append(m)
    return paginated_response(mapped, total, pg.page, pg.page_size)


@router.get("/filter-options", dependencies=[Depends(require_permission("governance_request", "read"))])
async def filter_options(db: AsyncSession = Depends(get_db)):
    statuses = (await db.execute(text("SELECT DISTINCT status FROM governance_request ORDER BY status"))).scalars().all()
    return {"statuses": statuses}


@router.get("/{request_id}", dependencies=[Depends(require_permission("governance_request", "read"))])
async def get_request(request_id: str, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = (await db.execute(text(
        "SELECT gr.* FROM governance_request gr "
        "WHERE gr.request_id = :id OR gr.id::text = :id"
    ), {"id": request_id})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Governance request not found")

    # Requestor-only users can only view their own requests
    if _is_requestor_only(user) and row["requestor"] != user.id:
        raise HTTPException(status_code=403, detail="Access denied: you can only view your own requests")

    # Domain reviewers: no Draft access, and must match assigned domains
    if _is_domain_reviewer_only(user):
        if row["status"] == "Draft":
            raise HTTPException(status_code=403, detail="Access denied")
        req_domains = (await db.execute(text("""
            SELECT DISTINCT crd.domain_code
            FROM governance_request_rule grr
            JOIN dispatch_rule cr ON cr.rule_code = grr.rule_code AND cr.is_active = true
            JOIN dispatch_rule_domain crd ON crd.rule_id = cr.id AND crd.relationship = 'in'
            WHERE grr.request_id = :rid
        """), {"rid": row["id"]})).scalars().all()
        if not any(dc in user.domain_codes for dc in req_domains):
            raise HTTPException(status_code=403, detail="Access denied: request not in your assigned domains")

    result = _map(dict(row))

    # Fetch requestor employee info
    emp = (await db.execute(text(
        "SELECT email, manager_name, tier_1_org, tier_2_org "
        "FROM employee_info WHERE itcode = :itcode"
    ), {"itcode": row["requestor"]})).mappings().first()
    if emp:
        result["requestorEmail"] = emp["email"]
        result["requestorManagerName"] = emp["manager_name"]
        result["requestorTier1Org"] = emp["tier_1_org"]
        result["requestorTier2Org"] = emp["tier_2_org"]

    # Fetch associated dispatch rule codes
    rule_rows = (await db.execute(text(
        "SELECT rule_code, is_auto FROM governance_request_rule WHERE request_id = :rid ORDER BY rule_code"
    ), {"rid": row["id"]})).mappings().all()
    result["ruleCodes"] = [r["rule_code"] for r in rule_rows]
    result["autoRuleCodes"] = [r["rule_code"] for r in rule_rows if r["is_auto"]]

    return result


@router.post("", dependencies=[Depends(require_permission("governance_request", "write"))])
async def create_request(body: dict, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # NOTE: Required field validation is deferred to the /submit endpoint
    # so that drafts can be saved with incomplete data.
    project_type_val = body.get("projectType") or None
    project_type = project_type_val
    project_id = body.get("projectId") or None  # FK to project table
    project_snapshot: dict = {}

    if project_type == "mspo":
        # Validate and snapshot from project table
        if not project_id:
            raise HTTPException(status_code=400, detail="MSPO project requires projectId")
        proj = (await db.execute(text(
            "SELECT * FROM project WHERE project_id = :pid"
        ), {"pid": project_id})).mappings().first()
        if not proj:
            raise HTTPException(status_code=400, detail=f"Project '{project_id}' not found")
        # Validate required project fields even for MSPO snapshot
        mspo_missing: list[str] = []
        if not proj["project_id"]:
            mspo_missing.append("projectCode")
        if not proj["project_name"]:
            mspo_missing.append("projectName")
        if not proj["pm"]:
            mspo_missing.append("projectPm")
        if mspo_missing:
            raise HTTPException(status_code=400, detail=f"MSPO project missing required fields: {', '.join(mspo_missing)}")
        project_snapshot = {
            "project_type": "mspo", "project_code": proj["project_id"],
            "project_name": proj["project_name"], "project_proj_type": proj["type"],
            "project_status": proj["status"], "project_description": None,
            "project_pm": proj["pm"], "project_pm_itcode": proj["pm_itcode"],
            "project_dt_lead": proj["dt_lead"], "project_dt_lead_itcode": proj["dt_lead_itcode"],
            "project_it_lead": proj["it_lead"], "project_it_lead_itcode": proj["it_lead_itcode"],
            "project_start_date": proj["start_date"], "project_go_live_date": proj["go_live_date"],
            "project_end_date": proj["end_date"], "project_ai_related": proj["ai_related"],
        }
    elif project_type == "non_mspo":
        project_id = None  # No FK for non-MSPO
        project_snapshot = {
            "project_type": "non_mspo",
            "project_code": body.get("projectCode") or None,
            "project_name": body.get("projectName") or None,
            "project_proj_type": None, "project_status": None,
            "project_description": body.get("projectDescription") or None,
            "project_pm": body.get("projectPm") or None,
            "project_pm_itcode": body.get("projectPmItcode") or None,
            "project_dt_lead": None, "project_dt_lead_itcode": None,
            "project_it_lead": None, "project_it_lead_itcode": None,
            "project_start_date": body.get("projectStartDate") or None,
            "project_go_live_date": body.get("projectGoLiveDate") or None,
            "project_end_date": body.get("projectEndDate") or None,
            "project_ai_related": None,
        }
    else:
        # Backward compat: if projectId provided, snapshot like MSPO (implicit)
        if project_id:
            proj = (await db.execute(text(
                "SELECT * FROM project WHERE project_id = :pid"
            ), {"pid": project_id})).mappings().first()
            if not proj:
                raise HTTPException(status_code=400, detail=f"Project '{project_id}' not found")
            project_snapshot = {
                "project_type": None, "project_code": proj["project_id"],
                "project_name": proj["project_name"], "project_proj_type": proj["type"],
                "project_status": proj["status"], "project_description": None,
                "project_pm": proj["pm"], "project_pm_itcode": proj["pm_itcode"],
                "project_dt_lead": proj["dt_lead"], "project_dt_lead_itcode": proj["dt_lead_itcode"],
                "project_it_lead": proj["it_lead"], "project_it_lead_itcode": proj["it_lead_itcode"],
                "project_start_date": proj["start_date"], "project_go_live_date": proj["go_live_date"],
                "project_end_date": proj["end_date"], "project_ai_related": proj["ai_related"],
            }
        else:
            project_snapshot = {col: None for col in _PROJECT_COLS}

    # Generate request_id with daily reset: EGQyymmdd0001, EGQyymmdd0002, ...
    today_str = dt_date.today().strftime('%y%m%d')
    max_seq = (await db.execute(text(
        "SELECT COALESCE(MAX(CAST(SUBSTRING(request_id, 10) AS INT)), 0) "
        "FROM governance_request WHERE request_id LIKE :prefix"
    ), {"prefix": f"EGQ{today_str}%"})).scalar() or 0
    new_id = f"EGQ{today_str}{max_seq + 1:04d}"

    gov_project_type = body.get("govProjectType") or None
    business_unit = body.get("businessUnit") or None

    proj_col_str = ", ".join(_PROJECT_COLS)
    proj_param_str = ", ".join(f":{c}" for c in _PROJECT_COLS)

    # title auto-set to request_id for backward compatibility (list page, search)
    title = body.get("title") or new_id

    sql = text(f"""
        INSERT INTO governance_request (request_id, title, description, gov_project_type, business_unit, project_id,
            {proj_col_str},
            product_software_type, product_software_type_other, product_end_user, user_region, third_party_vendor,
            requestor, requestor_name, status, create_by, update_by)
        VALUES (:request_id, :title, :description, :gov_project_type, :business_unit, :project_id,
            {proj_param_str},
            :product_software_type, :product_software_type_other, :product_end_user, :user_region, :third_party_vendor,
            :requestor, :requestor_name, 'Draft', :create_by, :create_by)
        RETURNING *
    """)
    params = {
        "request_id": new_id,
        "title": title,
        "description": body.get("description"),
        "gov_project_type": gov_project_type,
        "business_unit": business_unit,
        "project_id": project_id,
        **project_snapshot,
        "product_software_type": body.get("productSoftwareType") or None,
        "product_software_type_other": body.get("productSoftwareTypeOther") or None,
        "product_end_user": body.get("productEndUser") or None,
        "user_region": body.get("userRegion") or None,
        "third_party_vendor": body.get("thirdPartyVendor") or None,
        "requestor": user.id,
        "requestor_name": user.name,
        "create_by": user.id,
    }
    row = (await db.execute(sql, params)).mappings().first()

    # Save dispatch rule associations (level-2 user-selected)
    rule_codes = body.get("ruleCodes") or []
    saved_rules: list[str] = []
    auto_rules: list[str] = []
    if rule_codes:
        for rc in rule_codes:
            valid = (await db.execute(text(
                "SELECT 1 FROM dispatch_rule WHERE rule_code = :code AND is_active = TRUE"
            ), {"code": rc})).scalar()
            if valid:
                await db.execute(text("""
                    INSERT INTO governance_request_rule (request_id, rule_code, is_auto, create_by)
                    VALUES (:rid, :code, FALSE, :user)
                    ON CONFLICT (request_id, rule_code) DO NOTHING
                """), {"rid": row["id"], "code": rc, "user": user.id})
                saved_rules.append(rc)

        # Auto-aggregate parent rules
        if saved_rules:
            parent_rows = (await db.execute(text("""
                SELECT DISTINCT parent_rule_code FROM dispatch_rule
                WHERE rule_code = ANY(:codes) AND parent_rule_code IS NOT NULL AND is_active = TRUE
                  AND parent_rule_code IN (SELECT rule_code FROM dispatch_rule WHERE is_active = TRUE)
            """), {"codes": saved_rules})).scalars().all()
            for pc in parent_rows:
                await db.execute(text("""
                    INSERT INTO governance_request_rule (request_id, rule_code, is_auto, create_by)
                    VALUES (:rid, :code, TRUE, :user)
                    ON CONFLICT (request_id, rule_code) DO NOTHING
                """), {"rid": row["id"], "code": pc, "user": user.id})
                auto_rules.append(pc)

    # Validate mutual exclusion constraints
    all_rule_codes = saved_rules + auto_rules
    if len(all_rule_codes) >= 2:
        conflict = (await db.execute(text("""
            SELECT rule_code, excluded_rule_code FROM dispatch_rule_exclusion
            WHERE rule_code = ANY(:codes) AND excluded_rule_code = ANY(:codes)
            LIMIT 1
        """), {"codes": all_rule_codes})).mappings().first()
        if conflict:
            raise HTTPException(status_code=400,
                                detail=f"Rules '{conflict['rule_code']}' and '{conflict['excluded_rule_code']}' are mutually exclusive")

    # NOTE: mandatory-rule and dependency validation is deferred to the submit
    # endpoint so that drafts can be saved without all rules selected.

    await write_audit(db, "governance_request", str(row["id"]), "created", user.id,
                      new_value={"requestId": new_id, "ruleCodes": saved_rules, "autoRuleCodes": auto_rules})
    await db.commit()
    result = _map(dict(row))
    result["ruleCodes"] = saved_rules + auto_rules
    result["autoRuleCodes"] = auto_rules
    return result


@router.put("/{request_id}", dependencies=[Depends(require_permission("governance_request", "write"))])
async def update_request(request_id: str, body: dict, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    import json as _json

    # ── 1. Fetch current row FIRST (for status check and change tracking) ──
    current = (await db.execute(text(
        "SELECT * FROM governance_request WHERE request_id = :id OR id::text = :id"
    ), {"id": request_id})).mappings().first()
    if not current:
        raise HTTPException(status_code=404, detail="Not found")

    # Block edits on Complete requests
    if current["status"] == "Complete":
        raise HTTPException(status_code=403, detail="Complete requests cannot be edited")

    # Requestor-only users can only edit their own requests
    if _is_requestor_only(user) and current["requestor"] != user.id:
        raise HTTPException(status_code=403, detail="Access denied: you can only edit your own requests")

    track_changes = current["status"] in ("Submitted", "In Progress")

    # ── 2. Build SET clause ──
    sets: list[str] = []
    params: dict = {"id": request_id, "update_by": user.id}

    # Mapping of camelCase body key → snake_case DB column (for scalar fields)
    _SCALAR_FIELDS = [
        ("title", "title"), ("description", "description"),
        ("govProjectType", "gov_project_type"),
        ("businessUnit", "business_unit"),
        ("productSoftwareType", "product_software_type"),
        ("productSoftwareTypeOther", "product_software_type_other"),
        ("thirdPartyVendor", "third_party_vendor"),
    ]
    _ARRAY_FIELDS = [
        ("productEndUser", "product_end_user"),
        ("userRegion", "user_region"),
    ]

    for field, col in _SCALAR_FIELDS:
        if field in body:
            sets.append(f"{col} = :{col}")
            params[col] = body[field] or None

    for field, col in _ARRAY_FIELDS:
        if field in body:
            sets.append(f"{col} = :{col}")
            params[col] = body[field] or None

    # Project fields — handle projectType-aware update
    project_type = body.get("projectType")
    if project_type is not None or "projectId" in body:
        pid = body.get("projectId") or None
        if project_type == "mspo" or (project_type is None and pid):
            if not pid:
                raise HTTPException(status_code=400, detail="MSPO project requires projectId")
            proj = (await db.execute(text(
                "SELECT * FROM project WHERE project_id = :pid"
            ), {"pid": pid})).mappings().first()
            if not proj:
                raise HTTPException(status_code=400, detail=f"Project '{pid}' not found")
            # Validate required project fields even for MSPO snapshot
            mspo_missing: list[str] = []
            if not proj["project_id"]:
                mspo_missing.append("projectCode")
            if not proj["project_name"]:
                mspo_missing.append("projectName")
            if not proj["pm"]:
                mspo_missing.append("projectPm")
            if mspo_missing:
                raise HTTPException(status_code=400, detail=f"MSPO project missing required fields: {', '.join(mspo_missing)}")
            snap = {
                "project_type": project_type, "project_id": pid,
                "project_code": proj["project_id"], "project_name": proj["project_name"],
                "project_proj_type": proj["type"], "project_status": proj["status"],
                "project_description": None, "project_pm": proj["pm"],
                "project_pm_itcode": proj["pm_itcode"], "project_dt_lead": proj["dt_lead"],
                "project_dt_lead_itcode": proj["dt_lead_itcode"], "project_it_lead": proj["it_lead"],
                "project_it_lead_itcode": proj["it_lead_itcode"],
                "project_start_date": proj["start_date"], "project_go_live_date": proj["go_live_date"],
                "project_end_date": proj["end_date"], "project_ai_related": proj["ai_related"],
            }
            for col, val in snap.items():
                sets.append(f"{col} = :{col}")
                params[col] = val
        elif project_type == "non_mspo":
            sets.append("project_id = :project_id")
            params["project_id"] = None
            snap = {
                "project_type": "non_mspo",
                "project_code": body.get("projectCode") or None,
                "project_name": body.get("projectName") or None,
                "project_proj_type": None, "project_status": None,
                "project_description": body.get("projectDescription") or None,
                "project_pm": body.get("projectPm") or None,
                "project_pm_itcode": body.get("projectPmItcode") or None, "project_dt_lead": None,
                "project_dt_lead_itcode": None, "project_it_lead": None,
                "project_it_lead_itcode": None,
                "project_start_date": body.get("projectStartDate") or None,
                "project_go_live_date": body.get("projectGoLiveDate") or None,
                "project_end_date": body.get("projectEndDate") or None,
                "project_ai_related": None,
            }
            for col, val in snap.items():
                sets.append(f"{col} = :{col}")
                params[col] = val
        else:
            # Clear project
            sets.append("project_id = :project_id")
            params["project_id"] = pid
            for col in _PROJECT_COLS:
                sets.append(f"{col} = :{col}")
                params[col] = None

    has_rule_codes = "ruleCodes" in body
    if not sets and not has_rule_codes:
        raise HTTPException(status_code=400, detail="No fields to update")

    # ── 3. Write change log for Submitted/In Progress edits ──
    if track_changes:
        gr_uuid = str(current["id"])
        # Track scalar + array field changes
        all_trackable = _SCALAR_FIELDS + _ARRAY_FIELDS
        for field, col in all_trackable:
            if field not in body:
                continue
            old_val = current[col]
            new_val = body[field] or None
            # Normalize for comparison: convert lists to sorted for stable comparison
            if isinstance(old_val, list) and isinstance(new_val, list):
                if sorted(old_val) == sorted(new_val):
                    continue
            elif old_val == new_val:
                continue
            await db.execute(text("""
                INSERT INTO governance_request_change_log
                    (request_id, field_name, old_value, new_value, changed_by)
                VALUES (:rid, :field, CAST(:old AS jsonb), CAST(:new AS jsonb), :user)
            """), {
                "rid": gr_uuid, "field": field,
                "old": _json.dumps(old_val), "new": _json.dumps(new_val),
                "user": user.id,
            })

        # Track ruleCodes changes
        if has_rule_codes:
            old_rules = [r["rule_code"] for r in (await db.execute(text(
                "SELECT rule_code FROM governance_request_rule WHERE request_id = :rid AND is_auto = FALSE ORDER BY rule_code"
            ), {"rid": gr_uuid})).mappings().all()]
            new_rules = sorted(body["ruleCodes"] or [])
            if old_rules != new_rules:
                await db.execute(text("""
                    INSERT INTO governance_request_change_log
                        (request_id, field_name, old_value, new_value, changed_by)
                    VALUES (:rid, 'ruleCodes', CAST(:old AS jsonb), CAST(:new AS jsonb), :user)
                """), {
                    "rid": gr_uuid, "field": "ruleCodes",
                    "old": _json.dumps(old_rules), "new": _json.dumps(new_rules),
                    "user": user.id,
                })

    # ── 4. Execute UPDATE ──
    if sets:
        sets.append("update_by = :update_by")
        sets.append("update_at = NOW()")
        sql = text(
            f"UPDATE governance_request SET {', '.join(sets)} "
            f"WHERE request_id = :id OR id::text = :id "
            f"RETURNING *"
        )
        row = (await db.execute(sql, params)).mappings().first()
    else:
        row = current

    if not row:
        raise HTTPException(status_code=404, detail="Not found")

    # ── 5. Update dispatch rule associations if provided ──
    if "ruleCodes" in body:
        rule_codes = body["ruleCodes"] or []
        # Delete existing associations
        await db.execute(text(
            "DELETE FROM governance_request_rule WHERE request_id = :rid"
        ), {"rid": row["id"]})
        # Insert new ones (only active rules)
        saved_rules: list[str] = []
        for rc in rule_codes:
            valid = (await db.execute(text(
                "SELECT 1 FROM dispatch_rule WHERE rule_code = :code AND is_active = TRUE"
            ), {"code": rc})).scalar()
            if valid:
                await db.execute(text("""
                    INSERT INTO governance_request_rule (request_id, rule_code, is_auto, create_by)
                    VALUES (:rid, :code, FALSE, :user)
                    ON CONFLICT (request_id, rule_code) DO NOTHING
                """), {"rid": row["id"], "code": rc, "user": user.id})
                saved_rules.append(rc)

        # Auto-aggregate parent rules
        if saved_rules:
            parent_rows = (await db.execute(text("""
                SELECT DISTINCT parent_rule_code FROM dispatch_rule
                WHERE rule_code = ANY(:codes) AND parent_rule_code IS NOT NULL AND is_active = TRUE
                  AND parent_rule_code IN (SELECT rule_code FROM dispatch_rule WHERE is_active = TRUE)
            """), {"codes": saved_rules})).scalars().all()
            for pc in parent_rows:
                await db.execute(text("""
                    INSERT INTO governance_request_rule (request_id, rule_code, is_auto, create_by)
                    VALUES (:rid, :code, TRUE, :user)
                    ON CONFLICT (request_id, rule_code) DO NOTHING
                """), {"rid": row["id"], "code": pc, "user": user.id})

    # NOTE: mandatory-rule and dependency validation is deferred to the submit
    # endpoint so that drafts can be saved incrementally without all rules selected.

    await db.commit()
    result = _map(dict(row))

    # Fetch current rule codes
    rule_rows = (await db.execute(text(
        "SELECT rule_code, is_auto FROM governance_request_rule WHERE request_id = :rid ORDER BY rule_code"
    ), {"rid": row["id"]})).mappings().all()
    result["ruleCodes"] = [r["rule_code"] for r in rule_rows]
    result["autoRuleCodes"] = [r["rule_code"] for r in rule_rows if r["is_auto"]]

    return result


@router.put("/{request_id}/submit", dependencies=[Depends(require_permission("governance_request", "write"))])
async def submit_request(request_id: str, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Look up the draft request first (without updating yet) to validate rules
    lookup = (await db.execute(text(
        "SELECT * FROM governance_request WHERE (request_id = :id OR id::text = :id) AND status = 'Draft'"
    ), {"id": request_id})).mappings().first()
    if not lookup:
        raise HTTPException(status_code=400, detail="Can only submit Draft requests")

    # Requestor-only users can only submit their own requests
    if _is_requestor_only(user) and lookup["requestor"] != user.id:
        raise HTTPException(status_code=403, detail="Access denied: you can only submit your own requests")

    # Validate required fields before allowing submission
    missing: list[str] = []
    if not lookup["gov_project_type"]:
        missing.append("govProjectType")
    if not lookup["business_unit"]:
        missing.append("businessUnit")
    if not lookup["product_software_type"]:
        missing.append("productSoftwareType")
    if not lookup["product_end_user"]:
        missing.append("productEndUser")
    if not lookup["user_region"]:
        missing.append("userRegion")
    if not lookup.get("project_type"):
        missing.append("projectType")
    elif lookup.get("project_type") == "mspo":
        if not lookup.get("project_id"):
            missing.append("projectId")
    elif lookup.get("project_type") == "non_mspo":
        if not lookup["project_code"]:
            missing.append("projectCode")
        if not lookup["project_name"]:
            missing.append("projectName")
        if not lookup["project_pm"]:
            missing.append("projectPm")
        if not lookup.get("project_start_date"):
            missing.append("projectStartDate")
        if not lookup.get("project_go_live_date"):
            missing.append("projectGoLiveDate")
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required fields: {', '.join(missing)}")

    # Validate mandatory rules and dependencies before transitioning
    rule_rows = (await db.execute(text(
        "SELECT rule_code FROM governance_request_rule WHERE request_id = :rid"
    ), {"rid": lookup["id"]})).scalars().all()
    all_codes = set(rule_rows)
    await _validate_mandatory_rules(db, all_codes)
    await _validate_dependencies(db, all_codes)

    # Validate at least one domain is triggered by the selected rules
    domain_rows = (await db.execute(text("""
        SELECT DISTINCT crd.domain_code
        FROM governance_request_rule grr
        JOIN dispatch_rule cr ON cr.rule_code = grr.rule_code AND cr.is_active = true
        JOIN dispatch_rule_domain crd ON crd.rule_id = cr.id AND crd.relationship = 'in'
        WHERE grr.request_id = :rid
    """), {"rid": lookup["id"]})).scalars().all()
    if not domain_rows:
        raise HTTPException(status_code=400, detail="At least one governance domain must be triggered by the selected rules")

    # Validate questionnaire completion for internal domains
    internal_domains = (await db.execute(text("""
        SELECT DISTINCT crd.domain_code
        FROM governance_request_rule grr
        JOIN dispatch_rule cr ON cr.rule_code = grr.rule_code AND cr.is_active = true
        JOIN dispatch_rule_domain crd ON crd.rule_id = cr.id AND crd.relationship = 'in'
        JOIN domain_registry dr ON dr.domain_code = crd.domain_code
            AND dr.is_active = true AND dr.integration_type = 'internal'
        WHERE grr.request_id = :rid
    """), {"rid": lookup["id"]})).scalars().all()

    if internal_domains:
        # Get required active templates for internal domains
        required_templates = (await db.execute(text("""
            SELECT id, domain_code FROM domain_questionnaire_template
            WHERE domain_code = ANY(:codes) AND is_active = true AND is_required = true
        """), {"codes": list(internal_domains)})).mappings().all()

        if required_templates:
            # Get answered template IDs for this request
            answered = set((await db.execute(text("""
                SELECT template_id FROM request_questionnaire_response
                WHERE request_id = :rid AND answer IS NOT NULL
            """), {"rid": lookup["id"]})).scalars().all())

            incomplete_domains = set()
            for tmpl in required_templates:
                if tmpl["id"] not in answered:
                    incomplete_domains.add(tmpl["domain_code"])

            if incomplete_domains:
                raise HTTPException(
                    status_code=400,
                    detail=f"Incomplete domain questionnaires: {', '.join(sorted(incomplete_domains))}"
                )

    # Transition to Submitted
    row = (await db.execute(text(
        "UPDATE governance_request SET status = 'Submitted', update_by = :user, update_at = NOW() "
        "WHERE id = :id RETURNING *"
    ), {"id": lookup["id"], "user": user.id})).mappings().first()

    # Auto-create domain reviews for each triggered domain
    for dc in domain_rows:
        await db.execute(text("""
            INSERT INTO domain_review (request_id, domain_code, status, create_by, update_by)
            VALUES (:rid, :code, 'Waiting for Accept', :user, :user)
            ON CONFLICT (request_id, domain_code) DO NOTHING
        """), {"rid": lookup["id"], "code": dc, "user": user.id})

    await write_audit(db, "governance_request", str(row["id"]), "submitted", user.id,
                      old_value={"status": "Draft"}, new_value={"status": "Submitted"})
    await db.commit()
    return _map(dict(row))


@router.delete("/{request_id}", dependencies=[Depends(require_permission("governance_request", "write"))])
async def delete_request(request_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(text(
        "DELETE FROM governance_request WHERE (request_id = :id OR id::text = :id) AND status = 'Draft'"
    ), {"id": request_id})
    if result.rowcount == 0:
        raise HTTPException(status_code=400, detail="Can only delete Draft requests")
    await db.commit()
    return {"deleted": True}


# ═══════════════════════════════════════════════════════
# Change log endpoint
# ═══════════════════════════════════════════════════════

@router.get("/{request_id}/changelog", dependencies=[Depends(require_permission("governance_request", "read"))])
async def get_changelog(request_id: str, db: AsyncSession = Depends(get_db)):
    gr_uuid = await _resolve_request_uuid(db, request_id)
    rows = (await db.execute(text("""
        SELECT id, field_name, old_value, new_value, changed_by, changed_at
        FROM governance_request_change_log
        WHERE request_id = :rid
        ORDER BY changed_at DESC
    """), {"rid": str(gr_uuid)})).mappings().all()
    return {"data": [{
        "id": str(r["id"]),
        "fieldName": r["field_name"],
        "oldValue": r["old_value"],
        "newValue": r["new_value"],
        "changedBy": r["changed_by"],
        "changedAt": r["changed_at"].isoformat() if r["changed_at"] else None,
    } for r in rows]}


# Map raw audit action → business-friendly description
_ACTION_LABELS: dict[str, str] = {
    # governance_request actions
    "created": "Draft Creation",
    "submitted": "Submit",
    "cancelled": "Cancel",
    "archived": "Archive",
    "auto_completed": "Request Complete",
    "status_in_progress": "Request In Progress",
    # domain_review actions
    "accepted": "Accept by {domain}",
    "returned": "Return by {domain} for Additional Information",
    "resubmitted": "Resubmit for {domain}",
    "approved": "Approve by {domain}",
    "approved_with_exception": "Approve with Exception by {domain}",
    "not_passed": "Not Pass by {domain}",
}


@router.get("/{request_id}/activity-log", dependencies=[Depends(require_permission("governance_request", "read"))])
async def get_activity_log(request_id: str, db: AsyncSession = Depends(get_db)):
    """Return business-level activity log for a governance request.

    Combines audit_log entries for both the governance_request itself
    and all its domain_reviews into a single chronological list.
    """
    gr_uuid = await _resolve_request_uuid(db, request_id)

    rows = (await db.execute(text("""
        (
            SELECT al.id, al.entity_type, al.action, al.new_value,
                   al.performed_by, al.performed_at,
                   ei.name AS performer_name,
                   NULL AS dr_outcome_notes
            FROM audit_log al
            LEFT JOIN employee_info ei ON ei.itcode = al.performed_by
            WHERE al.entity_type = 'governance_request'
              AND al.entity_id = :rid
        )
        UNION ALL
        (
            SELECT al.id, al.entity_type, al.action, al.new_value,
                   al.performed_by, al.performed_at,
                   ei.name AS performer_name,
                   dr.outcome_notes AS dr_outcome_notes
            FROM audit_log al
            LEFT JOIN employee_info ei ON ei.itcode = al.performed_by
            JOIN domain_review dr ON dr.id = al.entity_id
            WHERE al.entity_type = 'domain_review'
              AND dr.request_id = :rid
        )
        ORDER BY performed_at ASC,
                 entity_type ASC
    """), {"rid": str(gr_uuid)})).mappings().all()

    result = []
    for r in rows:
        action = r["action"]
        new_value = r["new_value"] or {}
        domain_code = new_value.get("domainCode", "")

        # Build business-friendly label
        template = _ACTION_LABELS.get(action, action)
        label = template.replace("{domain}", domain_code) if "{domain}" in template else template

        # Extract reason/notes if present (return reason, outcome notes)
        # Fallback: use domain_review.outcome_notes only for approve/not_passed actions
        reason = new_value.get("reason", "") or new_value.get("outcomeNotes", "")
        if not reason and action in ("approved_with_exception", "not_passed"):
            reason = r.get("dr_outcome_notes") or ""

        result.append({
            "id": str(r["id"]),
            "action": label,
            "entityType": r["entity_type"],
            "domainCode": domain_code or None,
            "performedBy": r["performed_by"],
            "performerName": r["performer_name"],
            "performedAt": r["performed_at"].isoformat() if r["performed_at"] else None,
            "details": reason,
        })

    return {"data": result}


# ═══════════════════════════════════════════════════════
# Lifecycle status endpoints (Cancel / Archive)
# ═══════════════════════════════════════════════════════


@router.put("/{request_id}/cancel", dependencies=[Depends(require_permission("governance_request", "write"))])
async def cancel_request(request_id: str, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Cancel a Draft request. Only the requestor (owner) can cancel."""
    row = (await db.execute(text(
        "SELECT id, status, lifecycle_status, requestor FROM governance_request "
        "WHERE request_id = :id OR id::text = :id"
    ), {"id": request_id})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    if row["lifecycle_status"] != "Active":
        raise HTTPException(status_code=400, detail=f"Request is already {row['lifecycle_status']}")
    if row["status"] != "Draft":
        raise HTTPException(status_code=400, detail="Only Draft requests can be cancelled")
    if _is_requestor_only(user) and row["requestor"] != user.id:
        raise HTTPException(status_code=403, detail="You can only cancel your own requests")

    await db.execute(text(
        "UPDATE governance_request SET lifecycle_status = 'Cancelled', update_by = :user, update_at = NOW() "
        "WHERE id = :id"
    ), {"id": row["id"], "user": user.id})
    await write_audit(db, "governance_request", str(row["id"]), "cancelled", user.id)
    await db.commit()
    return {"status": "ok", "lifecycleStatus": "Cancelled"}


@router.put("/{request_id}/archive", dependencies=[Depends(require_permission("governance_request", "write"))])
async def archive_request(request_id: str, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Archive a Complete request. Only admin/governance_lead can archive."""
    if _is_requestor_only(user) or _is_domain_reviewer_only(user):
        raise HTTPException(status_code=403, detail="Only admin or governance lead can archive requests")

    row = (await db.execute(text(
        "SELECT id, status, lifecycle_status FROM governance_request "
        "WHERE request_id = :id OR id::text = :id"
    ), {"id": request_id})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    if row["lifecycle_status"] != "Active":
        raise HTTPException(status_code=400, detail=f"Request is already {row['lifecycle_status']}")
    if row["status"] != "Complete":
        raise HTTPException(status_code=400, detail="Only Complete requests can be archived")

    await db.execute(text(
        "UPDATE governance_request SET lifecycle_status = 'Archived', update_by = :user, update_at = NOW() "
        "WHERE id = :id"
    ), {"id": row["id"], "user": user.id})
    await write_audit(db, "governance_request", str(row["id"]), "archived", user.id)
    await db.commit()
    return {"status": "ok", "lifecycleStatus": "Archived"}


@router.post("/{request_id}/copy", dependencies=[Depends(require_permission("governance_request", "write"))])
async def copy_request(request_id: str, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Copy a request to create a new Draft request. Copies all form data but not attachments or reviews."""
    src = (await db.execute(text(
        "SELECT * FROM governance_request WHERE request_id = :id OR id::text = :id"
    ), {"id": request_id})).mappings().first()
    if not src:
        raise HTTPException(status_code=404, detail="Not found")

    # Requestor-only can only copy their own requests
    if _is_requestor_only(user) and src["requestor"] != user.id:
        raise HTTPException(status_code=403, detail="You can only copy your own requests")

    # Generate new request_id
    today_str = dt_date.today().strftime('%y%m%d')
    max_seq = (await db.execute(text(
        "SELECT COALESCE(MAX(CAST(SUBSTRING(request_id, 10) AS INT)), 0) "
        "FROM governance_request WHERE request_id LIKE :prefix"
    ), {"prefix": f"EGQ{today_str}%"})).scalar() or 0
    new_id = f"EGQ{today_str}{max_seq + 1:04d}"

    proj_col_str = ", ".join(_PROJECT_COLS)
    proj_param_str = ", ".join(f":{c}" for c in _PROJECT_COLS)

    sql = text(f"""
        INSERT INTO governance_request (request_id, title, description, gov_project_type, business_unit, project_id,
            {proj_col_str},
            product_software_type, product_software_type_other, product_end_user, user_region, third_party_vendor,
            requestor, requestor_name, status, lifecycle_status, create_by, update_by)
        VALUES (:request_id, :title, :description, :gov_project_type, :business_unit, :project_id,
            {proj_param_str},
            :product_software_type, :product_software_type_other, :product_end_user, :user_region, :third_party_vendor,
            :requestor, :requestor_name, 'Draft', 'Active', :create_by, :create_by)
        RETURNING *
    """)
    params = {
        "request_id": new_id,
        "title": new_id,
        "description": src.get("description"),
        "gov_project_type": src.get("gov_project_type"),
        "business_unit": src.get("business_unit"),
        "project_id": src.get("project_id"),
        **{col: src.get(col) for col in _PROJECT_COLS},
        "product_software_type": src.get("product_software_type"),
        "product_software_type_other": src.get("product_software_type_other"),
        "product_end_user": list(src.get("product_end_user") or []) or None,
        "user_region": list(src.get("user_region") or []) or None,
        "third_party_vendor": src.get("third_party_vendor"),
        "requestor": user.id,
        "requestor_name": user.name,
        "create_by": user.id,
    }
    new_row = (await db.execute(sql, params)).mappings().first()

    # Copy rule associations
    src_rules = (await db.execute(text(
        "SELECT rule_code, is_auto FROM governance_request_rule WHERE request_id = :rid"
    ), {"rid": src["id"]})).mappings().all()
    for rule in src_rules:
        await db.execute(text(
            "INSERT INTO governance_request_rule (request_id, rule_code, is_auto) VALUES (:rid, :rc, :auto)"
        ), {"rid": new_row["id"], "rc": rule["rule_code"], "auto": rule["is_auto"]})

    # Copy questionnaire responses
    src_responses = (await db.execute(text(
        "SELECT template_id, domain_code, answer FROM request_questionnaire_response WHERE request_id = :rid"
    ), {"rid": src["id"]})).mappings().all()
    for resp in src_responses:
        await db.execute(text(
            "INSERT INTO request_questionnaire_response (request_id, template_id, domain_code, answer) "
            "VALUES (:rid, :tid, :dc, :answer)"
        ), {"rid": new_row["id"], "tid": resp["template_id"], "dc": resp["domain_code"], "answer": resp["answer"]})

    await db.commit()

    result = _map(dict(new_row))
    # Also return rule codes for the frontend
    rule_rows = (await db.execute(text(
        "SELECT rule_code FROM governance_request_rule WHERE request_id = :rid AND is_auto = FALSE"
    ), {"rid": new_row["id"]})).scalars().all()
    result["ruleCodes"] = list(rule_rows)
    return result


# ═══════════════════════════════════════════════════════
# Attachment endpoints
# ═══════════════════════════════════════════════════════

async def _resolve_request_uuid(db: AsyncSession, request_id: str):
    """Resolve request_id or UUID string to the governance_request UUID."""
    row = (await db.execute(text(
        "SELECT id FROM governance_request WHERE request_id = :id OR id::text = :id"
    ), {"id": request_id})).scalar()
    if not row:
        raise HTTPException(status_code=404, detail="Governance request not found")
    return str(row)


@router.post("/{request_id}/attachments", dependencies=[Depends(require_permission("governance_request", "write"))])
async def upload_attachment(
    request_id: str,
    file: UploadFile,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    gr_uuid = await _resolve_request_uuid(db, request_id)
    data = await file.read()
    row = (await db.execute(text("""
        INSERT INTO governance_request_attachment (request_id, file_name, file_size, content_type, file_data, create_by)
        VALUES (:rid, :fname, :fsize, :ctype, :fdata, :user)
        RETURNING id, file_name, file_size, content_type, create_at
    """), {
        "rid": gr_uuid, "fname": file.filename or "untitled",
        "fsize": len(data), "ctype": file.content_type or "application/octet-stream",
        "fdata": data, "user": user.id,
    })).mappings().first()
    await db.commit()
    return {
        "id": str(row["id"]), "fileName": row["file_name"],
        "fileSize": row["file_size"], "contentType": row["content_type"],
        "createAt": row["create_at"].isoformat() if row["create_at"] else None,
    }


@router.get("/{request_id}/attachments", dependencies=[Depends(require_permission("governance_request", "read"))])
async def list_attachments(request_id: str, db: AsyncSession = Depends(get_db)):
    gr_uuid = await _resolve_request_uuid(db, request_id)
    rows = (await db.execute(text("""
        SELECT id, file_name, file_size, content_type, create_by, create_at
        FROM governance_request_attachment WHERE request_id = :rid ORDER BY create_at
    """), {"rid": gr_uuid})).mappings().all()
    return {"data": [{
        "id": str(r["id"]), "fileName": r["file_name"],
        "fileSize": r["file_size"], "contentType": r["content_type"],
        "createBy": r["create_by"],
        "createAt": r["create_at"].isoformat() if r["create_at"] else None,
    } for r in rows]}


@router.get("/{request_id}/attachments/{att_id}", dependencies=[Depends(require_permission("governance_request", "read"))])
async def download_attachment(request_id: str, att_id: str, db: AsyncSession = Depends(get_db)):
    gr_uuid = await _resolve_request_uuid(db, request_id)
    row = (await db.execute(text("""
        SELECT file_name, content_type, file_data FROM governance_request_attachment
        WHERE id = :aid AND request_id = :rid
    """), {"aid": att_id, "rid": gr_uuid})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Attachment not found")
    return Response(
        content=bytes(row["file_data"]),
        media_type=row["content_type"],
        headers={"Content-Disposition": f'attachment; filename="{row["file_name"]}"'},
    )


@router.delete("/{request_id}/attachments/{att_id}", dependencies=[Depends(require_permission("governance_request", "write"))])
async def delete_attachment(request_id: str, att_id: str, db: AsyncSession = Depends(get_db)):
    gr_uuid = await _resolve_request_uuid(db, request_id)
    result = await db.execute(text(
        "DELETE FROM governance_request_attachment WHERE id = :aid AND request_id = :rid"
    ), {"aid": att_id, "rid": gr_uuid})
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Attachment not found")
    await db.commit()
    return {"deleted": True}
