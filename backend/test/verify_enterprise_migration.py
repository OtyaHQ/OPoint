from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
bootstrap = (ROOT / "schema" / "bootstrap.sql").read_text(encoding="utf-8")
migration = (ROOT / "schema" / "migrations" / "0004_enterprise_automation.sql").read_text(encoding="utf-8")
receipts_migration = (ROOT / "schema" / "migrations" / "0005_message_capture_and_receipts.sql").read_text(encoding="utf-8")

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
db.executescript(bootstrap)
db.executescript(migration)
db.executescript(receipts_migration)

required = {
    "departments", "job_positions", "employee_profiles", "employee_assignments",
    "employee_permission_grants", "employee_documents", "company_assets",
    "company_sim_details", "asset_assignments", "provider_relationships",
    "provider_outlet_accounts", "provider_operator_profiles",
    "provider_balance_observations", "capture_records", "capture_extractions",
    "provider_statement_imports", "provider_transaction_records", "provider_statement_rows",
    "provider_message_captures", "issued_receipts", "receipt_events",
}
tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
assert required <= tables, sorted(required - tables)
assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
assert db.execute("PRAGMA foreign_key_check").fetchall() == []

db.execute(
    "INSERT INTO companies(id,slug,display_name,legal_name) VALUES ('co-1','otya','Otya','Otya Holdings Limited')"
)
db.executemany(
    "INSERT INTO branches(id,company_id,branch_code,name) VALUES (?,?,?,?)",
    [("br-1","co-1","MBR-001","Mbirizi"), ("br-2","co-1","MSK-001","Masaka")],
)
db.executemany(
    "INSERT INTO staff_memberships(id,company_id,branch_id,identity_subject,display_name,role_key,status) VALUES (?,?,?,?,?,?,?)",
    [("st-1","co-1","br-1","subject-1","Teller One","AGENT","ACTIVE"),
     ("st-2","co-1","br-2","subject-2","Teller Two","AGENT","ACTIVE")],
)
db.execute("INSERT INTO departments(id,company_id,department_code,name) VALUES ('dep-1','co-1','OPS','Operations')")
db.execute(
    "INSERT INTO job_positions(id,company_id,department_id,position_code,title) VALUES ('pos-1','co-1','dep-1','TELLER','Agency Teller')"
)
db.executemany(
    "INSERT INTO employee_profiles(id,company_id,staff_membership_id,employee_number,employment_status,hire_date) VALUES (?,?,?,?,?,?)",
    [("emp-1","co-1","st-1","EMP-001","ACTIVE","2026-01-01"),
     ("emp-2","co-1","st-2","EMP-002","ACTIVE","2026-02-01")],
)
db.executemany(
    "INSERT INTO employee_assignments(id,company_id,employee_profile_id,branch_id,department_id,position_id,assignment_type,created_by) VALUES (?,?,?,?,?,?,?,?)",
    [("as-1","co-1","emp-1","br-1","dep-1","pos-1","PRIMARY","owner"),
     ("as-2","co-1","emp-2","br-2","dep-1","pos-1","PRIMARY","owner")],
)

db.execute(
    "INSERT INTO company_assets(id,company_id,branch_id,asset_tag,asset_type,manufacturer,model) "
    "VALUES ('sim-asset-1','co-1','br-1','SIM-001','SIM_CARD','Airtel','Corporate SIM')"
)
db.execute(
    "INSERT INTO company_sim_details(asset_id,company_id,msisdn,iccid,network_code,registration_status) "
    "VALUES ('sim-asset-1','co-1','256700000001','iccid-001','AIRTEL','COMPANY_REGISTERED')"
)
db.execute(
    "INSERT INTO asset_assignments(id,company_id,asset_id,employee_profile_id,branch_id,issued_by) "
    "VALUES ('asset-as-1','co-1','sim-asset-1','emp-1','br-1','owner')"
)

db.execute(
    "INSERT INTO provider_relationships(id,company_id,provider_code,legal_entity_name,corporate_agent_reference,onboarding_status) "
    "VALUES ('pr-airtel','co-1','AIRTEL_MONEY','Otya Holdings Limited','AIR-CORP-001','ACTIVE')"
)
# One shared company relationship supports company-level settlement and separate outlet accounts.
db.execute(
    "INSERT INTO provider_outlet_accounts(id,company_id,provider_relationship_id,scope_type,branch_id,outlet_account_reference,account_kind,display_name,status) "
    "VALUES ('pa-commission','co-1','pr-airtel','COMPANY',NULL,'AIR-COMM-001','COMMISSION','Airtel company commission','ACTIVE')"
)
db.executemany(
    "INSERT INTO provider_outlet_accounts(id,company_id,provider_relationship_id,scope_type,branch_id,outlet_account_reference,account_kind,display_name,status) "
    "VALUES (?,?,?,?,?,?,?,?,?)",
    [("pa-1","co-1","pr-airtel","OUTLET","br-1","AIR-MBR-001","AGENT_FLOAT","Mbirizi Airtel float","ACTIVE"),
     ("pa-2","co-1","pr-airtel","OUTLET","br-2","AIR-MSK-001","AGENT_FLOAT","Masaka Airtel float","ACTIVE")],
)
try:
    db.execute(
        "INSERT INTO provider_relationships(id,company_id,provider_code,legal_entity_name) "
        "VALUES ('pr-airtel-duplicate','co-1','AIRTEL_MONEY','Otya Holdings Limited')"
    )
    raise AssertionError("Only one parent relationship per company/provider must be allowed")
