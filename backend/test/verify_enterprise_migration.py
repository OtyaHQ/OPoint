from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
bootstrap = (ROOT / "schema" / "bootstrap.sql").read_text(encoding="utf-8")
work_assignments_migration = (ROOT / "schema" / "migrations" / "0004_staff_work_assignments.sql").read_text(encoding="utf-8")
migration = (ROOT / "schema" / "migrations" / "0005_enterprise_automation.sql").read_text(encoding="utf-8")
receipts_migration = (ROOT / "schema" / "migrations" / "0006_message_capture_and_receipts.sql").read_text(encoding="utf-8")
provider_operator_access_migration = (ROOT / "schema" / "migrations" / "0007_provider_operator_access.sql").read_text(encoding="utf-8")
staff_invitations_migration = (ROOT / "schema" / "migrations" / "0008_staff_invitations.sql").read_text(encoding="utf-8")

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
db.executescript(bootstrap)
db.executescript(work_assignments_migration)
db.executescript(migration)
db.executescript(receipts_migration)
db.executescript(provider_operator_access_migration)
db.executescript(staff_invitations_migration)

required = {
    "departments", "job_positions", "employee_profiles", "employee_assignments",
    "employee_permission_grants", "employee_documents", "company_assets",
    "company_sim_details", "asset_assignments", "provider_relationships",
    "provider_outlet_accounts", "provider_operator_profiles",
    "provider_balance_observations", "capture_records", "capture_extractions",
    "provider_statement_imports", "provider_transaction_records", "provider_statement_rows",
    "provider_message_captures", "issued_receipts", "receipt_events",
    "staff_invitations", "staff_invitation_events",
}
tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
assert required <= tables, sorted(required - tables)
assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
assert db.execute("PRAGMA foreign_key_check").fetchall() == []

expected_migrations = {
    "0001_opoint_core": "22c119954d58b7ae6887cf3a215fdeb9caaf1c9bb7b3560e61fef52abd47c224",
    "0002_operational_hardening": "1176f077bb80a3aa3c86c68f0f1647d43cbe6e47a2b254669c5bc1c6dc24f45a",
    "0003_financial_integrity_guards": "10dc15adb79c67a47db28ffa8582cfc8bad973edec07999e47d7d9b15fb45868",
    "0004_staff_work_assignments": "fa3666d4eb0e62322800d5b9f0e9b762d24851b282fd01a7c20a4f1eed3a9090",
    "0005_enterprise_automation": "0a18fcb1eeb7f1bc6e658dd86b4f49e808b62bbd6a1833d3404415b3dceebe3e",
    "0006_message_capture_and_receipts": "db7576a526fefd6d585fb94539281f00996929404437ecc6b5f79fef05da07c1",
    "0007_provider_operator_access": "94b6f4af7180571c2c284d3f40813a4e80fd5c88ecb32e455c84ca57979a92e1",
    "0008_staff_invitations": "8907a2017b5f9cb79792f6ba67935862a543bbc784a638d6c27330c9d5e69513",
}
actual_migrations = dict(db.execute("SELECT version, checksum_sha256 FROM opoint_schema_migrations"))
assert actual_migrations == expected_migrations, actual_migrations

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

# Invitations are email-bound records, not active staff memberships.
db.execute(
    "INSERT INTO staff_invitations(id,company_id,email,email_normalized,display_name,branch_id,role_key,token_digest,invited_by,expires_at) "
    "VALUES ('invite-pending','co-1','new.teller@example.invalid','new.teller@example.invalid','New Teller','br-1','AGENT',?,'st-1','2099-01-01T00:00:00Z')",
    ("a" * 64,),
)
db.execute(
    "INSERT INTO staff_invitation_events(id,company_id,invitation_id,event_type,previous_status,new_status,actor_id) "
    "VALUES ('invite-event-created','co-1','invite-pending','CREATED',NULL,'PENDING','subject-1')"
)
try:
    db.execute(
        "INSERT INTO staff_invitations(id,company_id,email,email_normalized,display_name,role_key,token_digest,invited_by,expires_at) "
        "VALUES ('invite-owner','co-1','owner2@example.invalid','owner2@example.invalid','Second Owner','OWNER',?,'st-1','2099-01-01T00:00:00Z')",
        ("b" * 64,),
    )
    raise AssertionError("Normal staff invitations must never assign the OWNER role")
except sqlite3.IntegrityError:
    pass
try:
    db.execute(
        "INSERT INTO staff_invitations(id,company_id,email,email_normalized,display_name,branch_id,role_key,token_digest,invited_by,expires_at) "
        "VALUES ('invite-duplicate','co-1','new.teller@example.invalid','new.teller@example.invalid','New Teller','br-1','AGENT',?,'st-1','2099-01-01T00:00:00Z')",
        ("c" * 64,),
    )
    raise AssertionError("Only one pending invitation per company/email is allowed")
