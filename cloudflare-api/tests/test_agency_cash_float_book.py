#!/usr/bin/env python3
"""Regression tests for OtyaPoint's local cash and provider-float book.

These tests execute every checked-in D1 migration against an isolated in-memory
SQLite database. They never connect to Cloudflare or write production records.
"""
from pathlib import Path
import sqlite3
import unittest


MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations"


class AgencyCashFloatBookTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        migrations = sorted(MIGRATIONS_DIR.glob("*.sql"))
        self.assertTrue(migrations, "No D1 migrations were found")
        self.assertEqual(migrations[-1].name, "0009_agency_cash_float_book.sql")
        for migration in migrations:
            self.db.executescript(
                "BEGIN;\n"
                + migration.read_text(encoding="utf-8")
                + "\nCOMMIT;"
            )

        self.create_account(
            "cash-a", "company-a", "CASH_DRAWER", None,
            "AGENCY_CASH_DRAWER", "Shop cash drawer",
        )
        self.create_account(
            "mtn-float-a", "company-a", "PROVIDER_FLOAT", "MTN_MOMO",
            "AGENCY_FLOAT_MTN_MOMO", "MTN float",
        )
        self.create_account(
            "airtel-float-a", "company-a", "PROVIDER_FLOAT", "AIRTEL_MONEY",
            "AGENCY_FLOAT_AIRTEL_MONEY", "Airtel float",
        )
        self.opening_balance("cash-a", "company-a", 50_000, "cash-opening")
        self.opening_balance("mtn-float-a", "company-a", 20_000, "mtn-opening")
        self.opening_balance("airtel-float-a", "company-a", 25_000, "airtel-opening")

    def tearDown(self):
        self.db.close()

    def create_account(self, account_id, company_id, account_type, provider,
                       account_code, display_name):
        self.db.execute(
            """
            INSERT INTO omni_agency_accounts
              (id, company_id, account_type, provider, account_code, display_name,
               currency, current_balance, status, idempotency_key,
               request_fingerprint, created_by)
            VALUES (?, ?, ?, ?, ?, ?, 'UGX', 0, 'ACTIVE', ?, ?, 'owner-test')
            """,
            (
                account_id, company_id, account_type, provider, account_code,
                display_name, "account:" + account_id, "fingerprint:" + account_id,
            ),
        )

    def opening_balance(self, account_id, company_id, amount, key):
        self.db.execute(
            """
            INSERT INTO omni_agency_account_movements
              (id, company_id, account_id, operation_id, movement_type, direction,
               amount, balance_after, idempotency_key, actor_id, reason)
            VALUES (?, ?, ?, NULL, 'OPENING_BALANCE', 'IN', ?, ?, ?, 'owner-test',
                    'Verified opening count for isolated schema test')
            """,
            ("movement:" + key, company_id, account_id, amount, amount, key),
        )

    def create_operation(self, operation_id, transaction_type, amount,
                         idempotency_key=None, cash_account_id="cash-a",
                         float_account_id="mtn-float-a", company_id="company-a",
                         provider="MTN_MOMO", provider_reference=None):
        self.db.execute(
            """
            INSERT INTO omni_agency_operations
              (id, company_id, reference, transaction_type, provider,
               provider_reference, customer_reference_last4, amount, currency,
               cash_account_id, float_account_id, recording_status,
               request_fingerprint, idempotency_key, actor_id)
            VALUES (?, ?, ?, ?, ?, ?, '1234', ?, 'UGX', ?, ?,
                    'OPERATOR_RECORDED_UNVERIFIED', ?, ?, 'attendant-test')
            """,
            (
                operation_id, company_id, "REF-" + operation_id,
                transaction_type, provider,
                provider_reference or "PROVIDER-" + operation_id,
                amount, cash_account_id, float_account_id,
                "fingerprint:" + operation_id,
                idempotency_key or "operation:" + operation_id,
            ),
        )

    def movement(self, movement_id, operation_id, account_id, company_id,
                 movement_type, direction, amount, balance_after, key):
        self.db.execute(
            """
            INSERT INTO omni_agency_account_movements
              (id, company_id, account_id, operation_id, movement_type, direction,
               amount, balance_after, idempotency_key, actor_id, reason)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'attendant-test',
                    'Operator-recorded test movement; provider status remains unverified')
            """,
            (
                movement_id, company_id, account_id, operation_id, movement_type,
                direction, amount, balance_after, key,
            ),
        )

    def balance(self, account_id):
        row = self.db.execute(
            "SELECT current_balance FROM omni_agency_accounts WHERE id = ?",
            (account_id,),
        ).fetchone()
        return row[0]

    def test_opening_balances_are_applied_to_the_correct_company_accounts(self):
        self.assertEqual(self.balance("cash-a"), 50_000)
        self.assertEqual(self.balance("mtn-float-a"), 20_000)
        self.assertEqual(self.balance("airtel-float-a"), 25_000)

    def test_complete_health_readiness_schema_objects_exist_after_all_migrations(self):
        tables = {
            row[0] for row in self.db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        objects = {
            row[0] for row in self.db.execute(
                "SELECT name FROM sqlite_master WHERE type IN ('index','trigger')"
            )
        }
        self.assertTrue({
            "omni_products", "omni_retail_sales", "omni_retail_sale_lines",
            "omni_stock_movements", "omni_agency_transactions", "omni_ledger_entries",
            "omni_reconciliation_sessions", "omni_audit_events", "omni_staff_memberships",
            "omni_staff_invitations", "omni_agency_accounts", "omni_agency_operations",
            "omni_agency_account_movements",
        }.issubset(tables))
        self.assertTrue({
            "idx_omni_sales_company_idempotency",
            "idx_omni_one_active_sovereign_per_company",
            "idx_omni_owner_bootstrap_once",
            "idx_omni_staff_company_status_role",
            "idx_omni_staff_invitation_pending_email",
            "idx_omni_staff_invitation_company_status",
            "idx_omni_staff_invitation_expiry",
            "omni_staff_invitation_membership_guard",
            "omni_ledger_entries_no_update", "omni_ledger_entries_no_delete",
            "omni_stock_movements_no_update", "omni_stock_movements_no_delete",
            "omni_audit_events_no_update", "omni_audit_events_no_delete",
            "idx_omni_agency_one_active_cash_drawer",
            "idx_omni_agency_one_active_provider_float",
            "omni_agency_account_movement_guard",
            "omni_agency_account_movement_apply",
            "omni_agency_operations_guard",
            "omni_agency_operations_no_update", "omni_agency_operations_no_delete",
            "omni_agency_account_movements_no_update",
            "omni_agency_account_movements_no_delete",
        }.issubset(objects))

    def test_cash_in_moves_customer_cash_into_drawer_and_out_of_provider_float(self):
        self.create_operation("cash-in-1", "CASH_IN", 5_000)
        self.movement(
            "cash-in-cash-leg", "cash-in-1", "cash-a", "company-a",
            "CASH_IN", "IN", 5_000, 55_000, "cash-in-cash-leg-key",
        )
        self.movement(
            "cash-in-float-leg", "cash-in-1", "mtn-float-a", "company-a",
            "CASH_IN", "OUT", 5_000, 15_000, "cash-in-float-leg-key",
        )
        self.assertEqual(self.balance("cash-a"), 55_000)
        self.assertEqual(self.balance("mtn-float-a"), 15_000)
        status = self.db.execute(
            "SELECT recording_status FROM omni_agency_operations WHERE id='cash-in-1'"
        ).fetchone()[0]
        self.assertEqual(status, "OPERATOR_RECORDED_UNVERIFIED")

    def test_cash_out_moves_cash_out_of_drawer_and_into_provider_float(self):
        self.create_operation("cash-out-1", "CASH_OUT", 3_000)
        self.movement(
            "cash-out-cash-leg", "cash-out-1", "cash-a", "company-a",
            "CASH_OUT", "OUT", 3_000, 47_000, "cash-out-cash-leg-key",
        )
        self.movement(
            "cash-out-float-leg", "cash-out-1", "mtn-float-a", "company-a",
            "CASH_OUT", "IN", 3_000, 23_000, "cash-out-float-leg-key",
        )
        self.assertEqual(self.balance("cash-a"), 47_000)
        self.assertEqual(self.balance("mtn-float-a"), 23_000)

    def test_wrong_operation_leg_is_rejected_without_changing_balances(self):
        self.create_operation("cash-in-wrong-leg", "CASH_IN", 1_000)
        with self.assertRaises(sqlite3.IntegrityError):
            self.movement(
                "wrong-leg", "cash-in-wrong-leg", "cash-a", "company-a",
                "CASH_IN", "OUT", 1_000, 49_000, "wrong-leg-key",
            )
        self.assertEqual(self.balance("cash-a"), 50_000)

    def test_cross_company_cash_account_cannot_be_used_by_another_company(self):
        self.create_account(
            "cash-b", "company-b", "CASH_DRAWER", None,
            "AGENCY_CASH_DRAWER", "Other company's cash drawer",
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.create_operation(
                "cross-company", "CASH_IN", 1_000,
                cash_account_id="cash-b",
            )

    def test_balance_cannot_be_set_to_a_negative_or_forged_value(self):
        self.create_operation("overdraw", "CASH_OUT", 60_000)
        with self.assertRaises(sqlite3.IntegrityError):
            self.movement(
                "overdrawn-cash", "overdraw", "cash-a", "company-a",
                "CASH_OUT", "OUT", 60_000, -10_000, "overdrawn-cash-key",
            )
        self.assertEqual(self.balance("cash-a"), 50_000)

        with self.assertRaises(sqlite3.IntegrityError):
            self.movement(
                "forged-balance", "overdraw", "cash-a", "company-a",
                "CASH_OUT", "OUT", 1_000, 49_999, "forged-balance-key",
            )
        self.assertEqual(self.balance("cash-a"), 50_000)

    def test_duplicate_operation_idempotency_key_is_rejected(self):
        self.create_operation("operation-first", "CASH_IN", 1_000, "same-key")
        with self.assertRaises(sqlite3.IntegrityError):
            self.create_operation("operation-second", "CASH_IN", 1_000, "same-key")

    def test_agency_operations_and_movements_are_append_only(self):
        self.create_operation("immutable-operation", "CASH_IN", 1_000)
        self.movement(
            "immutable-movement", "immutable-operation", "cash-a", "company-a",
            "CASH_IN", "IN", 1_000, 51_000, "immutable-movement-key",
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "UPDATE omni_agency_operations SET amount=2 WHERE id='immutable-operation'"
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "DELETE FROM omni_agency_operations WHERE id='immutable-operation'"
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "UPDATE omni_agency_account_movements SET amount=2 WHERE id='immutable-movement'"
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "DELETE FROM omni_agency_account_movements WHERE id='immutable-movement'"
            )


if __name__ == "__main__":
    unittest.main()