except sqlite3.IntegrityError:
    pass

db.execute(
    "INSERT INTO provider_operator_profiles(id,company_id,provider_relationship_id,provider_outlet_account_id,employee_profile_id,provider_operator_reference,sim_asset_id,approval_status) "
    "VALUES ('op-1','co-1','pr-airtel','pa-1','emp-1','AIRTEL-TELLER-001','sim-asset-1','APPROVED')"
)
db.execute(
    "INSERT INTO provider_balance_observations(id,company_id,provider_outlet_account_id,balance_kind,amount,observed_at,source_kind,recorded_by,idempotency_key) "
    "VALUES ('bal-1','co-1','pa-1','AVAILABLE_FLOAT',1250000,'2026-11-12T10:00:00Z','PROVIDER_PORTAL','st-1','balance-001')"
)

db.execute(
    "INSERT INTO stored_files(id,company_id,object_key,content_type,size_bytes,sha256,classification,uploaded_by) "
    "VALUES ('file-1','co-1','private/co-1/receipt-1.jpg','image/jpeg',12345,'sha256-file-1','RESTRICTED','st-1')"
)
db.execute(
    "INSERT INTO capture_records(id,company_id,branch_id,capture_kind,capture_method,stored_file_id,input_fingerprint,status,created_by) "
    "VALUES ('capture-1','co-1','br-1','PROVIDER_RECEIPT','FILE_UPLOAD','file-1','fingerprint-1','NEEDS_REVIEW','st-1')"
)
db.execute(
    "INSERT INTO capture_extractions(id,company_id,capture_record_id,extractor_name,output_schema_version,extracted_fields_json) "
    "VALUES ('extract-1','co-1','capture-1','reviewed-parser','v1','{}')"
)
db.execute(
    "INSERT INTO provider_transaction_records(id,company_id,branch_id,provider_outlet_account_id,provider_operator_profile_id,capture_record_id,provider_reference,transaction_kind,amount,provider_status,evidence_level,recorded_by,idempotency_key) "
    "VALUES ('txn-1','co-1','br-1','pa-1','op-1','capture-1','REF-001','CASH_OUT',100000,'SUCCEEDED','PROVIDER_FEED','st-1','txn-idem-1')"
)
try:
    db.execute(
        "INSERT INTO provider_transaction_records(id,company_id,branch_id,provider_outlet_account_id,provider_reference,transaction_kind,amount,provider_status,evidence_level,recorded_by,idempotency_key) "
        "VALUES ('txn-bad','co-1','br-1','pa-1','REF-BAD','CASH_OUT',100000,'SUCCEEDED','STAFF_REPORTED','st-1','txn-idem-bad')"
    )
    raise AssertionError("Staff-entered records must not claim provider-confirmed success")
except sqlite3.IntegrityError:
    pass

db.execute(
    "INSERT INTO stored_files(id,company_id,object_key,content_type,size_bytes,sha256,classification,uploaded_by) "
    "VALUES ('file-2','co-1','private/co-1/airtel-statement.csv','text/csv',5000,'sha256-file-2','RESTRICTED','st-1')"
)
db.execute(
    "INSERT INTO provider_statement_imports(id,company_id,provider_outlet_account_id,stored_file_id,file_sha256,file_format,uploaded_by) "
    "VALUES ('import-1','co-1','pa-1','file-2','sha256-file-2','CSV','st-1')"
)
db.execute(
    "INSERT INTO provider_statement_rows(id,company_id,import_id,provider_outlet_account_id,provider_transaction_record_id,provider_reference,transaction_kind,amount,provider_status,match_status) "
    "VALUES ('row-1','co-1','import-1','pa-1','txn-1','REF-001','CASH_OUT',100000,'SUCCEEDED','MATCHED')"
)

for table, row_id in [("provider_balance_observations","bal-1"),("provider_transaction_records","txn-1")]:
    try:
        db.execute(f"UPDATE {table} SET id=id WHERE id=?", (row_id,))
        raise AssertionError(f"{table} must be append-only")
    except sqlite3.IntegrityError:
        pass
    try:
        db.execute(f"DELETE FROM {table} WHERE id=?", (row_id,))
        raise AssertionError(f"{table} must be append-only")
    except sqlite3.IntegrityError:
        pass

