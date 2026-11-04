# PeopleOS architecture

The company portal and Super Admin are separate HTML/CSS/JavaScript applications hosted through Bun services. Both use Supabase JS, Auth and organization-scoped Postgres records. Database RLS, RPCs and service rules enforce authorization. Supabase Edge Functions handle invitations, company email and SMS notifications.

The exported source was extracted from the current Railway deployments. Frontend files are split for review; database migrations and production data are not exported. To deploy a new installation, provision the Supabase schema, private storage buckets, functions, policies and provider configuration separately.

The GitHub repository is not connected to production Railway continuous deployment.
