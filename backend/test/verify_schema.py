from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
SQL = (ROOT / "schema" / "bootstrap.sql").read_text(encoding="utf-8")
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
db.executescript(SQL)

objects = db.execute(
    "SELECT type, COUNT(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' GROUP BY type"
).fetchall()
counts = dict(objects)
assert counts.get("table", 0) == 44, counts
assert counts.get("view", 0) == 1, counts
assert counts.get("index", 0) == 19, counts
assert counts.get("trigger", 0) == 9, counts
assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
assert db.execute("PRAGMA foreign_key_check").fetchall() == []
assert db.execute("SELECT name FROM sqlite_master WHERE type='view' AND name='journal_entry_balances'").fetchone()
expected = {
    "0001_opoint_core": "22c119954d58b7ae6887cf3a215fdeb9caaf1c9bb7b3560e61fef52abd47c224",
    "0002_operational_hardening": "1176f077bb80a3aa3c86c68f0f1647d43cbe6e47a2b254669c5bc1c6dc24f45a",
    "0003_financial_integrity_guards": "10dc15adb79c67a47db28ffa8582cfc8bad973edec07999e47d7d9b15fb45868",
}
actual = dict(db.execute("SELECT version, checksum_sha256 FROM opoint_schema_migrations"))
assert actual == expected, actual
for table in ("companies", "products", "sales", "payment_intents", "journal_entries"):
    assert db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0, table
print("PASS: Opoint snapshot creates all tables, view, indexes and nine guards; integrity/FK checks and migration hashes match.")