except sqlite3.IntegrityError:
    pass

# Delivery is a one-time pending -> sent/failed transition.
db.execute("UPDATE staff_invitations SET delivery_status='SENT' WHERE id='invite-pending'")
try:
    db.execute("UPDATE staff_invitations SET delivery_status='FAILED' WHERE id='invite-pending'")
    raise AssertionError("Invitation delivery state must be terminal after the first result")
except sqlite3.IntegrityError:
    pass

# A person must have a real Otya ID identity before redemption. Acceptance links a PENDING membership.
db.execute(
    "INSERT INTO staff_memberships(id,company_id,branch_id,identity_subject,display_name,email,role_key,status,created_by) "
    "VALUES ('st-invited','co-1','br-1','subject-invited','New Teller','new.teller@example.invalid','AGENT','PENDING','staff-invitation:invite-pending')"
)
db.execute(
    "UPDATE staff_invitations SET status='ACCEPTED',accepted_membership_id='st-invited',accepted_at=CURRENT_TIMESTAMP WHERE id='invite-pending'"
)
assert db.execute("SELECT status FROM staff_memberships WHERE id='st-invited'").fetchone()[0] == "PENDING"
assert db.execute("SELECT status FROM staff_invitations WHERE id='invite-pending'").fetchone()[0] == "ACCEPTED"
try:
    db.execute("UPDATE staff_invitations SET status='REVOKED',revoked_at=CURRENT_TIMESTAMP WHERE id='invite-pending'")
    raise AssertionError("Accepted invitations are terminal")
except sqlite3.IntegrityError:
    pass
try:
    db.execute("UPDATE staff_invitations SET role_key='MANAGER' WHERE id='invite-pending'")
    raise AssertionError("Invitation role and identity fields are immutable")
except sqlite3.IntegrityError:
    pass
try:
    db.execute("UPDATE staff_invitation_events SET reason='rewritten' WHERE id='invite-event-created'")
    raise AssertionError("Invitation event history is append-only")
except sqlite3.IntegrityError:
    pass
try:
    db.execute("DELETE FROM staff_invitation_events WHERE id='invite-event-created'")
    raise AssertionError("Invitation event history is append-only")
except sqlite3.IntegrityError:
    pass

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
    "INSERT INTO company_assets(id,company_id,branch_id,asset_tag,asset_type,manufacturer,model,lifecycle_status) "
    "VALUES ('sim-asset-1','co-1','br-1','SIM-001','SIM_CARD','Airtel','Corporate SIM','ASSIGNED')"
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
    "INSERT INTO staff_work_assignments(id,company_id,staff_membership_id,branch_id,work_area,duty_role,status,idempotency_key,request_fingerprint,reason,created_by) "
    "VALUES ('work-mm-1','co-1','st-1','br-1','MOBILE_MONEY','OPERATOR','ACTIVE','work-mm-idem-1','work-mm-fp-1','Agency operator assignment','owner')"
)

db.execute(
    "INSERT INTO provider_operator_profiles(id,company_id,provider_relationship_id,provider_outlet_account_id,employee_profile_id,provider_operator_reference,approval_status,training_status) "
    "VALUES ('op-2','co-1','pr-airtel','pa-2','emp-2','AIRTEL-TELLER-002','PENDING','NOT_STARTED')"
)

