#!/usr/bin/env python3
"""Regression tests for the additive company-operations schema.

All migrations run against isolated in-memory SQLite. No Cloudflare resources,
provider credentials, customer data, or live payment operations are touched.
"""
from pathlib import Path
import sqlite3
import unittest

MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations"


class CompanyOperationsFoundationTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        migrations = sorted(MIGRATIONS_DIR.glob("*.sql"))
        self.assertTrue(migrations, "No D1 migrations were found")
        self.assertEqual(migrations[-1].name, "0011_branch_agency_accounts.sql")
        for migration in migrations:
            self.db.executescript(
                "BEGIN;\n" + migration.read_text(encoding="utf-8") + "\nCOMMIT;"
            )
        self.branch("branch-a", "company-a", "MAIN", "Main shop", primary=1)
        self.branch("branch-b", "company-a", "SECOND", "Second shop")
        self.branch("branch-x", "company-x", "MAIN", "Different company", primary=1)
        self.staff("staff-a", "identity-a", "company-a", "branch-a")
        self.staff("staff-x", "identity-x", "company-x", "branch-x")

    def tearDown(self):
        self.db.close()

    def branch(self, branch_id, company_id, code, name, primary=0):
        self.db.execute(
            """INSERT INTO omni_branches
               (id, company_id, branch_code, name, is_primary)
               VALUES (?, ?, ?, ?, ?)""",
            (branch_id, company_id, code, name, primary),
        )

    def staff(self, staff_id, identity, company_id, branch_id):
        self.db.execute(
            """INSERT INTO omni_staff_memberships
               (id, identity_subject, company_id, branch_id, role, status,
                display_name, email)
               VALUES (?, ?, ?, ?, 'ATTENDANT', 'ACTIVE', ?, ?)""",
            (staff_id, identity, company_id, branch_id, staff_id, identity + "@example.invalid"),
        )

    def product(self, product_id="product-a", company_id="company-a"):
        self.db.execute(
            """INSERT INTO omni_products
               (id, sku, name, category, cost_price, selling_price,
                quantity_on_hand, reorder_level, company_id)
               VALUES (?, ?, ?, 'Accessories', 1000, 1500, 0, 2, ?)""",
            (product_id, product_id.upper(), "Test product", company_id),
        )

    def test_one_primary_branch_per_company_and_independent_company_scope(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.branch("branch-a-duplicate", "company-a", "PRIMARY2", "Second primary", primary=1)
        self.branch("branch-x2", "company-x", "SECOND", "Other second", primary=0)

    def test_one_worker_can_have_separate_retail_and_mobile_money_assignments(self):
        self.db.executemany(
            """INSERT INTO omni_staff_work_assignments
               (id, company_id, staff_membership_id, branch_id, work_area,
                duty_role, assigned_by)
               VALUES (?, 'company-a', 'staff-a', 'branch-a', ?, ?, 'owner-a')""",
            [
                ("assign-retail", "RETAIL", "OPERATOR"),
                ("assign-money", "MOBILE_MONEY", "OPERATOR"),
            ],
        )
        areas = {
            row[0] for row in self.db.execute(
                """SELECT work_area FROM omni_staff_work_assignments
                   WHERE staff_membership_id='staff-a' AND status='ACTIVE'"""
            )
        }
        self.assertEqual(areas, {"RETAIL", "MOBILE_MONEY"})

    def test_duplicate_active_assignment_for_same_area_is_rejected(self):
        self.db.execute(
            """INSERT INTO omni_staff_work_assignments
               (id, company_id, staff_membership_id, branch_id, work_area, duty_role, assigned_by)
               VALUES ('first', 'company-a', 'staff-a', 'branch-a', 'RETAIL', 'OPERATOR', 'owner-a')"""
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO omni_staff_work_assignments
                   (id, company_id, staff_membership_id, branch_id, work_area, duty_role, assigned_by)
                   VALUES ('duplicate', 'company-a', 'staff-a', 'branch-a', 'RETAIL', 'APPROVER', 'owner-a')"""
            )

    def test_staff_cannot_be_assigned_across_company_or_unassigned_branch(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO omni_staff_work_assignments
                   (id, company_id, staff_membership_id, branch_id, work_area, duty_role, assigned_by)
                   VALUES ('wrong-company', 'company-x', 'staff-a', 'branch-x', 'RETAIL', 'OPERATOR', 'owner-x')"""
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO omni_staff_work_assignments
                   (id, company_id, staff_membership_id, branch_id, work_area, duty_role, assigned_by)
                   VALUES ('wrong-branch', 'company-a', 'staff-a', 'branch-b', 'RETAIL', 'OPERATOR', 'owner-a')"""
            )

    def test_branch_stock_movements_are_balanced_scoped_and_append_only(self):
        self.product()
        self.db.execute(
            """INSERT INTO omni_branch_stock_movements
               (id, company_id, branch_id, product_id, movement_type, quantity_delta,
                quantity_after, idempotency_key, actor_id, reason)
               VALUES ('opening', 'company-a', 'branch-a', 'product-a', 'OPENING',
                       10, 10, 'opening-a', 'owner-a', 'Verified opening count')"""
        )
        self.db.execute(
            """INSERT INTO omni_branch_stock_movements
               (id, company_id, branch_id, product_id, movement_type, quantity_delta,
                quantity_after, idempotency_key, actor_id, reason)
               VALUES ('sale', 'company-a', 'branch-a', 'product-a', 'SALE',
                       -3, 7, 'sale-a', 'operator-a', 'Completed sale')"""
        )
        balance = self.db.execute(
            """SELECT quantity_on_hand FROM omni_branch_stock
               WHERE company_id='company-a' AND branch_id='branch-a' AND product_id='product-a'"""
        ).fetchone()[0]
        self.assertEqual(balance, 7)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """UPDATE omni_branch_stock_movements SET quantity_after=8 WHERE id='sale'"""
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO omni_branch_stock_movements
                   (id, company_id, branch_id, product_id, movement_type, quantity_delta,
                    quantity_after, idempotency_key, actor_id, reason)
                   VALUES ('forged', 'company-x', 'branch-a', 'product-a', 'ADJUSTMENT',
                           1, 8, 'forged-a', 'operator-x', 'Cross-company test')"""
            )

    def test_supplier_purchase_order_and_lines_are_company_scoped(self):
        self.product()
        self.db.execute(
            """INSERT INTO omni_suppliers
               (id, company_id, supplier_code, business_name, created_by)
               VALUES ('supplier-a', 'company-a', 'SUP-001', 'Example Supplier', 'owner-a')"""
        )
        self.db.execute(
            """INSERT INTO omni_purchase_orders
               (id, company_id, branch_id, supplier_id, order_number, created_by)
               VALUES ('po-a', 'company-a', 'branch-a', 'supplier-a', 'PO-001', 'manager-a')"""
        )
        self.db.execute(
            """INSERT INTO omni_purchase_order_lines
               (id, company_id, purchase_order_id, product_id, quantity_ordered, unit_cost, line_total)
               VALUES ('po-line-a', 'company-a', 'po-a', 'product-a', 10, 1000, 10000)"""
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """UPDATE omni_purchase_order_lines SET quantity_received=11 WHERE id='po-line-a'"""
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO omni_purchase_orders
                   (id, company_id, branch_id, supplier_id, order_number, created_by)
                   VALUES ('po-x', 'company-x', 'branch-a', 'supplier-a', 'PO-X', 'owner-x')"""
            )

    def test_expenses_require_positive_ugx_amount_and_valid_branch(self):
        self.db.execute(
            """INSERT INTO omni_expenses
               (id, company_id, branch_id, expense_reference, category, description,
                amount, payment_method, created_by)
               VALUES ('expense-a', 'company-a', 'branch-a', 'EXP-001',
                       'RENT', 'Monthly shop rent', 250000, 'BANK', 'manager-a')"""
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO omni_expenses
                   (id, company_id, branch_id, expense_reference, category, description,
                    amount, payment_method, created_by)
                   VALUES ('expense-x', 'company-x', 'branch-a', 'EXP-X',
                           'RENT', 'Invalid branch scope', 50000, 'CASH', 'owner-x')"""
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO omni_expenses
                   (id, company_id, branch_id, expense_reference, category, description,
                    amount, payment_method, created_by)
                   VALUES ('expense-zero', 'company-a', 'branch-a', 'EXP-Z',
                           'OTHER', 'Invalid zero amount', 0, 'CASH', 'manager-a')"""
            )

    def test_compliance_register_stores_private_object_reference_not_identity_vault_fields(self):
        columns = {
            row[1] for row in self.db.execute("PRAGMA table_info(omni_business_compliance_items)")
        }
        self.assertIn("private_object_key", columns)
        self.assertNotIn("nin", {name.lower() for name in columns})
        self.assertNotIn("selfie", {name.lower() for name in columns})
        self.db.execute(
            """INSERT INTO omni_business_compliance_items
               (id, company_id, branch_id, document_type, display_label,
                private_object_key, created_by)
               VALUES ('licence-a', 'company-a', 'branch-a', 'TRADING_LICENCE',
                       'Main shop trading licence', 'private/compliance/licence-a.pdf', 'owner-a')"""
        )

    def test_provider_connections_are_distinct_and_production_writes_fail_closed(self):
        self.db.execute(
            """INSERT INTO omni_provider_connections
               (id, company_id, provider, capability, environment, status)
               VALUES ('qtb-sandbox', 'company-a', 'QUICKTELLER_BUSINESS',
                       'STATUS_ENQUIRY', 'SANDBOX', 'SANDBOX_READY')"""
        )
        self.db.execute(
            """INSERT INTO omni_provider_connections
               (id, company_id, provider, capability, environment, status)
               VALUES ('isw-sandbox', 'company-a', 'INTERSWITCH_MARKETPLACE',
                       'STATUS_ENQUIRY', 'SANDBOX', 'SANDBOX_READY')"""
        )
        providers = {
            row[0] for row in self.db.execute(
                "SELECT provider FROM omni_provider_connections WHERE company_id='company-a'"
            )
        }
        self.assertEqual(providers, {"QUICKTELLER_BUSINESS", "INTERSWITCH_MARKETPLACE"})
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO omni_provider_connections
                   (id, company_id, provider, capability, environment, status, production_write_enabled)
                   VALUES ('mtn-live-unsafe', 'company-a', 'MTN_MOMO', 'CASH_IN',
                           'PRODUCTION', 'PENDING_PROVIDER_APPROVAL', 1)"""
            )

    def test_attendance_and_leave_are_branch_scoped_without_medical_document_fields(self):
        self.db.execute(
            """INSERT INTO omni_staff_attendance
               (id, company_id, branch_id, staff_membership_id, work_date,
                status, recorded_by)
               VALUES ('attendance-a', 'company-a', 'branch-a', 'staff-a',
                       '2026-11-16', 'PRESENT', 'manager-a')"""
        )
        self.db.execute(
            """INSERT INTO omni_leave_requests
               (id, company_id, branch_id, staff_membership_id, leave_type,
                start_date, end_date)
               VALUES ('leave-a', 'company-a', 'branch-a', 'staff-a',
                       'ANNUAL', '2026-12-01', '2026-12-03')"""
        )
        columns = {
            row[1] for row in self.db.execute("PRAGMA table_info(omni_leave_requests)")
        }
        self.assertNotIn("medical_diagnosis", {name.lower() for name in columns})
        self.assertNotIn("medical_document", {name.lower() for name in columns})

    def test_agency_transactions_have_branch_scope_and_integrity_guard(self):
        columns = {row[1] for row in self.db.execute("PRAGMA table_info(omni_agency_transactions)")}
        self.assertIn("branch_id", columns)
        objects = {
            row[0] for row in self.db.execute(
                "SELECT name FROM sqlite_master WHERE type IN ('index','trigger')"
            )
        }
        self.assertIn("idx_omni_agency_company_branch_created", objects)
        self.assertIn("omni_agency_transactions_branch_guard", objects)
        self.db.execute(
            """INSERT INTO omni_agency_transactions
               (id,reference,transaction_type,provider,provider_status,amount,commission,
                idempotency_key,actor_id,company_id,branch_id)
               VALUES ('agency-a','AG-A','CASH_IN','MANUAL','PENDING',1000,0,
                       'agency-key-a','staff-a','company-a','branch-a')"""
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO omni_agency_transactions
                   (id,reference,transaction_type,provider,provider_status,amount,commission,
                    idempotency_key,actor_id,company_id,branch_id)
                   VALUES ('agency-x','AG-X','CASH_IN','MANUAL','PENDING',1000,0,
                           'agency-key-x','staff-a','company-a','branch-x')"""
            )

    def test_branch_agency_cash_float_book_is_scoped_balanced_and_append_only(self):
        cash_id, float_id = "cash-branch-a", "float-branch-a"
        self.db.execute(
            """INSERT INTO omni_branch_agency_accounts
               (id,company_id,branch_id,account_type,provider,account_code,display_name,idempotency_key,created_by)
               VALUES (?, 'company-a', 'branch-a', 'CASH_DRAWER', NULL, 'BRANCH_AGENCY_CASH',
                       'Main shop cash', 'cash-account-a', 'owner-a')""",
            (cash_id,),
        )
        self.db.execute(
            """INSERT INTO omni_branch_agency_accounts
               (id,company_id,branch_id,account_type,provider,account_code,display_name,idempotency_key,created_by)
               VALUES (?, 'company-a', 'branch-a', 'PROVIDER_FLOAT', 'MTN_MOMO', 'BRANCH_FLOAT_MTN',
                       'Main shop MTN float', 'mtn-account-a', 'owner-a')""",
            (float_id,),
        )
        self.db.execute(
            """INSERT INTO omni_branch_agency_account_movements
               (id,company_id,branch_id,account_id,movement_type,direction,amount,balance_after,idempotency_key,actor_id,reason)
               VALUES ('cash-open-a','company-a','branch-a',?,'OPENING_BALANCE','IN',100000,100000,
                       'cash-open-a','owner-a','Owner-recorded opening cash')""",
            (cash_id,),
        )
        self.db.execute(
            """INSERT INTO omni_branch_agency_account_movements
               (id,company_id,branch_id,account_id,movement_type,direction,amount,balance_after,idempotency_key,actor_id,reason)
               VALUES ('float-open-a','company-a','branch-a',?,'OPENING_BALANCE','IN',200000,200000,
                       'float-open-a','owner-a','Owner-recorded opening float')""",
            (float_id,),
        )
        self.db.execute(
            """INSERT INTO omni_branch_agency_operations
               (id,company_id,branch_id,reference,transaction_type,provider,provider_reference,
                amount,cash_account_id,float_account_id,request_fingerprint,idempotency_key,actor_id)
               VALUES ('operation-a','company-a','branch-a','AG-001','CASH_IN','MTN_MOMO','MTN-REF-001',
                       10000,?,?, 'fingerprint-a','operation-a','staff-a')""",
            (cash_id, float_id),
        )
        self.db.execute(
            """INSERT INTO omni_branch_agency_account_movements
               (id,company_id,branch_id,account_id,operation_id,movement_type,direction,amount,balance_after,idempotency_key,actor_id,reason)
               VALUES ('cash-in-a','company-a','branch-a',?,'operation-a','CASH_IN','IN',10000,110000,
                       'operation-a:cash','staff-a','Operator recorded cash-in')""",
            (cash_id,),
        )
        self.db.execute(
            """INSERT INTO omni_branch_agency_account_movements
               (id,company_id,branch_id,account_id,operation_id,movement_type,direction,amount,balance_after,idempotency_key,actor_id,reason)
               VALUES ('float-out-a','company-a','branch-a',?,'operation-a','CASH_IN','OUT',10000,190000,
                       'operation-a:float','staff-a','Operator recorded float-out')""",
            (float_id,),
        )
        balances = {
            row[0]: row[1] for row in self.db.execute(
                "SELECT id,current_balance FROM omni_branch_agency_accounts WHERE company_id='company-a' AND branch_id='branch-a'"
            )
        }
        self.assertEqual(balances[cash_id], 110000)
        self.assertEqual(balances[float_id], 190000)
        record = self.db.execute(
            "SELECT recording_status FROM omni_branch_agency_operations WHERE id='operation-a'"
        ).fetchone()[0]
        self.assertEqual(record, "OPERATOR_RECORDED_UNVERIFIED")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO omni_branch_agency_account_movements
                   (id,company_id,branch_id,account_id,movement_type,direction,amount,balance_after,idempotency_key,actor_id,reason)
                   VALUES ('cross-branch','company-a','branch-b',?,'OPENING_BALANCE','IN',1,1,
                           'cross-branch-key','owner-a','Must not cross branch')""",
                (cash_id,),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "UPDATE omni_branch_agency_operations SET amount=1 WHERE id='operation-a'"
            )

    def test_new_tables_exist_after_sequential_migrations(self):
        expected = {
            "omni_branches", "omni_staff_work_assignments", "omni_customers",
            "omni_suppliers", "omni_purchase_orders", "omni_purchase_order_lines",
            "omni_expenses", "omni_business_compliance_items", "omni_provider_connections",
            "omni_staff_attendance", "omni_leave_requests", "omni_branch_stock",
            "omni_branch_stock_movements", "omni_branch_agency_accounts",
            "omni_branch_agency_operations", "omni_branch_agency_account_movements",
        }
        actual = {
            row[0] for row in self.db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        self.assertTrue(expected.issubset(actual), expected - actual)


if __name__ == "__main__":
    unittest.main()
