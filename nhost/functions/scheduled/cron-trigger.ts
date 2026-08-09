import { Request, Response } from 'express';

// ============================================================
// Scheduled Cron Trigger
// Runs on a schedule, finds all active scheduled triggers,
// and starts workflow runs for each.
// Uses cron-parser to evaluate schedules against current time.
// ============================================================

const HASURA_ENDPOINT = process.env.NHOST_HASURA_URL || 'http://localhost:1337/v1/graphql';
const HASURA_ADMIN_SECRET = process.env.NHOST_ADMIN_SECRET || 'nhost-admin-secret';

// Simple cron expression parser
// Format: minute hour day month day-of-week
// Supports: * (any), numbers, ranges (1-5), steps (*/5)
function parseCronExpression(cron: string): (date: Date) => boolean {
  const parts = cron.split(/\s+/);
  if (parts.length !== 5) return () => true; // Invalid format, always trigger
  
  const [minStr, hourStr, dayStr, monthStr, dowStr] = parts;
  
  function parseField(field: string, min: number, max: number): Set<number> {
    const values = new Set<number>();
    
    if (field === '*') {
      for (let i = min; i <= max; i++) values.add(i);
      return values;
    }
    
    // Handle step values like */5
    if (field.startsWith('*/')) {
      const step = parseInt(field.slice(2));
      for (let i = min; i <= max; i += step) values.add(i);
      return values;
    }
    
    // Handle ranges like 1-5
    const rangeParts = field.split('-');
    if (rangeParts.length === 2) {
      const rangeMin = parseInt(rangeParts[0]);
      const rangeMax = parseInt(rangeParts[1]);
      for (let i = rangeMin; i <= rangeMax; i++) values.add(i);
      return values;
    }
    
    // Single number
    const num = parseInt(field);
    if (!isNaN(num)) values.add(num);
    
    return values;
  }
  
  const minutes = parseField(minStr, 0, 59);
  const hours = parseField(hourStr, 0, 23);
  const days = parseField(dayStr, 1, 31);
  const months = parseField(monthStr, 1, 12);
  const dows = parseField(dowStr, 0, 6);
  
  return (date: Date) => {
    return minutes.has(date.getUTCMinutes()) &&
           hours.has(date.getUTCHours()) &&
           days.has(date.getUTCDate()) &&
           months.has(date.getUTCMonth() + 1) &&
           dows.has(date.getUTCDay());
  };
}

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

      // Check if cron schedule matches current time
      const cronConfig = trigger.config?.cron || '*/5 * * * *'; // Default: every 5 minutes
      const matcher = parseCronExpression(cronConfig);
      const now = new Date();
      
      if (!matcher(now)) {
        results.push({ workflow_id: workflow.id, status: 'skipped', reason: 'Not scheduled for this time' });
        continue;
      }
      
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
