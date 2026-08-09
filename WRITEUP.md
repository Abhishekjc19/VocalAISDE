# AgentFlow — Architecture Write-Up

## Schema Reasoning

The schema is designed around a clear organizational hierarchy: **org → members → workflows → steps/triggers → runs → step_runs**. Every table traces back to an organization, creating a natural scoping boundary.

### Key Design Decisions

**Organizations with quota tracking**: Rather than a separate billing table, the quota fields (`quota_limit`, `quota_used`, `quota_period_start`) live directly on the `organizations` table. This keeps quota checks to a single row lookup during execution — critical since `triggerWorkflowRun` must check the quota before starting. The `org_monthly_usage` view aggregates run data for dashboards but isn't needed for the hot path.

**JSONB for step config**: Each step type (llm_call, http_request, etc.) has fundamentally different configuration. Using `JSONB` instead of separate tables per type keeps the schema normalized and makes adding new step types trivial — just handle a new `step_type` enum value in the execution engine.

**Explicit `step_order` column**: Avoids linked-list complexity. Reordering is a simple swap of two integer values. The `UNIQUE(workflow_id, step_order)` constraint ensures no order collisions.

**`workflow_runs` with `paused` status**: The approval gate requires the run to pause mid-execution and resume later — this isn't a typical completed/failed binary. The `paused` status is a first-class state, not a hack.

**`step_runs` with approval columns**: `approved_by` and `approved_at` live on `step_runs` directly because an approval is step-scoped, not run-scoped. A workflow could have multiple approval gates at different points.

---

## How the Two Permission Layers Are Enforced Differently

### Layer 1: Org + Role Scoping (Database Permissions)

This layer is enforced by **Hasura row-level permissions** — it's declarative, and Hasura checks it on every GraphQL query/mutation before it reaches application code.

Every permission filter traverses the relationship chain back to `org_members`:

```yaml
# Example: a user can only SELECT workflows in their own org
filter:
  organization:
    org_members:
      user_id: { _eq: X-Hasura-User-Id }
```

The role (owner/editor/viewer) determines which **operations** are allowed (SELECT/INSERT/UPDATE/DELETE), while the org_members join determines which **rows** are visible. These are independent dimensions — an editor in Org A has full edit access to Org A's workflows, but zero visibility into Org B.

This design intentionally does NOT rely on a session variable like `X-Hasura-Org-Id` to scope queries. Instead, it re-derives the org scope from the `org_members` table every time. This prevents any client from spoofing org membership by manipulating headers.

### Layer 2: Step-Level Gating (Action Handler Code)

This layer **cannot** be a Hasura permission. Two reasons:

1. **Step type restrictions** (only owners can add `db_write`, `notify`, or `webhook` triggers): Hasura permissions can restrict which rows you INSERT/UPDATE, but they can't inspect the *value* of a JSONB field or a type column to conditionally allow/deny. The frontend hides these options for non-owners, and the Action handler rejects them server-side.

2. **Approval gate authorization**: When someone calls `approveStep`, the system must:
   - Verify the approver is in the same org as the workflow (not just any user)
   - Verify the approver's role is owner or editor (viewers can't approve)
   - Only then mark the step as approved and resume execution

   This is a **mid-execution decision**. The approval doesn't write a new row — it modifies an existing step_run's status and triggers continuation of the workflow. A Hasura UPDATE permission could theoretically allow the status change, but it can't trigger the subsequent step execution. The business logic (check role → approve → resume) must be atomic and handled in code.

---

## How the Approval-Gate Pause/Resume Is Implemented

### The Pause

In `triggerWorkflowRun`, the execution engine processes steps sequentially. When it encounters an `approval_gate` step:

```typescript
case 'approval_gate':
  // 1. Mark the step as paused
  await updateStepRun(stepRunId, { status: 'paused' });
  // 2. Mark the entire run as paused
  await updateWorkflowRun(runId, 'paused');
  // 3. Stop execution — return from the function
  return;
```

The function literally returns. There's no long-running process waiting — the run's state is persisted in the database, and the frontend subscription picks up the status change instantly.

### The Resume

The `approveStep` Action handler:

1. Fetches the step_run and its parent workflow, including all remaining steps
2. **Verifies the approver's org membership and role** (Layer 2 enforcement)
3. Marks the approval_gate step as `completed` with `approved_by` and `approved_at`
4. Sets the workflow_run back to `running`
5. Executes all remaining steps in order, starting from the step after the gate

This is effectively a new execution context — it picks up where the paused run left off. If there's another approval gate later in the pipeline, the same pause/resume cycle repeats.

### Why This Works

The key insight is that **state lives in the database, not in a running process**. There's no WebSocket held open, no worker thread blocked. The database records exactly where the workflow stopped, and the resume handler reads that state to continue. This makes the system:

- **Resilient**: Server restarts don't lose state
- **Scalable**: No long-lived connections per run
- **Observable**: The subscription sees every state change in real-time

### Retry Logic

For `llm_call` and `http_request` steps, the engine retries once on failure with a 1-second backoff. The `attempt_count` is tracked and visible in the UI, so operators can see if a step needed a retry.

### Quota Enforcement

The quota is checked at the start of `triggerWorkflowRun` and incremented only when the entire run completes (not per step). This prevents partial runs from consuming quota, and ensures the quota accurately reflects completed work.
