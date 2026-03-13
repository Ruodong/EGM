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
from app.auth import require_permission, get_current_user, AuthUser

router = APIRouter()

ALLOWED_SORT = {"request_id", "title", "status", "create_at", "update_at", "requestor"}


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


def _map(r: dict) -> dict:
    result = {
        "id": str(r["id"]),
        "requestId": r["request_id"],
        "egqId": r.get("egq_id"),
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
        "overallVerdict": r.get("overall_verdict"),
        "completedAt": r["completed_at"].isoformat() if r.get("completed_at") else None,
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
    requestor: str | None = Query(None),
    search: str | None = Query(None),
    dateFrom: str | None = Query(None),
    dateTo: str | None = Query(None),
    pg: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
):
    conditions: list[str] = []
    params: dict = {}

    if status:
        conditions.append(multi_value_condition("gr.status", "status", status, params))
    if requestor:
        params["requestor"] = f"%{requestor}%"
        conditions.append("(gr.requestor ILIKE :requestor OR gr.requestor_name ILIKE :requestor)")
    if search:
        params["search"] = f"%{search}%"
        conditions.append("(gr.request_id ILIKE :search OR gr.title ILIKE :search OR gr.egq_id ILIKE :search)")
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
    return paginated_response([_map(dict(r)) for r in rows], total, pg.page, pg.page_size)


@router.get("/filter-options", dependencies=[Depends(require_permission("governance_request", "read"))])
async def filter_options(db: AsyncSession = Depends(get_db)):
    statuses = (await db.execute(text("SELECT DISTINCT status FROM governance_request ORDER BY status"))).scalars().all()
    return {"statuses": statuses}


