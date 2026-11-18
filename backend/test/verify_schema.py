from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
SQL = (ROOT / "schema" / "bootstrap.sql").read_text(encoding="utf-8")
WORK_ASSIGNMENTS_MIGRATION = (ROOT / "schema" / "migrations" / "0004_staff_work_assignments.sql").read_text(encoding="utf-8")

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
db.executescript(SQL)
db.executescript(WORK_ASSIGNMENTS_MIGRATION)

objects = db.execute(
    "SELECT type, COUNT(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' GROUP BY type"
).fetchall()
counts = dict(objects)
assert counts.get("table", 0) == 46, counts
assert counts.get("view", 0) == 1, counts
assert counts.get("index", 0) == 23, counts
assert counts.get("trigger", 0) == 11, counts
assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
assert db.execute("PRAGMA foreign_key_check").fetchall() == []
assert db.execute("SELECT name FROM sqlite_master WHERE type='view' AND name='journal_entry_balances'").fetchone()

expected = {
    "0001_opoint_core": "22c119954d58b7ae6887cf3a215fdeb9caaf1c9bb7b3560e61fef52abd47c224",
    "0002_operational_hardening": "1176f077bb80a3aa3c86c68f0f1647d43cbe6e47a2b254669c5bc1c6dc24f45a",
    "0003_financial_integrity_guards": "10dc15adb79c67a47d7d9b15fb45868",
    "0004_staff_work_assignments": "fa3666d4eb0e62322800d5b9f0e9b762d24851b282fd01a7c20a4f1eed3a9090",
}
actual = dict(db.execute("SELECT version, checksum_sha256 FROM opoint_schema_migrations"))
assert actual == expected, actual

cash_columns = {row[1] for row in db.execute("PRAGMA table_info(cash_accounts)")}
assert "work_area" in cash_columns, cash_columns
assignment_columns = {row[1] for row in db.execute("PRAGMA table_info(staff_work_assignments)")}
assert {"company_id", "staff_membership_id", "branch_id", "work_area", "duty_role", "status"} <= assignment_columns

for table in ("companies", "products", "sales", "payment_intents", "journal_entries", "staff_work_assignments", "staff_work_assignment_events"):
    assert db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0, table

assert db.execute(
    "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('staff_work_assignment_events_no_update','staff_work_assignment_events_no_delete')"
).fetchone()[0] == 2

print("PASS: Opoint bootstrap and forward work-area migration create the expected tables, indexes, triggers and columns; integrity/FK checks and migration hashes match.")
