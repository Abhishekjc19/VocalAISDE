import { Request, Response } from 'express';

// ============================================================
// Webhook Trigger Endpoint
// Receives inbound webhook calls from external systems to
// start a workflow run. Validates webhook secret and
// delegates to the workflow execution engine.
// ============================================================

const HASURA_ENDPOINT = process.env.NHOST_HASURA_URL || 'http://localhost:1337/v1/graphql';
const HASURA_ADMIN_SECRET = process.env.NHOST_ADMIN_SECRET || 'nhost-admin-secret';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'agent-flow-webhook-secret-2024';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const MAX_RETRIES = 1;

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

async function updateStepRun(stepRunId: string, updates: Record<string, any>) {
  const setFields = Object.keys(updates).map(k => `${k}: $${k}`).join(', ');
  const varDefs = Object.entries(updates).map(([k, v]) => {
    if (k === 'output') return `$${k}: jsonb`;
    if (k === 'attempt_count') return `$${k}: Int`;
    return `$${k}: String`;
  }).join(', ');

  await hasuraQuery(
    `mutation U($id: uuid!, ${varDefs}) {
      update_step_runs_by_pk(pk_columns: {id: $id}, _set: {${setFields}}) { id }
    }`,
    { id: stepRunId, ...updates }
  );
}

async function updateWorkflowRun(runId: string, status: string, extra: Record<string, any> = {}) {
  await hasuraQuery(
    `mutation U($id: uuid!, $status: String!, $completed_at: timestamptz, $started_at: timestamptz, $error: String) {
      update_workflow_runs_by_pk(pk_columns: {id: $id}, _set: {
        status: $status, completed_at: $completed_at, started_at: $started_at, error: $error
      }) { id }
    }`,
    { id: runId, status, completed_at: null, started_at: null, error: null, ...extra }
  );
}

// Step executors
async function executeLlmCall(config: any, prev: any) {
  const prompt = config.prompt || 'Hello';
  const ctxPrompt = prev ? `Context: ${JSON.stringify(prev)}\n\n${prompt}` : prompt;
  if (GROQ_API_KEY) {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model || 'llama-3.1-8b-instant', messages: [{ role: 'user', content: ctxPrompt }], max_tokens: 512 }),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    return { response: d.choices[0].message.content, model: d.model };
  }
  await new Promise(r => setTimeout(r, 1500));
  return { response: "Webhook-triggered analysis complete. Positive trend detected.", model: 'stubbed' };
}

async function executeHttpRequest(config: any, prev: any) {
  const r = await fetch(config.url || 'https://httpbin.org/json', { method: config.method || 'GET', headers: config.headers || {} });
  const ct = r.headers.get('content-type') || '';
  return { status_code: r.status, data: ct.includes('json') ? await r.json() : { text: await r.text() } };
}

function evaluateConditionalBranch(config: any, prev: any) {
  let result = false;
  const condition = config.condition || 'true';
  try {
    if (condition === 'true') result = true;
    else if (condition.includes('positive')) {
      const text = typeof prev === 'string' ? prev : (prev?.response || JSON.stringify(prev));
      result = ['positive', 'good', 'great', 'recommend', 'success'].some(w => text.toLowerCase().includes(w));
    } else result = Boolean(prev);
  } catch { result = false; }
  return { branch: result ? (config.true_branch || 'continue') : (config.false_branch || 'skip_next'), result };
}