@router.get("/{request_id}", dependencies=[Depends(require_permission("governance_request", "read"))])
async def get_request(request_id: str, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(text(
        "SELECT gr.* FROM governance_request gr "
        "WHERE gr.request_id = :id OR gr.id::text = :id"
    ), {"id": request_id})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Governance request not found")
    result = _map(dict(row))

    # Fetch associated dispatch rule codes
    rule_rows = (await db.execute(text(
        "SELECT rule_code, is_auto FROM governance_request_rule WHERE request_id = :rid ORDER BY rule_code"
    ), {"rid": row["id"]})).mappings().all()
    result["ruleCodes"] = [r["rule_code"] for r in rule_rows]
    result["autoRuleCodes"] = [r["rule_code"] for r in rule_rows if r["is_auto"]]

    return result


@router.post("", dependencies=[Depends(require_permission("governance_request", "write"))])
async def create_request(body: dict, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # --- Required field validation ---
    missing_fields: list[str] = []
    if not body.get("govProjectType"):
        missing_fields.append("govProjectType")
    if not body.get("businessUnit"):
        missing_fields.append("businessUnit")
    project_type_val = body.get("projectType") or None
    if project_type_val == "non_mspo":
        if not body.get("projectCode"):
            missing_fields.append("projectCode")
        if not body.get("projectName"):
            missing_fields.append("projectName")
        if not body.get("projectPm"):
            missing_fields.append("projectPm")
    if not body.get("productSoftwareType"):
        missing_fields.append("productSoftwareType")
    if not body.get("productEndUser"):
        missing_fields.append("productEndUser")
    if not body.get("userRegion"):
        missing_fields.append("userRegion")
    if missing_fields:
        raise HTTPException(status_code=400, detail=f"Missing required fields: {', '.join(missing_fields)}")

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

    # Generate next request_id using PostgreSQL sequence (atomic, no race condition)
    seq = (await db.execute(text("SELECT nextval('gr_seq')"))).scalar()
    new_id = f"GR-{seq:06d}"

    # Generate EGQ ID with daily reset: EGQyymmdd0001, EGQyymmdd0002, ...
    today_str = dt_date.today().strftime('%y%m%d')
    egq_count = (await db.execute(text(
        "SELECT COUNT(*) FROM governance_request WHERE egq_id LIKE :prefix"
    ), {"prefix": f"EGQ{today_str}%"})).scalar() or 0
    egq_id = f"EGQ{today_str}{egq_count + 1:04d}"

    gov_project_type = body.get("govProjectType") or None
    business_unit = body.get("businessUnit") or None

    proj_col_str = ", ".join(_PROJECT_COLS)
    proj_param_str = ", ".join(f":{c}" for c in _PROJECT_COLS)

    # title auto-set to egq_id for backward compatibility (list page, search)
    title = body.get("title") or egq_id

    sql = text(f"""
        INSERT INTO governance_request (request_id, egq_id, title, description, gov_project_type, business_unit, project_id,
            {proj_col_str},
            product_software_type, product_software_type_other, product_end_user, user_region, third_party_vendor,
            requestor, requestor_name, status, create_by, update_by)
        VALUES (:request_id, :egq_id, :title, :description, :gov_project_type, :business_unit, :project_id,
            {proj_param_str},
            :product_software_type, :product_software_type_other, :product_end_user, :user_region, :third_party_vendor,
            :requestor, :requestor_name, 'Draft', :create_by, :create_by)
        RETURNING *
    """)
    params = {
        "request_id": new_id,
        "egq_id": egq_id,
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

    # Validate mandatory rules are satisfied
    await _validate_mandatory_rules(db, set(saved_rules + auto_rules))

    await write_audit(db, "governance_request", str(row["id"]), "created", user.id,
                      new_value={"requestId": new_id, "egqId": egq_id, "ruleCodes": saved_rules, "autoRuleCodes": auto_rules})
    await db.commit()
    result = _map(dict(row))
    result["ruleCodes"] = saved_rules + auto_rules
    result["autoRuleCodes"] = auto_rules
    return result


@router.put("/{request_id}", dependencies=[Depends(require_permission("governance_request", "write"))])
async def update_request(request_id: str, body: dict, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    sets: list[str] = []
    params: dict = {"id": request_id, "update_by": user.id}

    # Standard scalar fields
    for field, col in [
        ("title", "title"), ("description", "description"),
        ("govProjectType", "gov_project_type"),
        ("businessUnit", "business_unit"),
        ("productSoftwareType", "product_software_type"),
        ("productSoftwareTypeOther", "product_software_type_other"),
        ("thirdPartyVendor", "third_party_vendor"),
    ]:
        if field in body:
            sets.append(f"{col} = :{col}")
            params[col] = body[field] or None

    # Array fields
    for field, col in [
        ("productEndUser", "product_end_user"),
        ("userRegion", "user_region"),
    ]:
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

    # If only ruleCodes changed (no standard fields), still need to fetch the row
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
        row = (await db.execute(text(
            "SELECT * FROM governance_request "
            "WHERE request_id = :id OR id::text = :id"
        ), {"id": request_id})).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Not found")

    # Update dispatch rule associations if provided
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

    # Validate mandatory rules if ruleCodes were updated
    if "ruleCodes" in body:
        current_rule_rows = (await db.execute(text(
            "SELECT rule_code FROM governance_request_rule WHERE request_id = :rid"
        ), {"rid": row["id"]})).scalars().all()
        await _validate_mandatory_rules(db, set(current_rule_rows))

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
    row = (await db.execute(text(
        "UPDATE governance_request SET status = 'Submitted', update_by = :user, update_at = NOW() "
        "WHERE (request_id = :id OR id::text = :id) AND status = 'Draft' "
        "RETURNING *"
    ), {"id": request_id, "user": user.id})).mappings().first()
    if not row:
        raise HTTPException(status_code=400, detail="Can only submit Draft requests")
    await write_audit(db, "governance_request", str(row["id"]), "submitted", user.id,
                      old_value={"status": "Draft"}, new_value={"status": "Submitted"})
    await db.commit()
    return _map(dict(row))


@router.put("/{request_id}/verdict", dependencies=[Depends(require_permission("governance_request", "write"))])
async def record_verdict(request_id: str, body: dict, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    verdict = body.get("verdict")
    if verdict not in ("Approved", "Approved with Conditions", "Rejected", "Deferred"):
        raise HTTPException(status_code=400, detail="Invalid verdict")

    # Resolve the governance request UUID
    gr = (await db.execute(text(
        "SELECT id FROM governance_request WHERE (request_id = :id OR id::text = :id) AND status = 'In Review'"
    ), {"id": request_id})).scalar()
    if not gr:
        raise HTTPException(status_code=400, detail="Request not found or not in 'In Review' status")
    gr_uuid = str(gr)

    # Guard: all domain reviews must be complete
    incomplete = (await db.execute(text(
        "SELECT COUNT(*) FROM domain_review WHERE request_id = :rid "
        "AND status NOT IN ('Review Complete', 'Waived')"
    ), {"rid": gr_uuid})).scalar() or 0
    if incomplete > 0:
        raise HTTPException(status_code=400, detail=f"{incomplete} domain review(s) still incomplete")

    # Guard: no open ISRs
    open_isrs = (await db.execute(text(
        "SELECT COUNT(*) FROM info_supplement_request WHERE request_id = :rid "
        "AND status IN ('Open', 'Acknowledged')"
    ), {"rid": gr_uuid})).scalar() or 0
    if open_isrs > 0:
        raise HTTPException(status_code=400, detail=f"{open_isrs} open information request(s)")

    row = (await db.execute(text(
        "UPDATE governance_request SET status = 'Completed', overall_verdict = :verdict, "
        "completed_at = NOW(), update_by = :user, update_at = NOW() "
        "WHERE id = :id "
        "RETURNING *"
    ), {"id": gr_uuid, "verdict": verdict, "user": user.id})).mappings().first()
    await write_audit(db, "governance_request", gr_uuid, "verdict_recorded", user.id,
                      old_value={"status": "In Review"}, new_value={"status": "Completed", "verdict": verdict})
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
