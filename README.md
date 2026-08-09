# AgentFlow — AI Agent Workflow Builder

A full-stack mini n8n for chaining AI agent steps, built with **nhost + Hasura + PostgreSQL + GraphQL + Next.js**.

![AgentFlow](https://img.shields.io/badge/AgentFlow-AI_Workflows-7c3aed?style=for-the-badge)
![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square)
![Hasura](https://img.shields.io/badge/Hasura-GraphQL-1EB4D4?style=flat-square)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14-336791?style=flat-square)

## 🚀 Quick Start

### Prerequisites
- **Node.js** 18+
- **Docker** (for nhost local development)
- **nhost CLI** (`npm install -g nhost`)

### Setup

```bash
# 1. Clone the repo
git clone <repo-url>
cd agent-flow

# 2. Install dependencies
npm install --legacy-peer-deps

# 3. Set up environment
cp .env.local.example .env.local
# Edit .env.local with your API keys (see below)

# 4. Start nhost locally (Postgres + Hasura + Auth)
nhost up

# 5. Apply database migrations
# Migrations are automatically applied by nhost on startup

# 6. Start the Next.js frontend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### API Keys

| Variable | Required | Notes |
|----------|----------|-------|
| `GROQ_API_KEY` | Optional | Get a free key at [groq.com](https://console.groq.com). If not set, LLM calls are stubbed with a realistic delay. |
| `WEBHOOK_SECRET` | Set by default | Used for webhook trigger authentication |

### nhost Local URLs

When running `nhost up`, these services are available:
- **Hasura Console**: http://localhost:1337
- **GraphQL API**: http://localhost:1337/v1/graphql
- **Auth**: http://localhost:1337/v1/auth
- **Functions**: http://localhost:1337/v1/functions

## 📁 Project Structure

```
agent-flow/
├── nhost/
│   ├── config.yaml                 # nhost configuration
│   ├── migrations/
│   │   └── default/
│   │       └── 001_initial_schema/
│   │           ├── up.sql          # 8 tables + 1 view + triggers
│   │           └── down.sql        # Rollback
│   ├── metadata/
│   │   └── tables.yaml             # Hasura metadata (tables, relationships, permissions, actions)
│   └── functions/
│       ├── actions/
│       │   ├── trigger-run.ts      # Core workflow execution engine
│       │   └── approve-step.ts     # Approval gate handler
│       ├── webhooks/
│       │   └── trigger.ts          # Inbound webhook endpoint
│       └── scheduled/
│           └── cron-trigger.ts     # Cron-based scheduled trigger
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout + providers
│   │   ├── page.tsx                # Entry redirect
│   │   ├── login/page.tsx          # Authentication
│   │   ├── dashboard/page.tsx      # Org dashboard
│   │   ├── workflows/page.tsx      # Workflow list
│   │   ├── workflows/[id]/page.tsx # Workflow builder + live run viewer
│   │   └── settings/page.tsx       # Org members + quota
│   ├── components/
│   │   └── Sidebar.tsx             # Navigation sidebar
│   └── lib/
│       ├── nhost.ts                # nhost client config
│       ├── context.tsx             # Auth + Org context provider
│       └── graphql.ts              # All GraphQL operations
├── .env.local                      # Environment variables
└── package.json
```

## 🏗 Architecture

### Data Model
- **organizations** — name, slug, quota tracking (quota_limit, quota_used, period_start)
- **org_members** — user_id, org_id, role (owner/editor/viewer)
- **workflows** — belongs to an organization, name, description, active flag
- **workflow_steps** — ordered steps with type + JSONB config
- **workflow_triggers** — trigger type + config, tied to a workflow
- **workflow_runs** — one per execution, status supports `paused` state
- **step_runs** — per-step execution status, input/output, attempt count, approval tracking
- **watched_tables** — for database event triggers
- **org_monthly_usage** (view) — aggregated run counts and average duration

### Step Types
| Type | Description |
|------|------------|
| `llm_call` | Calls Groq LLM API (or stubbed with delay) |
| `http_request` | Generic external API call with retry |
| `db_write` | Writes results to internal tables |
| `notify` | Sends notification via Event Trigger |
| `conditional_branch` | If/else based on previous output |
| `approval_gate` | Pauses run until approved |

### Trigger Types
| Type | Description |
|------|------------|
| `manual` | User clicks "Run" button |
| `webhook` | External systems POST to `/webhooks/trigger` |
| `scheduled` | Cron-based via serverless function |
| `database_event` | Hasura Event Trigger on row changes |

## 🔒 Two-Layer Permission System

### Layer 1 — Org + Role Scoping (Hasura Row-Level Permissions)
Every Hasura permission filters through `org_members` to ensure a user can only access data from their own organization:
```yaml
filter:
  workflow:
    organization:
      org_members:
        user_id: { _eq: X-Hasura-User-Id }
```
- **owner**: Full CRUD on all resources
- **editor**: Create/edit workflows, steps, triggers; trigger runs; cannot manage members
- **viewer**: Read-only; cannot trigger runs

### Layer 2 — Step-Level Gating (Action Handler Enforcement)
Enforced programmatically in the serverless functions, not in Hasura permissions:
- Only **owners** can add `db_write`, `webhook` triggers, or `notify` steps (these reach outside the sandbox)
- `approval_gate` approval requires the Action handler to verify the approver's role before resuming
- This is a mid-execution decision that cannot be a simple database permission

## ⚙️ How the Approval Gate Works

1. When `triggerWorkflowRun` hits an `approval_gate` step, it sets `step_runs.status = 'paused'` and `workflow_runs.status = 'paused'`, then **stops execution**
2. The frontend subscription sees the paused state and renders an "Approve" button
3. When clicked, `approveStep` Action handler:
   - Fetches the step_run and verifies `status === 'paused'`
   - **Checks the approver is owner/editor in the step's org** (Layer 2)
   - Marks step as completed with `approved_by` and `approved_at`
   - Resumes the workflow from the next step
4. Quota is incremented only on full completion

## 📊 GraphQL Operations

### Query
- `GetOrgWorkflows` — org's workflows with steps, triggers, and most recent run status

### Mutations
- `CreateWorkflow` / `UpdateWorkflow` — manage workflow definitions
- `triggerWorkflowRun(workflow_id)` — Hasura Action to start a run
- `approveStep(step_run_id)` — Hasura Action to approve a paused step

### Subscription
- `StepRunsLive(workflow_run_id)` — live step-by-step progress including paused state

## 🧪 Final Scenario

To demonstrate the complete system working:

1. **Two orgs exist** — Org A (owner + editor) and Org B (different users)
2. **Build workflow in Org A** — llm_call → conditional_branch → http_request → approval_gate → db_write
3. **Two trigger methods** — manual Run button + webhook POST to `/webhooks/trigger`
4. **Approval gate** — run pauses, owner/editor approves, run resumes
5. **Live streaming** — step-by-step status via polling/subscription, no refresh needed
6. **Cross-org isolation** — Org B user cannot see, trigger, or approve anything from Org A

## 🚢 Deployment

### Frontend (Vercel)
```bash
# Push to GitHub, connect to Vercel, deploy
vercel deploy --prod
```

### Backend (nhost Cloud)
```bash
# Create nhost project at https://app.nhost.io
# Connect your GitHub repo
# nhost auto-deploys migrations, metadata, and functions
```

## License

MIT
