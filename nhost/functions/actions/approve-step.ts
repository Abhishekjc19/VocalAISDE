import { Request, Response } from 'express';

// ============================================================
// approveStep — Hasura Action Handler
// Layer 2 permission check: verifies the approver's org role
// before resuming a paused workflow run.
// This CANNOT be a database permission alone — it's a
// mid-execution decision that requires programmatic validation.
// ============================================================

const HASURA_ENDPOINT = process.env.NHOST_HASURA_URL || 'http://localhost:1337/v1/graphql';
const HASURA_ADMIN_SECRET = process.env.NHOST_ADMIN_SECRET || 'nhost-admin-secret';
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
    `mutation UpdateStepRun($id: uuid!, ${varDefs}) {
      update_step_runs_by_pk(pk_columns: {id: $id}, _set: {${setFields}}) { id }
    }`,
    { id: stepRunId, ...updates }
  );
}

async function updateWorkflowRun(runId: string, status: string, extra: Record<string, any> = {}) {
  await hasuraQuery(
    `mutation UpdateRun($id: uuid!, $status: String!, $completed_at: timestamptz, $error: String) {
      update_workflow_runs_by_pk(pk_columns: {id: $id}, _set: {
        status: $status, completed_at: $completed_at, error: $error
      }) { id }
    }`,
    { id: runId, status, completed_at: null, error: null, ...extra }
  );
}

// Step executors (duplicated from trigger-run for independent execution)
async function executeLlmCall(config: any, previousOutput: any): Promise<any> {
  const prompt = config.prompt || 'Hello, world!';
  const contextualPrompt = previousOutput
    ? `Context from previous step: ${JSON.stringify(previousOutput)}\n\n${prompt}`
    : prompt;

  if (GROQ_API_KEY) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model || 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: contextualPrompt }],
        max_tokens: 512,
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return { response: data.choices[0].message.content, model: data.model, usage: data.usage };
  } else {
    await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
    return {
      response: "Approval step completed. Proceeding with follow-up analysis. Results are positive.",
      model: 'stubbed-llm',
      _note: 'Stubbed response',
    };
  }
}

async function executeHttpRequest(config: any, previousOutput: any): Promise<any> {
  const url = config.url || 'https://httpbin.org/json';
  const method = config.method || 'GET';
  const headers = config.headers || { 'Content-Type': 'application/json' };
  const res = await fetch(url, {
    method,
    headers,
    body: method !== 'GET' ? JSON.stringify(config.body || previousOutput) : undefined,
  });
  const contentType = res.headers.get('content-type') || '';
  const responseData = contentType.includes('json') ? await res.json() : { text: await res.text() };
  return { status_code: res.status, data: responseData };
}

async function executeDbWrite(config: any, previousOutput: any): Promise<any> {
  return { success: true, table: config.table_name || 'results', written_data: previousOutput };
}

async function executeNotify(config: any, previousOutput: any): Promise<any> {
  const message = config.message || `Notification: ${JSON.stringify(previousOutput)}`;
  console.log(`[NOTIFY] ${message}`);
  return { notified: true, channel: config.channel || 'general', message, timestamp: new Date().toISOString() };
}

function evaluateConditionalBranch(config: any, previousOutput: any) {
  const condition = config.condition || 'true';
  let result = false;
  try {
    const prev = previousOutput;
    if (condition === 'true') result = true;
    else if (condition.includes('contains')) {
      const match = condition.match(/contains\("(.+?)"\)/);
      if (match) result = JSON.stringify(prev).toLowerCase().includes(match[1].toLowerCase());
    } else if (condition.includes('positive') || condition.includes('negative')) {
      const text = typeof prev === 'string' ? prev : (prev?.response || JSON.stringify(prev));
      const positiveWords = ['positive', 'good', 'great', 'recommend', 'success', 'yes', 'proceed'];
      result = positiveWords.some(word => text.toLowerCase().includes(word));
    } else {
      result = Boolean(previousOutput);
    }
  } catch { result = false; }
  return { branch: result ? (config.true_branch || 'continue') : (config.false_branch || 'skip_next'), result };
}

