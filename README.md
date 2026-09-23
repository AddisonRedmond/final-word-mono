# Final Word

Final Word is a fast-paced multiplayer word game built as a Turborepo monorepo.

## Prerequisites

Before getting started, make sure you have:

* Node.js 22+
* pnpm
* Docker Desktop
* A GitHub account
* A Google account

Docker Desktop is required because the local Supabase stack runs in Docker containers.

## Getting Started

### 1. Clone the repository

```bash
git clone <your-repository-url>
cd final-word-mono
```

### 2. Install dependencies

From the repository root:

```bash
pnpm install
```

The repository uses pnpm workspaces and Turborepo.

### 3. Set up environment variables

Create the appropriate environment files using the existing environment variable names.

Your local client environment should contain values for:

```env
GITHUB_SECRET=
NEXT_PUBLIC_GITHUB_CLIENT_ID=

NEXT_PUBLIC_WS_URL=

NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=

DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

Do not commit environment files or secrets to Git.

## Local Supabase

Final Word uses a local Supabase instance for development so that local authentication and database changes do not affect production.

### 4. Start Docker Desktop

Make sure Docker Desktop is running before starting Supabase.

### 5. Start Supabase

From the repository root:

```bash
pnpm exec supabase start
```

The local Supabase services will be started in Docker.

Useful local URLs:

| Service         | URL                    |
| --------------- | ---------------------- |
| Supabase API    | http://127.0.0.1:54321 |
| Supabase Studio | http://127.0.0.1:54323 |
| Mailpit         | http://127.0.0.1:54324 |
| PostgreSQL      | `127.0.0.1:54322`      |

Supabase Studio can be used to inspect the local database, authentication users, RLS policies, and other local Supabase services.

Open:

http://127.0.0.1:54323

### Stop Supabase

When you're finished working:

```bash
pnpm exec supabase stop
```

You can start it again later with:

```bash
pnpm exec supabase start
```

## Local OAuth

Local development uses separate OAuth credentials from production.

This prevents local testing from relying on production OAuth applications.

### Google OAuth

Create a separate Google OAuth application for local development.

Use:

```text
Authorized JavaScript origin:
http://localhost:3000
```

and:

```text
Authorized redirect URI:
http://127.0.0.1:54321/auth/v1/callback
```

Add the local credentials to the environment used by the Supabase CLI:

```env
SUPABASE_AUTH_GOOGLE_CLIENT_ID=
SUPABASE_AUTH_GOOGLE_SECRET=
```

The local provider is configured in:

```text
supabase/config.toml
```

### GitHub OAuth

Create a separate GitHub OAuth application for local development.

Use:

```text
Homepage URL:
http://localhost:3000
```

and:

```text
Authorization callback URL:
http://127.0.0.1:54321/auth/v1/callback
```

Add the local credentials to the environment used by the Supabase CLI:

```env
SUPABASE_AUTH_GITHUB_CLIENT_ID=
SUPABASE_AUTH_GITHUB_SECRET=
```

After changing OAuth configuration, restart Supabase:

```bash
pnpm exec supabase stop
pnpm exec supabase start
```

## Database

Final Word uses Drizzle for the application database schema and Supabase migrations for Supabase-specific database functionality such as:

* Row Level Security
* PostgreSQL functions
* Triggers
* Supabase-specific configuration

Database migrations are committed to Git so local and production environments can be reproduced consistently.

### Local database

The local PostgreSQL database is available at:

```text
postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

### Reset the local database

To completely rebuild the local database from migrations:

```bash
pnpm exec supabase db reset
```

**Warning:** This deletes the local database and recreates it. It does not affect production.

### Supabase migrations

Supabase migrations are stored in:

```text
supabase/migrations/
```

Create a new migration:

```bash
pnpm exec supabase migration new <migration-name>
```

For example:

```bash
pnpm exec supabase migration new update_profile_rls
```

Edit the generated SQL file, then test it locally:

```bash
pnpm exec supabase db reset
```

Migration files should be committed to Git.

### Production database

