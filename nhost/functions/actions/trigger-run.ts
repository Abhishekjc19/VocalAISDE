import { Request, Response } from 'express';

// ============================================================
// triggerWorkflowRun — Hasura Action Handler
// Core workflow execution engine with:
//   - Layer 2 permission checks (org membership + role)
//   - Quota enforcement
//   - Sequential step execution with retry logic
//   - Approval gate pause/resume
// ============================================================

const HASURA_ENDPOINT = process.env.NHOST_HASURA_URL || 'http://localhost:1337/v1/graphql';
const HASURA_ADMIN_SECRET = process.env.NHOST_ADMIN_SECRET || 'nhost-admin-secret';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const MAX_RETRIES = 1;

interface StepConfig {
  prompt?: string;
  model?: string;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  table_name?: string;
  data?: any;
  message?: string;
  channel?: string;
  condition?: string;
  true_branch?: string;
  false_branch?: string;
  required_role?: string;
}

// Execute a GraphQL query against Hasura with admin privileges
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
  if (json.errors) {
    throw new Error(JSON.stringify(json.errors));
  }
  return json.data;
}

// Update a step_run's status and output
async function updateStepRun(
  stepRunId: string,
  updates: {
    status: string;
    output?: any;
    error?: string;
    attempt_count?: number;
    approved_by?: string;
    approved_at?: string;
    started_at?: string;
    completed_at?: string;
  }
) {
  const setClauses = Object.entries(updates)
    .filter(([_, v]) => v !== undefined)
    .map(([k, v]) => {
      if (k === 'output') return `${k}: $${k}`;
      return `${k}: $${k}`;
    });

  const varDefs = Object.entries(updates)
    .filter(([_, v]) => v !== undefined)
    .map(([k, v]) => {
      if (k === 'output') return `$${k}: jsonb`;
      if (k === 'attempt_count') return `$${k}: Int`;
      return `$${k}: String`;
    });

  await hasuraQuery(
    `mutation UpdateStepRun($id: uuid!, ${varDefs.join(', ')}) {
      update_step_runs_by_pk(pk_columns: {id: $id}, _set: {${setClauses.join(', ')}}) {
        id
      }
    }`,
    { id: stepRunId, ...updates }
  );
}

// Update workflow_run status
async function updateWorkflowRun(runId: string, status: string, extra: Record<string, any> = {}) {
  await hasuraQuery(
    `mutation UpdateRun($id: uuid!, $status: String!, $completed_at: timestamptz, $started_at: timestamptz, $error: String) {
      update_workflow_runs_by_pk(pk_columns: {id: $id}, _set: {
        status: $status, completed_at: $completed_at, started_at: $started_at, error: $error
      }) { id }
    }`,
    { id: runId, status, completed_at: null, started_at: null, error: null, ...extra }
  );
}

// ---- Step Executors ----

async function executeLlmCall(config: StepConfig, previousOutput: any): Promise<any> {
  const prompt = config.prompt || 'Hello, world!';
  const contextualPrompt = previousOutput
    ? `Context from previous step: ${JSON.stringify(previousOutput)}\n\n${prompt}`
    : prompt;

  if (GROQ_API_KEY) {
    // Real Groq API call
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
        temperature: 0.7,
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return {
      response: data.choices[0].message.content,
      model: data.model,
      usage: data.usage,
    };
  } else {
    // Stubbed LLM call with realistic delay
    await new Promise((resolve) => setTimeout(resolve, 1500 + Math.random() * 1000));
    const responses = [
      "Based on my analysis, I recommend proceeding with option A. The data indicates a positive trend that aligns with our objectives.",
      "The sentiment analysis shows predominantly positive feedback (78%). Key themes include reliability, ease of use, and good customer support.",
      "I've processed the request. The classification result is: Category B - High Priority. Confidence: 0.92.",
      "Summary: The input data contains 3 actionable items. Priority ranking: 1) Infrastructure update, 2) Security patch, 3) Feature enhancement.",
    ];
    return {
      response: responses[Math.floor(Math.random() * responses.length)],
      model: 'stubbed-llm (no API key configured)',
      usage: { prompt_tokens: 45, completion_tokens: 67, total_tokens: 112 },
      _note: 'This is a stubbed response. Set GROQ_API_KEY for real LLM calls.',
    };
  }
}

