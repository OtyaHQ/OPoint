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
        self.assertEqual(migrations[-1].name, "0010_company_operations_level_1_2.sql")
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

    def test_suspended_assignment_cannot_be_reactivated_when_scope_is_no_longer_valid(self):
        self.db.execute(
            """INSERT INTO omni_staff_work_assignments
               (id, company_id, staff_membership_id, branch_id, work_area, duty_role, assigned_by)
               VALUES ('assign-1', 'company-a', 'staff-a', 'branch-a', 'RETAIL', 'OPERATOR', 'owner-a')"""
        )
        self.db.execute("UPDATE omni_staff_work_assignments SET status='SUSPENDED' WHERE id='assign-1'")

        self.db.execute("UPDATE omni_staff_memberships SET status='SUSPENDED' WHERE id='staff-a'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE omni_staff_work_assignments SET status='ACTIVE' WHERE id='assign-1'")
        self.db.execute("UPDATE omni_staff_memberships SET status='ACTIVE' WHERE id='staff-a'")

        self.db.execute("UPDATE omni_branches SET status='CLOSED' WHERE id='branch-a'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE omni_staff_work_assignments SET status='ACTIVE' WHERE id='assign-1'")
        self.db.execute("UPDATE omni_branches SET status='ACTIVE' WHERE id='branch-a'")

        self.db.execute("UPDATE omni_staff_work_assignments SET status='ACTIVE' WHERE id='assign-1'")
        status = self.db.execute(
            "SELECT status FROM omni_staff_work_assignments WHERE id='assign-1'"
        ).fetchone()[0]
        self.assertEqual(status, "ACTIVE")

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

    def test_new_tables_exist_after_sequential_migrations(self):
        expected = {
            "omni_branches", "omni_staff_work_assignments", "omni_customers",
            "omni_suppliers", "omni_purchase_orders", "omni_purchase_order_lines",
            "omni_expenses", "omni_business_compliance_items", "omni_provider_connections",
            "omni_staff_attendance", "omni_leave_requests", "omni_branch_stock",
            "omni_branch_stock_movements",
        }
        actual = {
            row[0] for row in self.db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        self.assertTrue(expected.issubset(actual), expected - actual)


if __name__ == "__main__":
    unittest.main()