Production database changes should be made through migrations rather than manually modifying the production database.

The migration files in Git should be treated as the source of truth for Supabase-specific database functionality.

## Running the Application

Once Docker Desktop and Supabase are running:

```bash
pnpm dev
```

To run only the client:

```bash
pnpm exec turbo dev --filter=client
```

The Next.js application runs at:

```text
http://localhost:3000
```

The development environment displays a `DEV` indicator at the top of the application.

## Next.js Development

The client allows `localhost` and `127.0.0.1` as development origins.

This is configured in:

```text
apps/client/next.config.js
```

If you change the `allowedDevOrigins` configuration, restart the Next.js development server.

## Turborepo Commands

Run all development tasks:

```bash
pnpm dev
```

Build everything:

```bash
pnpm build
```

Run linting:

```bash
pnpm lint
```

Run type checking:

```bash
pnpm check-types
```

Run a task for a specific package:

```bash
pnpm exec turbo dev --filter=client
```

or:

```bash
pnpm exec turbo build --filter=client
```

## Project Structure

```text
final-word-mono/
├── apps/
│   └── client/              # Next.js application
│
├── packages/
│   ├── db/                  # Drizzle database schema
│   ├── types/               # Shared types
│   └── ...                  # Shared packages
│
├── supabase/
│   ├── config.toml          # Local Supabase configuration
│   └── migrations/          # Supabase database migrations
│
├── package.json
├── pnpm-lock.yaml
└── turbo.json
```

## Environment Separation

Local development is intentionally separated from production.

```text
LOCAL
Next.js
   ↓
Local Supabase
   ↓
Local PostgreSQL
   ↓
Local OAuth providers
```

Production uses its own:

```text
PRODUCTION
Next.js
   ↓
Production Supabase
   ↓
Production PostgreSQL
   ↓
Production OAuth providers
```

Never put production credentials in local development environment files unless they are explicitly required.

## Useful Supabase Commands

Start Supabase:

```bash
pnpm exec supabase start
```

Stop Supabase:

```bash
pnpm exec supabase stop
```

Check Supabase status:

```bash
pnpm exec supabase status
```

Reset the local database:

```bash
pnpm exec supabase db reset
```

Create a migration:

```bash
pnpm exec supabase migration new <migration-name>
```

Check migration status:

```bash
pnpm exec supabase migration list
```

## Remote Caching

Turborepo can use Vercel Remote Cache to share build caches between machines and CI/CD.

Authenticate:

```bash
pnpm exec turbo login
```

Then link the repository:

```bash
pnpm exec turbo link
```

Remote caching is optional for local development.

## Troubleshooting

### Docker connection error

If Supabase reports an error connecting to Docker, make sure Docker Desktop is running.

Then try:

```bash
pnpm exec supabase start
```

### OAuth isn't working

Verify:

1. Supabase is running.
2. Your local OAuth credentials are configured.
3. The OAuth provider uses the local callback URL:

```text
http://127.0.0.1:54321/auth/v1/callback
```

4. Your Next.js app is running on:

```text
http://localhost:3000
```

5. Restart Supabase after changing `supabase/config.toml`:

```bash
pnpm exec supabase stop
pnpm exec supabase start
```

### Profiles aren't being created

The profile creation trigger runs when a new user is inserted into `auth.users`.

If you created users before the trigger existed, either delete those local users and log in again or backfill the existing users.

To inspect local users:

```sql
select *
from auth.users;
```

To inspect profiles:

```sql
select *
from public.profiles;
```

## Development Workflow

A typical development session looks like:

```bash
# Start Docker Desktop

# Start local Supabase
pnpm exec supabase start

# Start the application
pnpm dev
```

Then open:

```text
http://localhost:3000
```

When finished:

```bash
pnpm exec supabase stop
```

For database changes:

```text
Change schema/function
        ↓
Create migration
        ↓
Test locally
        ↓
Commit migration to Git
        ↓
Deploy migration to production
```

This keeps local and production database behavior reproducible and prevents development changes from accidentally affecting production.
