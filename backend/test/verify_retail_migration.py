from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
bootstrap = (ROOT / "schema" / "bootstrap.sql").read_text(encoding="utf-8")
migration_paths = [
    "0004_staff_work_assignments.sql",
    "0005_enterprise_automation.sql",
    "0006_message_capture_and_receipts.sql",
    "0007_provider_operator_access.sql",
    "0008_staff_invitations.sql",
    "0009_cash_session_lifecycle.sql",
]

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
db.executescript(bootstrap)
for path in migration_paths:
    db.executescript((ROOT / "schema" / "migrations" / path).read_text(encoding="utf-8"))

tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
columns = {row[1] for row in db.execute("PRAGMA table_info(sales)")}
triggers = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}
indexes = {row[1] for row in db.execute("PRAGMA index_list(cash_sessions)")}
assert "cash_session_id" in columns
assert "idempotency_records" in tables
assert {
    "sale_requires_open_retail_cash_session",
    "cash_session_status_transition_guard",
    "cash_session_close_metadata_guard",
} <= triggers
assert "idx_cash_sessions_one_unresolved_account" in indexes

expected = {
    "0001_opoint_core": "22c119954d58b7ae6887cf3a215fdeb9caaf1c9bb7b3560e61fef52abd47c224",
    "0002_operational_hardening": "1176f077bb80a3aa3c86c68f0f1647d43cbe6e47a2b254669c5bc1c6dc24f45a",
    "0003_financial_integrity_guards": "10dc15adb79c67a47db28ffa8582cfc8bad973edec07999e47d7d9b15fb45868",
    "0004_staff_work_assignments": "fa3666d4eb0e62322800d5b9f0e9b762d24851b282fd01a7c20a4f1eed3a9090",
    "0005_enterprise_automation": "0a18fcb1eeb7f1bc6e658dd86b4f49e808b62bbd6a1833d3404415b3dceebe3e",
    "0006_message_capture_and_receipts": "db7576a526fefd6d585fb94539281f00996929404437ecc6b5f79fef05da07c1",
    "0007_provider_operator_access": "94b6f4af7180571c2c284d3f40813a4e80ca57979a92e1",
    "0008_staff_invitations": "9c9d4b29b5bfffa4efad98590ef12edb3d2731f2e2aba707f49c233cab6fa850",
    "0009_cash_session_lifecycle": "9969372fbf063beec9cecd0dc20681cf9ba36b93978ea0ac8c4d31a8af542504",
}
actual = dict(db.execute("SELECT version, checksum_sha256 FROM opoint_schema_migrations"))
assert actual == expected, actual
assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
assert db.execute("PRAGMA foreign_key_check").fetchall() == []

db.execute("INSERT INTO companies(id,slug,display_name) VALUES ('co-1','otya','Otya Holdings Limited')")
db.execute("INSERT INTO branches(id,company_id,branch_code,name) VALUES ('br-1','co-1','MBR-001','Mbirizi')")
db.execute(
    "INSERT INTO ledger_accounts(id,company_id,account_code,name,account_type,normal_balance) "
    "VALUES ('la-cash','co-1','1000','Cash Drawer','ASSET','DEBIT')"
)
db.execute(
    "INSERT INTO cash_accounts(id,company_id,branch_id,ledger_account_id,account_type,account_code,display_name,work_area) "
    "VALUES ('cash-1','co-1','br-1','la-cash','CASH_DRAWER','CASH-001','Retail drawer','RETAIL')"
)
db.execute(
    "INSERT INTO cash_sessions(id,company_id,branch_id,cash_account_id,opened_by,opening_amount,expected_closing_amount,status) "
    "VALUES ('session-1','co-1','br-1','cash-1','identity-1',100000,100000,'OPEN')"
)

# A completed sale cannot be inserted unless its matching session is open and Retail cash.
try:
    db.execute(
        "INSERT INTO sales(id,company_id,branch_id,receipt_number,status,subtotal_amount,total_amount,idempotency_key,actor_id,cash_session_id) "
        "VALUES ('sale-bad','co-1','br-1','BAD-001','COMPLETED',1000,1000,'sale-bad-idem','identity-1','missing-session')"
    )
    raise AssertionError("Completed sales must be tied to an open retail cash session")
except sqlite3.IntegrityError as error:
    assert "sale_requires_open_retail_cash_session" in str(error)

# One unresolved cash session per cash drawer prevents multiple operators sharing the same drawer.
try:
    db.execute(
        "INSERT INTO cash_sessions(id,company_id,branch_id,cash_account_id,opened_by,opening_amount,expected_closing_amount,status) "
        "VALUES ('session-duplicate','co-1','br-1','cash-1','identity-2',0,0,'OPEN')"
    )
    raise AssertionError("A cash drawer cannot have two unresolved sessions")
except sqlite3.IntegrityError:
    pass

db.execute(
    "INSERT INTO sales(id,company_id,branch_id,cash_session_id,receipt_number,status,subtotal_amount,total_amount,idempotency_key,actor_id) "
    "VALUES ('sale-1','co-1','br-1','session-1','OTY-001','COMPLETED',25000,25000,'sale-001','identity-1')"
)
try:
    db.execute("UPDATE cash_sessions SET status='CLOSED' WHERE id='session-1'")
    raise AssertionError("Open cash sessions must be submitted before review/closure")
except sqlite3.IntegrityError:
    pass

db.execute(
    "UPDATE cash_sessions SET status='SUBMITTED',counted_closing_amount=100000,difference_amount=0,closed_by='identity-1' WHERE id='session-1'"
)
db.execute(
    "UPDATE cash_sessions SET status='CLOSED',closed_by='owner-1',closed_at=CURRENT_TIMESTAMP WHERE id='session-1'"
)
assert db.execute("SELECT status FROM cash_sessions WHERE id='session-1'").fetchone()[0] == "CLOSED"

try:
    db.execute(
        "INSERT INTO sales(id,company_id,branch_id,cash_session_id,receipt_number,status,subtotal_amount,total_amount,idempotency_key,actor_id) "
        "VALUES ('sale-2','co-1','br-1','session-1','OTY-002','COMPLETED',1000,1000,'sale-002','identity-1')"
    )
    raise AssertionError("Sales must be blocked after cash session closure")
except sqlite3.IntegrityError as error:
    assert "sale_requires_open_retail_cash_session" in str(error)

print("Verified OtyaPoint retail cash-session migration, guards, and sale linkage.")