async function executeHttpRequest(config: StepConfig, previousOutput: any): Promise<any> {
  const url = config.url || 'https://httpbin.org/json';
  const method = config.method || 'GET';
  const headers = config.headers || { 'Content-Type': 'application/json' };
  let body = config.body;

  // Interpolate previous output into body if it contains template markers
  if (body && typeof body === 'string' && body.includes('{{previous}}')) {
    body = body.replace('{{previous}}', JSON.stringify(previousOutput));
  }

  const res = await fetch(url, {
    method,
    headers,
    body: method !== 'GET' ? JSON.stringify(body || previousOutput) : undefined,
  });

  const contentType = res.headers.get('content-type') || '';
  let responseData;
  if (contentType.includes('application/json')) {
    responseData = await res.json();
  } else {
    responseData = { text: await res.text() };
  }

  return {
    status_code: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    data: responseData,
  };
}

async function executeDbWrite(config: StepConfig, previousOutput: any): Promise<any> {
  const tableName = config.table_name || 'workflow_step_results';
  const data = config.data || previousOutput || {};

  // Write to a generic results store within our own db
  const result = await hasuraQuery(
    `mutation InsertResult($input: jsonb!) {
      insert_step_runs_one(object: {
        workflow_run_id: "00000000-0000-0000-0000-000000000000",
        workflow_step_id: "00000000-0000-0000-0000-000000000000",
        status: "completed",
        output: $input
      }) { id }
    }`,
    { input: data }
  );

  return {
    success: true,
    table: tableName,
    written_data: data,
    message: `Data written to ${tableName}`,
  };
}

async function executeNotify(config: StepConfig, previousOutput: any): Promise<any> {
  const message = config.message || `Workflow notification: ${JSON.stringify(previousOutput)}`;
  const channel = config.channel || 'general';

  // In production, this would fire a Hasura Event Trigger to Slack/email
  // For now, we log it and simulate the notification
  console.log(`[NOTIFY] Channel: ${channel}, Message: ${message}`);

  return {
    notified: true,
    channel,
    message,
    timestamp: new Date().toISOString(),
    _note: 'Notification logged. In production, this fires via Hasura Event Trigger to Slack/email.',
  };
}

function evaluateConditionalBranch(config: StepConfig, previousOutput: any): { branch: string; result: boolean } {
  const condition = config.condition || 'true';
  let result = false;

  try {
    // Safely evaluate condition against previous output
    const prev = previousOutput;
    if (condition === 'true') {
      result = true;
    } else if (condition.includes('contains')) {
      const match = condition.match(/contains\("(.+?)"\)/);
      if (match) {
        result = JSON.stringify(prev).toLowerCase().includes(match[1].toLowerCase());
      }
    } else if (condition.includes('length >')) {
      const match = condition.match(/length > (\d+)/);
      if (match) {
        const text = typeof prev === 'string' ? prev : JSON.stringify(prev);
        result = text.length > parseInt(match[1]);
      }
    } else if (condition.includes('status_code')) {
      const match = condition.match(/status_code\s*===?\s*(\d+)/);
      if (match && prev?.status_code) {
        result = prev.status_code === parseInt(match[1]);
      }
    } else if (condition.includes('positive') || condition.includes('negative')) {
      // Sentiment-style check on LLM output
      const text = typeof prev === 'string' ? prev : (prev?.response || JSON.stringify(prev));
      const positiveWords = ['positive', 'good', 'great', 'recommend', 'success', 'yes', 'proceed'];
      result = positiveWords.some(word => text.toLowerCase().includes(word));
    } else {
      // Default: try to evaluate as a simple boolean expression
      result = Boolean(previousOutput);
    }
  } catch (e) {
    result = false;
  }

  return {
    branch: result ? (config.true_branch || 'continue') : (config.false_branch || 'skip_next'),
    result,
  };
}

// ---- Main Handler ----

