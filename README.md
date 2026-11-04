# PeopleOS HRMS

PeopleOS is a multi-tenant HRMS and workforce management SaaS project. The repository contains readable source snapshots exported from the deployed Railway Company Portal and Super Admin applications, plus Supabase Edge Functions.

## Live applications

- Company HRMS: https://peopleos-next-production.up.railway.app/
- Super Admin: https://peopleos-platform-admin-production.up.railway.app/

## Features

- Organization-scoped user management with roles for owners, HR, managers, team leaders and employees
- GPS attendance, check-in/check-out, breaks, and worked-hour calculations
- Team leave approvals and corrections
- Tasks, employee directory, recruitment workflows and expense proof attachments
- Salary structures, bulk payroll drafts, payslips, company branding and custom HTML/CSS templates
- Company email and attendance SMS integration workflows
- Multi-tenant Supabase Auth/Postgres authorization and private storage

## Source structure

```text
apps/
  company-portal/   # index.html, styles.css, app.js, server.js
  super-admin/      # index.html, styles.css, app.js, server.js
supabase/functions/
  invite-employee/
  company-email/
  attendance-sms/
docs/
```

## Local setup

Install [Bun](https://bun.sh/). Create a local `.env` from `.env.example` and set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.

Run `bun run start:company` or `bun run start:admin`. Each serves an application at `http://localhost:3000`.

**Database prerequisite:** A separate Supabase project needs a compatible schema, RLS, RPCs and storage buckets. The production database migration history is **not included**. This is not a complete standalone deployment.

## Important deployment notes

The current Railway applications are not connected to this GitHub repository for automatic deploys. Editing this repo will not update live production until deployment is explicitly configured. The exported source may need further integration and runtime testing.

No production employee records, payroll data, credentials, private uploads or database dumps are included.

**Maturity:** Working, evolving project. Not independently audited or certified for enterprise HR/payroll compliance.

See [Architecture](docs/ARCHITECTURE.md) and [Security](docs/SECURITY.md).