db.execute(
    "INSERT INTO provider_operator_profiles(id,company_id,provider_relationship_id,provider_outlet_account_id,employee_profile_id,provider_operator_reference,sim_asset_id,approval_status,training_status,approved_at,training_completed_at) "
    "VALUES ('op-1','co-1','pr-airtel','pa-1','emp-1','AIRTEL-TELLER-001','sim-asset-1','APPROVED','COMPLETED','2026-11-18T08:00:00Z','2026-11-18T08:00:00Z')"
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
assert db.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name IN ('idx_provider_operator_one_current_employee_account','idx_employee_provider_operation_grant_active')").fetchone()[0] == 2
assert db.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('provider_operator_active_insert_guard','provider_operator_active_update_guard','employee_provider_grant_active_insert_guard','employee_provider_grant_active_update_guard','mobile_money_assignment_deactivation_revokes_provider_access','staff_work_assignment_revoked_terminal')").fetchone()[0] == 6
assert db.execute("PRAGMA foreign_key_check").fetchall() == []
print("PASS: Otya Enterprise migrations support branch-scoped provider relationships, outlet accounts, employee operator approval, company SIM assignment, statement evidence and receipt history without payment execution.")


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


# A provider operator cannot be approved without an active Mobile Money assignment.
try:
    db.execute(
        "UPDATE provider_operator_profiles SET approval_status='APPROVED',training_status='COMPLETED',approved_at='2026-11-18T08:00:00Z',training_completed_at='2026-11-18T08:00:00Z' WHERE id='op-2'"
    )
    raise AssertionError("Provider operator approval requires a current Mobile Money work assignment")
except sqlite3.IntegrityError:
    pass

db.execute(
    "INSERT INTO staff_work_assignments(id,company_id,staff_membership_id,branch_id,work_area,duty_role,status,idempotency_key,request_fingerprint,reason,created_by) "
    "VALUES ('work-mm-2','co-1','st-2','br-2','MOBILE_MONEY','OPERATOR','ACTIVE','work-mm-idem-2','work-mm-fp-2','Agency operator assignment','owner')"
)
db.execute(
    "UPDATE provider_operator_profiles SET approval_status='APPROVED',training_status='COMPLETED',approved_at='2026-11-18T08:00:00Z',training_completed_at='2026-11-18T08:00:00Z' WHERE id='op-2'"
)

# Suspending the work assignment automatically removes the provider approval.
db.execute(
    "UPDATE staff_work_assignments SET status='SUSPENDED',suspended_by='owner',suspended_at=CURRENT_TIMESTAMP WHERE id='work-mm-2'"
)
assert db.execute("SELECT approval_status FROM provider_operator_profiles WHERE id='op-2'").fetchone()[0] == "SUSPENDED"

# A grant cannot be created while the assignment and operator approval are suspended.
try:
    db.execute(
        "INSERT INTO employee_permission_grants(id,company_id,employee_profile_id,permission_key,scope_type,scope_id,status,granted_by,reason) "
        "VALUES ('grant-operator-bad','co-1','emp-2','MOBILE_MONEY:OPERATE','PROVIDER_ACCOUNT','pa-2','ACTIVE','owner','Invalid branch operator grant')"
    )
    raise AssertionError("Provider grant must require an active Mobile Money assignment and approved operator profile")
except sqlite3.IntegrityError:
    pass

# Resuming a work assignment never silently restores provider approval.
db.execute(
    "UPDATE staff_work_assignments SET status='ACTIVE',suspended_by=NULL,suspended_at=NULL WHERE id='work-mm-2'"
)
assert db.execute("SELECT approval_status FROM provider_operator_profiles WHERE id='op-2'").fetchone()[0] == "SUSPENDED"

# A fresh provider approval is required before an outlet-scoped grant can be reissued.
db.execute(
    "UPDATE provider_operator_profiles SET approval_status='APPROVED',training_status='COMPLETED',approved_at='2026-11-18T08:00:00Z',training_completed_at='2026-11-18T08:00:00Z' WHERE id='op-2'"
)
db.execute(
    "INSERT INTO employee_permission_grants(id,company_id,employee_profile_id,permission_key,scope_type,scope_id,status,granted_by,reason) "
    "VALUES ('grant-operator-2','co-1','emp-2','MOBILE_MONEY:OPERATE','PROVIDER_ACCOUNT','pa-2','ACTIVE','owner','Approved branch two Airtel operator access')"
)

# Subsequent work suspension automatically suspends both the operator and its live grant.
db.execute(
    "UPDATE staff_work_assignments SET status='SUSPENDED',suspended_by='owner',suspended_at=CURRENT_TIMESTAMP WHERE id='work-mm-2'"
)
assert db.execute("SELECT approval_status FROM provider_operator_profiles WHERE id='op-2'").fetchone()[0] == "SUSPENDED"
assert db.execute("SELECT status FROM employee_permission_grants WHERE id='grant-operator-2'").fetchone()[0] == "SUSPENDED"
try:
    db.execute(
        "UPDATE employee_permission_grants SET status='ACTIVE' WHERE id='grant-operator-2'"
    )
    raise AssertionError("A scoped grant must not reactivate when its Mobile Money assignment is suspended")
except sqlite3.IntegrityError:
    pass

# Revocation is stronger than suspension: it permanently revokes the operator and grant.
db.execute(
    "INSERT INTO employee_permission_grants(id,company_id,employee_profile_id,permission_key,scope_type,scope_id,status,granted_by,reason) "
    "VALUES ('grant-operator-1','co-1','emp-1','MOBILE_MONEY:OPERATE','PROVIDER_ACCOUNT','pa-1','ACTIVE','owner','Approved branch one Airtel operator access')"
)
db.execute(
    "UPDATE staff_work_assignments SET status='REVOKED',revoked_by='owner',revoked_at=CURRENT_TIMESTAMP WHERE id='work-mm-1'"
)
assert db.execute("SELECT approval_status FROM provider_operator_profiles WHERE id='op-1'").fetchone()[0] == "REVOKED"
assert db.execute("SELECT status FROM employee_permission_grants WHERE id='grant-operator-1'").fetchone()[0] == "REVOKED"
try:
    db.execute(
        "UPDATE staff_work_assignments SET status='ACTIVE',revoked_by=NULL,revoked_at=NULL WHERE id='work-mm-1'"
    )
    raise AssertionError("A revoked work assignment must remain terminal")
except sqlite3.IntegrityError:
    pass

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