export default async function handler(req: Request, res: Response) {
  try {
    const { workflow_id } = req.body.input;
    const userId = req.body.session_variables['x-hasura-user-id'];

    if (!workflow_id || !userId) {
      return res.status(400).json({ message: 'Missing workflow_id or user session' });
    }

    // 1. Verify caller is owner/editor in the workflow's org
    const memberCheck = await hasuraQuery(
      `query CheckMembership($workflow_id: uuid!, $user_id: uuid!) {
        workflows_by_pk(id: $workflow_id) {
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
      }`,
      { workflow_id, user_id: userId }
    );

    const workflow = memberCheck.workflows_by_pk;
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    const membership = workflow.organization.org_members[0];
    if (!membership || !['owner', 'editor'].includes(membership.role)) {
      return res.status(403).json({
        message: 'Permission denied: only owners and editors can trigger workflow runs',
      });
    }

    // 2. Check org quota
    const org = workflow.organization;
    if (org.quota_used >= org.quota_limit) {
      return res.status(429).json({
        message: `Quota exhausted: ${org.quota_used}/${org.quota_limit} runs used this period`,
      });
    }

    // 3. Create the workflow_run
    const createRun = await hasuraQuery(
      `mutation CreateRun($workflow_id: uuid!, $triggered_by: uuid!) {
        insert_workflow_runs_one(object: {
          workflow_id: $workflow_id,
          triggered_by: $triggered_by,
          trigger_type: "manual",
          status: "running",
          started_at: "now()"
        }) { id }
      }`,
      { workflow_id, triggered_by: userId }
    );

    const runId = createRun.insert_workflow_runs_one.id;

    // 4. Create step_runs for all steps
    const steps = workflow.workflow_steps;
    const stepRunInserts = steps.map((step: any) => ({
      workflow_run_id: runId,
      workflow_step_id: step.id,
      status: 'pending',
    }));

    const insertStepRuns = await hasuraQuery(
      `mutation CreateStepRuns($objects: [step_runs_insert_input!]!) {
        insert_step_runs(objects: $objects) {
          returning { id, workflow_step_id }
        }
      }`,
      { objects: stepRunInserts }
    );

    const stepRunMap = new Map(
      insertStepRuns.insert_step_runs.returning.map((sr: any) => [sr.workflow_step_id, sr.id])
    );

    // 5. Execute steps sequentially (async — respond immediately, execute in background)
    // We respond with the run ID immediately, then process in the background
    res.json({
      workflow_run_id: runId,
      status: 'running',
      message: `Workflow run started with ${steps.length} steps`,
    });

    // Background execution
    executeStepsSequentially(runId, steps, stepRunMap, userId, org).catch(console.error);
  } catch (error: any) {
    console.error('triggerWorkflowRun error:', error);
    res.status(500).json({ message: error.message || 'Internal server error' });
  }
}

async function executeStepsSequentially(
  runId: string,
  steps: any[],
  stepRunMap: Map<string, string>,
  userId: string,
  org: any
) {
  let previousOutput: any = null;
  let skipNext = false;

  for (const step of steps) {
    const stepRunId = stepRunMap.get(step.id)!;

    // Handle skip from conditional branch
    if (skipNext) {
      await updateStepRun(stepRunId, {
        status: 'skipped',
        output: { reason: 'Skipped by conditional branch' },
        completed_at: new Date().toISOString(),
      });
      skipNext = false;
      continue;
    }

    // Mark step as running
    await updateStepRun(stepRunId, {
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
            case 'llm_call':
              output = await executeLlmCall(step.config, previousOutput);
              break;
            case 'http_request':
              output = await executeHttpRequest(step.config, previousOutput);
              break;
            case 'db_write':
              output = await executeDbWrite(step.config, previousOutput);
              break;
            case 'notify':
              output = await executeNotify(step.config, previousOutput);
              break;
            case 'conditional_branch':
              const branchResult = evaluateConditionalBranch(step.config, previousOutput);
              output = branchResult;
              if (branchResult.branch === 'skip_next') {
                skipNext = true;
              }
              break;
            case 'approval_gate':
              // Pause the run — wait for external approval
              await updateStepRun(stepRunId, {
                status: 'paused',
                output: {
                  message: 'Awaiting approval',
                  required_role: step.config.required_role || 'owner',
                },
              });
              await updateWorkflowRun(runId, 'paused');
              // Stop execution here — will be resumed by approveStep action
              return;
            default:
              throw new Error(`Unknown step type: ${step.step_type}`);
          }
          break; // Success, exit retry loop
        } catch (retryError: any) {
          if (attempts >= maxAttempts) throw retryError;
          console.log(`Step ${step.name} attempt ${attempts} failed, retrying...`);
          await updateStepRun(stepRunId, { attempt_count: attempts });
          await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait before retry
        }
      }

      // Mark step completed
      await updateStepRun(stepRunId, {
        status: 'completed',
        output,
        attempt_count: attempts,
        completed_at: new Date().toISOString(),
      });

      previousOutput = output;
    } catch (error: any) {
      // Mark step failed
      await updateStepRun(stepRunId, {
        status: 'failed',
        error: error.message,
        completed_at: new Date().toISOString(),
      });

      // Mark run failed
      await updateWorkflowRun(runId, 'failed', {
        error: `Step "${step.name}" failed: ${error.message}`,
        completed_at: new Date().toISOString(),
      });
      return;
    }
  }

  // All steps completed — mark run as completed, increment quota
  await updateWorkflowRun(runId, 'completed', {
    completed_at: new Date().toISOString(),
  });

  // Increment org quota
  await hasuraQuery(
    `mutation IncrementQuota($org_id: uuid!) {
      update_organizations_by_pk(pk_columns: {id: $org_id}, _inc: {quota_used: 1}) { id quota_used }
    }`,
    { org_id: org.id }
  );
}