export default async function handler(req: Request, res: Response) {
  try {
    // Validate webhook secret
    const authHeader = req.headers['x-webhook-secret'] || req.headers.authorization;
    if (authHeader !== WEBHOOK_SECRET && authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
      return res.status(401).json({ message: 'Invalid webhook secret' });
    }

    const { workflow_id, payload } = req.body;
    if (!workflow_id) {
      return res.status(400).json({ message: 'Missing workflow_id in webhook payload' });
    }

    // Verify the workflow has a webhook trigger configured
    const wfData = await hasuraQuery(
      `query GetWorkflow($id: uuid!) {
        workflows_by_pk(id: $id) {
          id
          org_id
          is_active
          organization {
            id
            quota_limit
            quota_used
          }
          workflow_triggers(where: { trigger_type: { _eq: "webhook" }, is_active: { _eq: true } }) {
            id
          }
          workflow_steps(order_by: { step_order: asc }) {
            id
            step_order
            name
            step_type
            config
          }
        }
      }`,
      { id: workflow_id }
    );

    const workflow = wfData.workflows_by_pk;
    if (!workflow) return res.status(404).json({ message: 'Workflow not found' });
    if (!workflow.is_active) return res.status(400).json({ message: 'Workflow is inactive' });
    if (workflow.workflow_triggers.length === 0) {
      return res.status(400).json({ message: 'No active webhook trigger configured for this workflow' });
    }

    // Check quota
    const org = workflow.organization;
    if (org.quota_used >= org.quota_limit) {
      return res.status(429).json({ message: 'Quota exhausted' });
    }

    // Create run
    const createRun = await hasuraQuery(
      `mutation CreateRun($wid: uuid!) {
        insert_workflow_runs_one(object: { workflow_id: $wid, trigger_type: "webhook", status: "running", started_at: "now()" }) { id }
      }`,
      { wid: workflow_id }
    );
    const runId = createRun.insert_workflow_runs_one.id;

    // Create step_runs
    const steps = workflow.workflow_steps;
    const insertResult = await hasuraQuery(
      `mutation CreateSR($objects: [step_runs_insert_input!]!) {
        insert_step_runs(objects: $objects) { returning { id workflow_step_id } }
      }`,
      { objects: steps.map((s: any) => ({ workflow_run_id: runId, workflow_step_id: s.id, status: 'pending' })) }
    );
    const stepRunMap = new Map(insertResult.insert_step_runs.returning.map((sr: any) => [sr.workflow_step_id, sr.id]));

    res.json({ workflow_run_id: runId, status: 'running', message: 'Webhook triggered workflow run' });

    // Execute steps in background
    let previousOutput: any = payload || null;
    let skipNext = false;

    for (const step of steps) {
      const srId = stepRunMap.get(step.id)!;
      if (skipNext) {
        await updateStepRun(srId, { status: 'skipped', completed_at: new Date().toISOString() });
        skipNext = false;
        continue;
      }
      await updateStepRun(srId, { status: 'running', started_at: new Date().toISOString(), attempt_count: 1 });
      try {
        let output: any;
        let attempts = 0;
        const max = ['llm_call', 'http_request'].includes(step.step_type) ? MAX_RETRIES + 1 : 1;
        while (attempts < max) {
          attempts++;
          try {
            switch (step.step_type) {
              case 'llm_call': output = await executeLlmCall(step.config, previousOutput); break;
              case 'http_request': output = await executeHttpRequest(step.config, previousOutput); break;
              case 'db_write': output = { success: true, written_data: previousOutput }; break;
              case 'notify': output = { notified: true, message: step.config.message || 'Notification sent' }; break;
              case 'conditional_branch':
                output = evaluateConditionalBranch(step.config, previousOutput);
                if (output.branch === 'skip_next') skipNext = true;
                break;
              case 'approval_gate':
                await updateStepRun(srId, { status: 'paused', output: JSON.stringify({ message: 'Awaiting approval' }) });
                await updateWorkflowRun(runId, 'paused');
                return;
              default: throw new Error(`Unknown step type: ${step.step_type}`);
            }
            break;
          } catch (e: any) {
            if (attempts >= max) throw e;
            await new Promise(r => setTimeout(r, 1000));
          }
        }
        await updateStepRun(srId, { status: 'completed', output: typeof output === 'object' ? JSON.stringify(output) : output, completed_at: new Date().toISOString() });
        previousOutput = output;
      } catch (e: any) {
        await updateStepRun(srId, { status: 'failed', error: e.message, completed_at: new Date().toISOString() });
        await updateWorkflowRun(runId, 'failed', { error: e.message, completed_at: new Date().toISOString() });
        return;
      }
    }

    await updateWorkflowRun(runId, 'completed', { completed_at: new Date().toISOString() });
    await hasuraQuery(`mutation I($oid: uuid!) { update_organizations_by_pk(pk_columns: {id: $oid}, _inc: {quota_used: 1}) { id } }`, { oid: org.id });
  } catch (error: any) {
    console.error('Webhook trigger error:', error);
    if (!res.headersSent) res.status(500).json({ message: error.message });
  }
}
