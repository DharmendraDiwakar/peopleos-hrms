# Security and publication

This public repository intentionally excludes private employee records, customer payroll data, credentials, real company uploaded branding, expense receipts, and production database exports.

Store provider credentials in Supabase/Railway secrets, not repository source. The browser should only receive the Supabase publishable key. Enforce organization boundaries and personnel permissions through database row-level security, not frontend menus alone.

Before external commercial use, independently test permission isolation, privileged functions, MFA/SSO, audit trails, backup restoration and jurisdiction-specific payroll compliance. This project is not independently security audited.
