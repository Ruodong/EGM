"""Sync projects from EAM database to EGM database.

Usage:
    python scripts/sync_projects.py
"""
import asyncio
import asyncpg


EAM_DSN = "postgresql://postgres:postgres@localhost:5432/eam_local"
EGM_DSN = "postgresql://postgres:postgres@localhost:5433/egm_local"

COLUMNS = [
    "id", "project_id", "project_name", "type", "status",
    "pm", "pm_itcode", "dt_lead", "dt_lead_itcode",
    "it_lead", "it_lead_itcode", "start_date", "go_live_date",
    "end_date", "ai_related", "source", "create_by", "create_at", "update_at",
]


async def main():
    eam = await asyncpg.connect(EAM_DSN)
    egm = await asyncpg.connect(EGM_DSN)

    try:
        cols = ", ".join(COLUMNS)
        rows = await eam.fetch(f"SELECT {cols} FROM eam.project")
        print(f"Read {len(rows)} projects from EAM")

        if not rows:
            print("No projects to sync")
            return

        # Upsert into EGM
        placeholders = ", ".join(f"${i+1}" for i in range(len(COLUMNS)))
        update_sets = ", ".join(
            f"{c} = EXCLUDED.{c}" for c in COLUMNS if c != "id"
        )

        upsert_sql = f"""
            INSERT INTO egm.project ({cols})
            VALUES ({placeholders})
            ON CONFLICT (id) DO UPDATE SET {update_sets}
        """

        count = 0
        for row in rows:
            values = [row[c] for c in COLUMNS]
            await egm.execute(upsert_sql, *values)
            count += 1

        print(f"Synced {count} projects to EGM")

    finally:
        await eam.close()
        await egm.close()


if __name__ == "__main__":
    asyncio.run(main())
