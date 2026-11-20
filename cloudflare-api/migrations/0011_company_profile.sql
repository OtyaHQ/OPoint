-- Company identity and receipt header data.
-- Planned/in-progress registration is distinct from verified incorporation.
CREATE TABLE IF NOT EXISTS omni_enterprise_company_profiles (
  company_id TEXT PRIMARY KEY,
  legal_name TEXT,
  trading_name TEXT,
  registration_number TEXT,
  tin TEXT,
  legal_status TEXT NOT NULL DEFAULT 'NOT_REGISTERED'
    CHECK (legal_status IN ('NOT_REGISTERED','REGISTRATION_IN_PROGRESS','REGISTERED','SUSPENDED')),
  incorporation_date TEXT,
  registered_address TEXT,
  principal_business_address TEXT,
  business_email TEXT,
  business_phone TEXT,
  website TEXT,
  country_code TEXT NOT NULL DEFAULT 'UG',
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  timezone TEXT NOT NULL DEFAULT 'Africa/Kampala',
  logo_object_key TEXT,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
