-- Financial and audit history is append-only. Corrections must use compensating entries.
-- This is a code-only migration until separately reviewed and explicitly applied to D1.
CREATE TRIGGER IF NOT EXISTS omni_ledger_entries_no_update
BEFORE UPDATE ON omni_ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'LEDGER_APPEND_ONLY');
END;

CREATE TRIGGER IF NOT EXISTS omni_ledger_entries_no_delete
BEFORE DELETE ON omni_ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'LEDGER_APPEND_ONLY');
END;

CREATE TRIGGER IF NOT EXISTS omni_stock_movements_no_update
BEFORE UPDATE ON omni_stock_movements
BEGIN
  SELECT RAISE(ABORT, 'STOCK_MOVEMENT_APPEND_ONLY');
END;

CREATE TRIGGER IF NOT EXISTS omni_stock_movements_no_delete
BEFORE DELETE ON omni_stock_movements
BEGIN
  SELECT RAISE(ABORT, 'STOCK_MOVEMENT_APPEND_ONLY');
END;

CREATE TRIGGER IF NOT EXISTS omni_audit_events_no_update
BEFORE UPDATE ON omni_audit_events
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_EVENT_APPEND_ONLY');
END;

CREATE TRIGGER IF NOT EXISTS omni_audit_events_no_delete
BEFORE DELETE ON omni_audit_events
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_EVENT_APPEND_ONLY');
END;
