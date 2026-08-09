import { Request, Response } from 'express';

// ============================================================
// Scheduled Cron Trigger
// Runs on a schedule, finds all active scheduled triggers,
// and starts workflow runs for each.
// ============================================================

const HASURA_ENDPOINT = process.env.NHOST_HASURA_URL || 'http://localhost:1337/v1/graphql';
const HASURA_ADMIN_SECRET = process.env.NHOST_ADMIN_SECRET || 'nhost-admin-secret';

async function hasuraQuery(query: string, variables: Record<string, any> = {}) {
  const res = await fetch(HASURA_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': HASURA_ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

export default async function handler(req: Request, res: Response) {
  try {
    // Find all active scheduled triggers
    const data = await hasuraQuery(
      `query GetScheduledTriggers {
        workflow_triggers(where: { trigger_type: { _eq: "scheduled" }, is_active: { _eq: true } }) {
          id
          config
          workflow {
            id
            is_active
            org_id
            organization {
              quota_limit
              quota_used
            }
          }
        }
      }`
    );

    const triggers = data.workflow_triggers;
    const results: any[] = [];

    for (const trigger of triggers) {
      const workflow = trigger.workflow;
      if (!workflow.is_active) continue;
      
      const org = workflow.organization;
      if (org.quota_used >= org.quota_limit) {
        results.push({ workflow_id: workflow.id, status: 'skipped', reason: 'Quota exhausted' });
        continue;
      }

      // Check if cron schedule matches current time (simplified check)
      const cronConfig = trigger.config?.cron || '*/5 * * * *'; // Default: every 5 minutes
      // In production, use a proper cron parser. For now, always trigger.
      
      // Create a workflow run
      const createRun = await hasuraQuery(
        `mutation CreateScheduledRun($wid: uuid!) {
          insert_workflow_runs_one(object: {
            workflow_id: $wid,
            trigger_type: "scheduled",
            status: "pending",
            started_at: "now()"
          }) { id }
        }`,
        { wid: workflow.id }
      );

      results.push({
        workflow_id: workflow.id,
        workflow_run_id: createRun.insert_workflow_runs_one.id,
        status: 'triggered',
      });
    }

    res.json({ triggered: results.length, results });
  } catch (error: any) {
    console.error('Cron trigger error:', error);
    res.status(500).json({ message: error.message });
  }
}