export default async function handler(req: Request, res: Response) {
  try {
    const { step_run_id } = req.body.input;
    const userId = req.body.session_variables['x-hasura-user-id'];

    if (!step_run_id || !userId) {
      return res.status(400).json({ message: 'Missing step_run_id or user session' });
    }

    // 1. Fetch the step_run and verify it's in 'paused' status
    const stepData = await hasuraQuery(
      `query GetStepRun($id: uuid!) {
        step_runs_by_pk(id: $id) {
          id
          status
          workflow_run_id
          workflow_step {
            id
            step_type
            step_order
            config
            workflow {
              id
              org_id
              organization {
                id
                quota_limit
                quota_used
                org_members(where: { user_id: { _eq: $user_id } }) {
                  role
                }
              }
              workflow_steps(order_by: { step_order: asc }) {
                id
                step_order
                name
                step_type
                config
              }
            }
          }
        }
      }`,
      { id: step_run_id, user_id: userId }
    );

    const stepRun = stepData.step_runs_by_pk;
    if (!stepRun) {
      return res.status(404).json({ message: 'Step run not found' });
    }

    if (stepRun.status !== 'paused') {
      return res.status(400).json({ message: `Step is not paused (current status: ${stepRun.status})` });
    }

    if (stepRun.workflow_step.step_type !== 'approval_gate') {
      return res.status(400).json({ message: 'This step is not an approval gate' });
    }

    // 2. LAYER 2: Check the approver's role — MUST be owner or editor
    const workflow = stepRun.workflow_step.workflow;
    const membership = workflow.organization.org_members[0];

    if (!membership) {
      return res.status(403).json({
        message: 'Permission denied: you are not a member of this organization',
      });
    }

    if (!['owner', 'editor'].includes(membership.role)) {
      return res.status(403).json({
        message: 'Permission denied: only owners and editors can approve workflow steps',
      });
    }

    // Check if the step config requires a specific role
    const requiredRole = stepRun.workflow_step.config?.required_role;
    if (requiredRole && membership.role !== requiredRole && membership.role !== 'owner') {
      return res.status(403).json({
        message: `Permission denied: this approval gate requires the "${requiredRole}" role`,
      });
    }

    // 3. Approve the step
    await updateStepRun(step_run_id, {
      status: 'completed',
      approved_by: userId,
      approved_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      output: JSON.stringify({ approved: true, approved_by: userId, role: membership.role }),
    });

    // 4. Resume the workflow — execute remaining steps
    const runId = stepRun.workflow_run_id;
    await updateWorkflowRun(runId, 'running');

    // Respond immediately
    res.json({
      success: true,
      message: 'Step approved, workflow resuming',
      workflow_run_id: runId,
    });

    // Resume execution from the next step
    const allSteps = workflow.workflow_steps;
    const currentStepOrder = stepRun.workflow_step.step_order;
    const remainingSteps = allSteps.filter((s: any) => s.step_order > currentStepOrder);

    if (remainingSteps.length > 0) {
      // Get existing step_runs for the remaining steps
      const existingStepRuns = await hasuraQuery(
        `query GetRemainingStepRuns($run_id: uuid!, $step_ids: [uuid!]!) {
          step_runs(where: { workflow_run_id: { _eq: $run_id }, workflow_step_id: { _in: $step_ids } }) {
            id
            workflow_step_id
          }
        }`,
        { run_id: runId, step_ids: remainingSteps.map((s: any) => s.id) }
      );

      const stepRunMap = new Map(
        existingStepRuns.step_runs.map((sr: any) => [sr.workflow_step_id, sr.id])
      );

      // Execute remaining steps
      let previousOutput: any = { approved: true, approved_by: userId };
      let skipNext = false;

      for (const step of remainingSteps) {
        const srId = stepRunMap.get(step.id);
        if (!srId) continue;

        if (skipNext) {
          await updateStepRun(srId, {
            status: 'skipped',
            output: JSON.stringify({ reason: 'Skipped by conditional branch' }),
            completed_at: new Date().toISOString(),
          });
          skipNext = false;
          continue;
        }

        await updateStepRun(srId, {
          status: 'running',
          started_at: new Date().toISOString(),
          attempt_count: 1,
        });

        try {
          let output: any;
          let attempts = 0;
          const maxAttempts = ['llm_call', 'http_request'].includes(step.step_type) ? MAX_RETRIES + 1 : 1;

          while (attempts < maxAttempts) {
            attempts++;
            try {
              switch (step.step_type) {
                case 'llm_call': output = await executeLlmCall(step.config, previousOutput); break;
                case 'http_request': output = await executeHttpRequest(step.config, previousOutput); break;
                case 'db_write': output = await executeDbWrite(step.config, previousOutput); break;
                case 'notify': output = await executeNotify(step.config, previousOutput); break;
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
            } catch (retryError: any) {
              if (attempts >= maxAttempts) throw retryError;
              await new Promise(r => setTimeout(r, 1000));
            }
          }

          await updateStepRun(srId, {
            status: 'completed',
            output: typeof output === 'object' ? JSON.stringify(output) : output,
            attempt_count: String(attempts),
            completed_at: new Date().toISOString(),
          });
          previousOutput = output;
        } catch (error: any) {
          await updateStepRun(srId, { status: 'failed', error: error.message, completed_at: new Date().toISOString() });
          await updateWorkflowRun(runId, 'failed', { error: error.message, completed_at: new Date().toISOString() });
          return;
        }
      }

      // All remaining steps completed
      await updateWorkflowRun(runId, 'completed', { completed_at: new Date().toISOString() });

      // Increment quota
      await hasuraQuery(
        `mutation IncrementQuota($org_id: uuid!) {
          update_organizations_by_pk(pk_columns: {id: $org_id}, _inc: {quota_used: 1}) { id }
        }`,
        { org_id: workflow.org_id }
      );
    } else {
      // No remaining steps — complete
      await updateWorkflowRun(runId, 'completed', { completed_at: new Date().toISOString() });
      await hasuraQuery(
        `mutation IncrementQuota($org_id: uuid!) {
          update_organizations_by_pk(pk_columns: {id: $org_id}, _inc: {quota_used: 1}) { id }
        }`,
        { org_id: workflow.org_id }
      );
    }
  } catch (error: any) {
    console.error('approveStep error:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: error.message || 'Internal server error' });
    }
  }
}
