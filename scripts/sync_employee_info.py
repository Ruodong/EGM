"""Sync employee info from EAM resource_pool to EGM employee_info table.

Usage:
    python scripts/sync_employee_info.py
"""
import asyncio
import asyncpg


EAM_DSN = "postgresql://postgres:postgres@localhost:5432/eam_local"
EGM_DSN = "postgresql://postgres:postgres@localhost:5433/egm_local"

# Columns to sync from EAM resource_pool → EGM employee_info
COLUMN_MAP = {
    # eam column  → egm column
    "itcode":         "itcode",
    "name":           "name",
    "email":          "email",
    "job_role":       "job_role",
    "worker_type":    "worker_type",
    "country":        "country",
    "primary_skill":  "primary_skill",
    "skill_level":    "skill_level",
    "tier_1_org":     "tier_1_org",
    "tier_2_org":     "tier_2_org",
    "manager_itcode": "manager_itcode",
    "manager_name":   "manager_name",
}

BATCH_SIZE = 1000


async def main():
    eam = await asyncpg.connect(EAM_DSN)
    egm = await asyncpg.connect(EGM_DSN)

    try:
        # Read from EAM
        eam_cols = ", ".join(COLUMN_MAP.keys())
        rows = await eam.fetch(f"SELECT {eam_cols} FROM eam.resource_pool")
        print(f"Read {len(rows)} employees from EAM resource_pool")

        if not rows:
            print("No employees to sync")
            return

        # Build upsert SQL
        egm_cols = list(COLUMN_MAP.values())
        cols_str = ", ".join(egm_cols)
        placeholders = ", ".join(f"${i+1}" for i in range(len(egm_cols)))
        update_sets = ", ".join(
            f"{c} = EXCLUDED.{c}" for c in egm_cols if c != "itcode"
        )

        upsert_sql = f"""
            INSERT INTO egm.employee_info ({cols_str}, synced_at)
            VALUES ({placeholders}, NOW())
            ON CONFLICT (itcode) DO UPDATE SET {update_sets}, synced_at = NOW()
        """

        # Batch upsert
        eam_keys = list(COLUMN_MAP.keys())
        total = 0
        for i in range(0, len(rows), BATCH_SIZE):
            batch = rows[i:i + BATCH_SIZE]
            # Use executemany for batch performance
            args = [
                [row[k] for k in eam_keys]
                for row in batch
            ]
            await egm.executemany(upsert_sql, args)
            total += len(batch)
            print(f"  Synced {total}/{len(rows)} ...")

        print(f"Done — synced {total} employees to EGM employee_info")

    finally:
        await eam.close()
        await egm.close()


if __name__ == "__main__":
    asyncio.run(main())
