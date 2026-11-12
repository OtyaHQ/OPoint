#!/usr/bin/env python3
"""SQLite tests for Otya Enterprise's multi-outlet provider, asset and evidence model."""
from pathlib import Path
import sqlite3
import unittest

MIGRATIONS = sorted((Path(__file__).resolve().parents[1] / "migrations").glob("*.sql"))


class OtyaEnterpriseSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        for migration in MIGRATIONS:
            self.db.executescript("BEGIN;\n" + migration.read_text(encoding="utf-8") + "\nCOMMIT;")

    def tearDown(self):
        self.db.close()

    def insert_outlet(self, outlet_id, code, name):
        self.db.execute(
            """INSERT INTO omni_enterprise_outlets
               (id,company_id,outlet_code,name,physical_address,created_by,status)
               VALUES (?, 'company-otya', ?, ?, 'Mbirizi, Uganda', 'owner-1', 'ACTIVE')""",
            (outlet_id, code, name),
        )

    def insert_staff_and_employee(self):
        self.db.execute(
            """INSERT INTO omni_staff_memberships
               (id,identity_subject,company_id,role,status,display_name,email)
               VALUES ('staff-owner','identity-owner','company-otya','SOVEREIGN','ACTIVE',
                       'Company Owner','owner@example.invalid')"""
        )
        self.db.execute(
            """INSERT INTO omni_staff_memberships
               (id,identity_subject,company_id,role,status,display_name,email)
               VALUES ('staff-teller','identity-teller','company-otya','ATTENDANT','ACTIVE',
                       'Teller One','teller@example.invalid')"""
        )
        self.db.execute(
            """INSERT INTO omni_enterprise_employees
               (id,company_id,staff_membership_id,employee_number,legal_name,employment_status)
               VALUES ('employee-1','company-otya','staff-teller','EMP-0001','Teller One','ACTIVE')"""
        )
        self.db.execute(
            """INSERT INTO omni_employee_outlet_assignments
               (id,company_id,employee_id,outlet_id,assignment_role,starts_at,created_by)
               VALUES ('assign-1','company-otya','employee-1','outlet-1',
                       'AGENCY_TELLER','2026-01-01T00:00:00Z','staff-owner')"""
        )

    def test_all_enterprise_tables_exist_and_no_operational_seed_data_is_created(self):
        tables = {row[0] for row in self.db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )}
        required = {
            "omni_enterprise_company_profiles", "omni_enterprise_outlets",
            "omni_enterprise_employees", "omni_employee_outlet_assignments",
            "omni_provider_relationships", "omni_provider_outlet_accounts",
            "omni_provider_operator_profiles", "omni_company_sim_cards",
            "omni_company_devices", "omni_outlet_operating_accounts",
            "omni_outlet_account_movements", "omni_evidence_ingestion_items",
            "omni_provider_transaction_records", "omni_provider_balance_observations",
            "omni_receipt_documents", "omni_outlet_stock_balances",
        }
        self.assertTrue(required.issubset(tables))
        for table in ("omni_enterprise_outlets", "omni_provider_relationships",
                      "omni_provider_outlet_accounts", "omni_provider_transaction_records",
                      "omni_receipt_documents"):
            self.assertEqual(self.db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], 0)

    def test_one_company_provider_relationship_has_separate_outlet_accounts_and_operator_ids(self):
        self.insert_outlet("outlet-1", "OTYA-001", "Mbirizi")
        self.insert_outlet("outlet-2", "OTYA-002", "Masaka")
        self.insert_staff_and_employee()

        provider_codes = ("AIRTEL_MONEY", "MTN_MOMO", "INTERSWITCH_QUICKTELLER")
        account_ids = []
        for index, provider in enumerate(provider_codes, start=1):
            relationship_id = f"relationship-{index}"
            self.db.execute(
                """INSERT INTO omni_provider_relationships
                   (id,company_id,provider,provider_product,legal_agent_name,parent_agent_id,
                    agreement_status,agreement_reference,created_by)
                   VALUES (?,'company-otya',?,'CORPORATE_AGENT','Otya Holdings Limited',
                           ?, 'APPROVED', ?, 'staff-owner')""",
                (relationship_id, provider, f"PARENT-{index}", f"AGREEMENT-{index}"),
            )
            for outlet_number in (1, 2):
                account_id = f"account-{index}-{outlet_number}"
                account_ids.append((provider, account_id, f"outlet-{outlet_number}"))
                self.db.execute(
                    """INSERT INTO omni_provider_outlet_accounts
                       (id,company_id,provider_relationship_id,outlet_id,provider_outlet_id,
                        provider_account_reference,account_label,account_type,account_scope,status,created_by)
                       VALUES (?,'company-otya',?,?,?,?,'Main outlet float','AGENT_FLOAT','OUTLET','ACTIVE','staff-owner')""",
                    (account_id, relationship_id, f"outlet-{outlet_number}",
                     f"PROVIDER-OUTLET-{index}-{outlet_number}", f"PROVIDER-ACCOUNT-{index}-{outlet_number}"),
                )
                self.db.execute(
                    """INSERT INTO omni_provider_operator_profiles
                       (id,company_id,provider_relationship_id,provider_outlet_account_id,
                        employee_id,provider_operator_id,approval_status,approved_reference,created_by)
                       VALUES (?,?,?,?,?,?, 'APPROVED', ?, 'staff-owner')""",
                    (f"operator-{index}-{outlet_number}", "company-otya", relationship_id,
                     account_id, "employee-1", f"OPERATOR-{index}-{outlet_number}",
                     f"PROVIDER-APPROVAL-{index}-{outlet_number}"),
                )
        self.assertEqual(
            self.db.execute("SELECT COUNT(*) FROM omni_provider_relationships").fetchone()[0],
            3,
        )
        self.assertEqual(
            self.db.execute("SELECT COUNT(*) FROM omni_provider_outlet_accounts").fetchone()[0],
            6,
        )
        self.assertEqual(
            self.db.execute("SELECT COUNT(*) FROM omni_provider_operator_profiles").fetchone()[0],
            6,
        )
        self.assertEqual(
            self.db.execute("SELECT COUNT(DISTINCT parent_agent_id) FROM omni_provider_relationships").fetchone()[0],
            3,
        )

    def test_each_outlet_has_independent_cash_and_provider_float_book_balances(self):
        self.insert_outlet("outlet-1", "OTYA-001", "Mbirizi")
        self.insert_outlet("outlet-2", "OTYA-002", "Masaka")
        self.insert_staff_and_employee()
        self.db.execute(
            """INSERT INTO omni_provider_relationships
               (id,company_id,provider,provider_product,legal_agent_name,parent_agent_id,agreement_status,created_by)
               VALUES ('airtel-parent','company-otya','AIRTEL_MONEY','AGENCY','Otya Holdings Limited',
                       'AIRTEL-PARENT-001','APPROVED','staff-owner')"""
        )
        for outlet_number in (1, 2):
            self.db.execute(
                """INSERT INTO omni_provider_outlet_accounts
                   (id,company_id,provider_relationship_id,outlet_id,provider_outlet_id,
                    account_label,account_type,account_scope,status,created_by)
                   VALUES (?,?,?,? ,?,'Airtel outlet float','AGENT_FLOAT','OUTLET','ACTIVE','staff-owner')""",
                (f"airtel-account-{outlet_number}", "company-otya", "airtel-parent",
                 f"outlet-{outlet_number}", f"AIR-{outlet_number}"),
            )
            self.db.execute(
                """INSERT INTO omni_outlet_operating_accounts
                   (id,company_id,outlet_id,account_code,account_name,account_type,provider,
                    provider_outlet_account_id,created_by)
                   VALUES (?,?,?,'AIRTEL_FLOAT','Airtel float','PROVIDER_FLOAT','AIRTEL_MONEY',?,'staff-owner')""",
                (f"book-account-{outlet_number}", "company-otya", f"outlet-{outlet_number}",
                 f"airtel-account-{outlet_number}"),
            )
            self.db.execute(
                """INSERT INTO omni_outlet_account_movements
                   (id,company_id,account_id,movement_type,direction,amount_ugx,balance_after_ugx,
                    idempotency_key,actor_id,reason)
                   VALUES (?,?,?,'OPENING_BALANCE','IN',?,? ,?,'staff-owner','Opening book balance')""",
                (f"movement-{outlet_number}", "company-otya", f"book-account-{outlet_number}",
                 1_000_000 * outlet_number, 1_000_000 * outlet_number, f"opening-{outlet_number}"),
            )
        balances = self.db.execute(
            "SELECT outlet_id,book_balance_ugx FROM omni_outlet_operating_accounts ORDER BY outlet_id"
        ).fetchall()
        self.assertEqual(balances, [("outlet-1", 1_000_000), ("outlet-2", 2_000_000)])
        with self.assertRaisesRegex(sqlite3.IntegrityError, "OUTLET_ACCOUNT_MOVEMENTS_APPEND_ONLY"):
            self.db.execute("UPDATE omni_outlet_account_movements SET reason='tampered' WHERE id='movement-1'")

    def test_company_sim_device_and_multiple_provider_assignments_are_supported(self):
        self.insert_outlet("outlet-1", "OTYA-001", "Mbirizi")
        self.insert_staff_and_employee()
        self.db.execute(
            """INSERT INTO omni_company_sim_cards
               (id,company_id,carrier,msisdn,iccid,company_registration_status,use_type,created_by)
               VALUES ('sim-airtel','company-otya','AIRTEL','256700000001','ICCID-A','REGISTERED','AGENCY_OPERATION','staff-owner')"""
        )
        self.db.execute(
            """INSERT INTO omni_company_devices
               (id,company_id,asset_tag,device_type,manufacturer,model,imei_1,created_by)
               VALUES ('device-1','company-otya','OTYA-DEV-001','ANDROID_PHONE','Samsung','Android','356000000000001','staff-owner')"""
        )
        self.db.execute(
            """INSERT INTO omni_sim_assignments
               (id,company_id,sim_card_id,employee_id,outlet_id,starts_at,issued_by)
               VALUES ('sim-assignment-1','company-otya','sim-airtel','employee-1','outlet-1','2026-01-01T00:00:00Z','staff-owner')"""
        )
        self.db.execute(
            """INSERT INTO omni_device_assignments
               (id,company_id,device_id,employee_id,outlet_id,issued_at,issued_by)
               VALUES ('device-assignment-1','company-otya','device-1','employee-1','outlet-1','2026-01-01T00:00:00Z','staff-owner')"""
        )
        self.assertEqual(self.db.execute("SELECT status FROM omni_company_devices WHERE id='device-1'").fetchone()[0], "IN_STOCK")
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM omni_sim_assignments WHERE status='ACTIVE'").fetchone()[0], 1)

    def test_provider_records_default_to_unverified_and_are_append_only(self):
        self.insert_outlet("outlet-1", "OTYA-001", "Mbirizi")
        self.insert_staff_and_employee()
        self.db.execute(
            """INSERT INTO omni_provider_relationships
               (id,company_id,provider,provider_product,legal_agent_name,parent_agent_id,agreement_status,created_by)
               VALUES ('mtn-parent','company-otya','MTN_MOMO','AGENCY','Otya Holdings Limited','MTN-PARENT-001','APPROVED','staff-owner')"""
        )
        self.db.execute(
            """INSERT INTO omni_provider_outlet_accounts
               (id,company_id,provider_relationship_id,outlet_id,provider_outlet_id,account_label,account_type,status,created_by)
               VALUES ('mtn-outlet-account','company-otya','mtn-parent','outlet-1','MTN-OUTLET-01','MTN Float','AGENT_FLOAT','ACTIVE','staff-owner')"""
        )
        self.db.execute(
            """INSERT INTO omni_provider_transaction_records
               (id,company_id,provider,provider_relationship_id,provider_outlet_account_id,outlet_id,
                employee_id,provider_reference,transaction_type,amount_ugx,recorded_by,idempotency_key)
               VALUES ('transaction-1','company-otya','MTN_MOMO','mtn-parent','mtn-outlet-account','outlet-1',
                       'employee-1','MTN-REF-0001','CASH_IN',50000,'staff-teller','record-1')"""
        )
        row = self.db.execute(
            "SELECT source_status_claim,verification_level FROM omni_provider_transaction_records WHERE id='transaction-1'"
        ).fetchone()
        self.assertEqual(row, ("UNKNOWN", "UNVERIFIED"))
        with self.assertRaisesRegex(sqlite3.IntegrityError, "PROVIDER_TRANSACTION_RECORD_APPEND_ONLY"):
            self.db.execute("UPDATE omni_provider_transaction_records SET verification_level='READ_ONLY_PROVIDER_CONFIRMED' WHERE id='transaction-1'")

    def test_evidence_store_has_no_raw_message_field_and_balance_observations_are_separate(self):
        columns = {row[1] for row in self.db.execute("PRAGMA table_info(omni_evidence_ingestion_items)")}
        self.assertIn("extracted_fields_json", columns)
        self.assertIn("source_message_hash", columns)
        self.assertNotIn("raw_message_text", columns)
        self.insert_outlet("outlet-1", "OTYA-001", "Mbirizi")
        self.db.execute(
            """INSERT INTO omni_provider_relationships
               (id,company_id,provider,provider_product,legal_agent_name,parent_agent_id,agreement_status,created_by)
               VALUES ('quickteller-parent','company-otya','INTERSWITCH_QUICKTELLER','PAYPOINT','Otya Holdings Limited','QT-PARENT-001','APPROVED','staff-owner')"""
        )
        self.db.execute(
            """INSERT INTO omni_provider_outlet_accounts
               (id,company_id,provider_relationship_id,outlet_id,provider_outlet_id,account_label,account_type,status,created_by)
               VALUES ('qt-account','company-otya','quickteller-parent','outlet-1','QT-OUTLET-001','Quickteller outlet','AGENT_FLOAT','ACTIVE','staff-owner')"""
        )
        self.insert_staff_and_employee()
        self.db.execute(
            """INSERT INTO omni_provider_balance_observations
               (id,company_id,provider,provider_outlet_account_id,outlet_id,reported_balance_ugx,source_type,observed_at,recorded_by)
               VALUES ('balance-1','company-otya','INTERSWITCH_QUICKTELLER','qt-account','outlet-1',750000,'MANUAL_ENTRY','2026-11-12T12:00:00Z','staff-teller')"""
        )
        row = self.db.execute(
            "SELECT reported_balance_ugx,source_type,verification_level FROM omni_provider_balance_observations WHERE id='balance-1'"
        ).fetchone()
        self.assertEqual(row, (750000, "MANUAL_ENTRY", "UNVERIFIED"))

    def test_cross_company_provider_outlet_and_employee_links_are_rejected(self):
        self.insert_outlet("outlet-1", "OTYA-001", "Mbirizi")
        self.insert_staff_and_employee()
        self.db.execute(
            """INSERT INTO omni_enterprise_outlets
               (id,company_id,outlet_code,name,physical_address,created_by,status)
               VALUES ('other-outlet','other-company','OTHER-001','Other Shop','Other address','owner-other','ACTIVE')"""
        )
        self.db.execute(
            """INSERT INTO omni_provider_relationships
               (id,company_id,provider,provider_product,legal_agent_name,parent_agent_id,agreement_status,created_by)
               VALUES ('parent-a','company-otya','AIRTEL_MONEY','AGENCY','Otya Holdings Limited','AIR-PARENT-A','APPROVED','staff-owner')"""
        )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "PROVIDER_RELATIONSHIP_OUTLET_COMPANY_MISMATCH"):
            self.db.execute(
                """INSERT INTO omni_provider_outlet_accounts
                   (id,company_id,provider_relationship_id,outlet_id,account_label,account_type,status,created_by)
                   VALUES ('bad-account','company-otya','parent-a','other-outlet','Bad scope','AGENT_FLOAT','PENDING','staff-owner')"""
            )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "EMPLOYEE_OUTLET_COMPANY_MISMATCH"):
            self.db.execute(
                """INSERT INTO omni_employee_outlet_assignments
                   (id,company_id,employee_id,outlet_id,assignment_role,starts_at,created_by)
                   VALUES ('bad-assignment','company-otya','employee-1','other-outlet','TELLER',
                           '2026-01-01T00:00:00Z','staff-owner')"""
            )

    def test_outlet_stock_movements_update_only_the_selected_outlet_balance(self):
        self.insert_outlet("outlet-1", "OTYA-001", "Mbirizi")
        self.insert_outlet("outlet-2", "OTYA-002", "Masaka")
        self.insert_staff_and_employee()
        self.db.execute(
            """INSERT INTO omni_products
               (id,company_id,sku,name,cost_price,selling_price,quantity_on_hand)
               VALUES ('phone-1','company-otya','SKU-001','Android phone',250000,300000,0)"""
        )
        self.db.execute(
            """INSERT INTO omni_outlet_stock_movements
               (id,company_id,outlet_id,product_id,movement_type,quantity_delta,quantity_after,reason,actor_id)
               VALUES ('stock-open-1','company-otya','outlet-1','phone-1','OPENING',10,10,'Opening count','staff-teller')"""
        )
        self.db.execute(
            """INSERT INTO omni_outlet_stock_movements
               (id,company_id,outlet_id,product_id,movement_type,quantity_delta,quantity_after,reason,actor_id)
               VALUES ('stock-sale-1','company-otya','outlet-1','phone-1','SALE',-3,7,'Sale movement','staff-teller')"""
        )
        balance = self.db.execute(
            "SELECT quantity_on_hand FROM omni_outlet_stock_balances WHERE company_id='company-otya' AND outlet_id='outlet-1' AND product_id='phone-1'"
        ).fetchone()[0]
        self.assertEqual(balance, 7)
        self.assertEqual(
            self.db.execute("SELECT COUNT(*) FROM omni_outlet_stock_balances WHERE outlet_id='outlet-2'").fetchone()[0],
            0,
        )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "OUTLET_STOCK_MOVEMENT_MISMATCH"):
            self.db.execute(
                """INSERT INTO omni_outlet_stock_movements
                   (id,company_id,outlet_id,product_id,movement_type,quantity_delta,quantity_after,reason,actor_id)
                   VALUES ('stock-forged','company-otya','outlet-1','phone-1','SALE',-1,99,'Forged count','staff-teller')"""
            )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "OUTLET_STOCK_MOVEMENTS_APPEND_ONLY"):
            self.db.execute("UPDATE omni_outlet_stock_movements SET reason='tampered' WHERE id='stock-sale-1'")

    def test_provider_confirmed_balance_requires_authorised_feed_source(self):
        self.insert_outlet("outlet-1", "OTYA-001", "Mbirizi")
        self.insert_staff_and_employee()
        self.db.execute(
            """INSERT INTO omni_provider_relationships
               (id,company_id,provider,provider_product,legal_agent_name,parent_agent_id,agreement_status,created_by)
               VALUES ('air-parent','company-otya','AIRTEL_MONEY','AGENCY','Otya Holdings Limited','AIR-PARENT-01','APPROVED','staff-owner')"""
        )
        self.db.execute(
            """INSERT INTO omni_provider_outlet_accounts
               (id,company_id,provider_relationship_id,outlet_id,provider_outlet_id,account_label,account_type,status,created_by)
               VALUES ('air-account','company-otya','air-parent','outlet-1','AIR-OUTLET-1','Airtel Float','AGENT_FLOAT','ACTIVE','staff-owner')"""
        )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "PROVIDER_BALANCE_CONFIRMATION_SOURCE_REQUIRED"):
            self.db.execute(
                """INSERT INTO omni_provider_balance_observations
                   (id,company_id,provider,provider_outlet_account_id,outlet_id,reported_balance_ugx,
                    source_type,verification_level,observed_at,recorded_by)
                   VALUES ('forged-live-balance','company-otya','AIRTEL_MONEY','air-account','outlet-1',
                           999999,'MANUAL_ENTRY','READ_ONLY_PROVIDER_CONFIRMED','2026-11-12T12:00:00Z','staff-teller')"""
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