assert db.execute("SELECT COUNT(*) FROM provider_outlet_accounts WHERE provider_relationship_id='pr-airtel' AND scope_type='OUTLET'").fetchone()[0] == 2
assert db.execute("SELECT COUNT(*) FROM provider_balance_observations WHERE provider_outlet_account_id='pa-1'").fetchone()[0] == 1
assert db.execute("SELECT COUNT(*) FROM provider_transaction_records WHERE evidence_level='PROVIDER_FEED'").fetchone()[0] == 1
assert db.execute("PRAGMA foreign_key_check").fetchall() == []
print("PASS: Otya Enterprise migration supports company/provider parent IDs, separate outlet accounts, teller assignments, company SIMs/assets, balance snapshots, scans and statement imports without payment execution.")


# Explicitly shared provider messages are accepted without reading the phone's SMS inbox.
db.execute(
    "INSERT INTO provider_message_captures(id,company_id,branch_id,provider_relationship_id,provider_outlet_account_id,source_kind,sender_label,source_app_label,message_received_at,message_fingerprint,parsed_fields_json,parser_key,parser_version,parse_status,received_by) "
    "VALUES ('msg-1','co-1','br-1','pr-airtel','pa-1','USER_SHARED_MESSAGE','AIRTEL','Messages','2026-11-12T10:00:00Z','msg-fingerprint-1','{\"\"reference\"\":\"\"REF-002\"\",\"\"amount\"\":50000}','airtel-ug','1','NEEDS_REVIEW','st-1')"
)
columns = {row[1] for row in db.execute("PRAGMA table_info(provider_message_captures)")}
assert "raw_message_body" not in columns
assert "sms_body" not in columns

# Retail receipts are only issued from a completed sale and preserve an immutable snapshot.
db.execute(
    "INSERT INTO sales(id,company_id,branch_id,receipt_number,status,currency,subtotal_amount,discount_amount,tax_amount,total_amount,cost_amount,idempotency_key,actor_id) "
    "VALUES ('sale-1','co-1','br-1','OTYA-MBR-000001','COMPLETED','UGX',250000,0,0,250000,200000,'sale-idem-0001','st-1')"
)
db.execute(
    "INSERT INTO issued_receipts(id,company_id,branch_id,receipt_number,receipt_kind,source_type,source_id,issue_status,currency,total_amount,receipt_snapshot_json,verification_token_hash,idempotency_key,issued_by) "
    "VALUES ('receipt-sale-1','co-1','br-1','OTYA-MBR-000001','RETAIL_SALE','SALE','sale-1','ISSUED','UGX',250000,'{}','verify-hash-sale-1','receipt-idem-sale-1','st-1')"
)

# An agency receipt snapshots the actual recorded evidence and status. The receipt is not
# allowed to invent a stronger verification status than the source transaction record.
db.execute(
    "INSERT INTO issued_receipts(id,company_id,branch_id,receipt_number,receipt_kind,source_type,source_id,issue_status,currency,total_amount,provider_status_at_issue,evidence_level_at_issue,receipt_snapshot_json,verification_token_hash,idempotency_key,issued_by) "
    "VALUES ('receipt-agency-1','co-1','br-1','OTYA-MBR-AG-000001','AGENCY_SERVICE','PROVIDER_TRANSACTION_RECORD','txn-1','ISSUED','UGX',100000,'SUCCEEDED','PROVIDER_FEED','{}','verify-hash-agency-1','receipt-idem-agency-1','st-1')"
)
try:
    db.execute(
        "INSERT INTO issued_receipts(id,company_id,branch_id,receipt_number,receipt_kind,source_type,source_id,issue_status,currency,total_amount,provider_status_at_issue,evidence_level_at_issue,receipt_snapshot_json,verification_token_hash,idempotency_key,issued_by) "
        "VALUES ('receipt-agency-bad','co-1','br-1','OTYA-MBR-AG-000002','AGENCY_SERVICE','PROVIDER_TRANSACTION_RECORD','txn-1','ISSUED','UGX',100000,'SUCCEEDED','STAFF_REPORTED','{}','verify-hash-agency-2','receipt-idem-agency-2','st-1')"
    )
    raise AssertionError("Receipt cannot claim stronger evidence than its source record")
except sqlite3.IntegrityError:
    pass

# Issued receipt records cannot be deleted; voiding must be an auditable state transition
# performed by a separately authorized application service.
try:
    db.execute("DELETE FROM issued_receipts WHERE id='receipt-sale-1'")
    raise AssertionError("Issued receipt must be retained")
except sqlite3.IntegrityError:
    pass

assert db.execute("SELECT COUNT(*) FROM provider_message_captures WHERE source_kind='USER_SHARED_MESSAGE'").fetchone()[0] == 1
assert db.execute("SELECT COUNT(*) FROM issued_receipts").fetchone()[0] == 2
assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
assert db.execute("PRAGMA foreign_key_check").fetchall() == []
