'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useApp } from '@/lib/context';
import Sidebar from '@/components/Sidebar';

// ============================================================
// Workflow Detail — Builder + Live Run Viewer
// ============================================================

const STEP_TYPES = [
  { value: 'llm_call', label: 'LLM Call', icon: '🧠', color: 'var(--step-llm)', desc: 'Call an LLM API (Groq/Gemini)' },
  { value: 'http_request', label: 'HTTP Request', icon: '🌐', color: 'var(--step-http)', desc: 'Make an external API call' },
  { value: 'db_write', label: 'DB Write', icon: '💾', color: 'var(--step-db)', desc: 'Write data to the database' },
  { value: 'notify', label: 'Notify', icon: '🔔', color: 'var(--step-notify)', desc: 'Send a notification' },
  { value: 'conditional_branch', label: 'Conditional Branch', icon: '🔀', color: 'var(--step-branch)', desc: 'Branch based on conditions' },
  { value: 'approval_gate', label: 'Approval Gate', icon: '✋', color: 'var(--step-approval)', desc: 'Pause for human approval' },
];

const TRIGGER_TYPES = [
  { value: 'manual', label: 'Manual', icon: '👆' },
  { value: 'webhook', label: 'Webhook', icon: '🔗' },
  { value: 'scheduled', label: 'Scheduled', icon: '⏰' },
  { value: 'database_event', label: 'Database Event', icon: '🗄️' },
];

const DEFAULT_CONFIGS: Record<string, any> = {
  llm_call: { prompt: 'Analyze the input and provide a summary', model: 'llama-3.1-8b-instant' },
  http_request: { url: 'https://httpbin.org/json', method: 'GET', headers: {} },
  db_write: { table_name: 'workflow_results', data: {} },
  notify: { message: 'Workflow step completed', channel: 'general' },
  conditional_branch: { condition: 'contains("positive")', true_branch: 'continue', false_branch: 'skip_next' },
  approval_gate: { required_role: 'owner' },
};

export default function WorkflowDetailPage() {
  const { user, loading, currentOrg, graphqlRequest } = useApp();
  const router = useRouter();
  const params = useParams();
  const workflowId = params.id as string;

  const [workflow, setWorkflow] = useState<any>(null);
  const [steps, setSteps] = useState<any[]>([]);
  const [triggers, setTriggers] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedStep, setSelectedStep] = useState<any>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [liveStepRuns, setLiveStepRuns] = useState<any[]>([]);
  const [activeRunStatus, setActiveRunStatus] = useState<string>('');
  const [loadingData, setLoadingData] = useState(true);
  const [showAddStep, setShowAddStep] = useState(false);
  const [showAddTrigger, setShowAddTrigger] = useState(false);
  const [triggerRunning, setTriggerRunning] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState(false);
  const [wfName, setWfName] = useState('');
  const [wfDesc, setWfDesc] = useState('');
  const [tab, setTab] = useState<'builder' | 'runs'>('builder');
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  // Load workflow data
  const loadWorkflow = useCallback(async () => {
    try {
      const data = await graphqlRequest(
        `query GetWorkflow($id: uuid!) {
          workflows_by_pk(id: $id) {
            id name description is_active org_id created_by created_at updated_at
            organization { id name quota_limit quota_used }
            workflow_steps(order_by: { step_order: asc }) {
              id step_order name step_type config
            }
            workflow_triggers { id trigger_type config is_active }
            workflow_runs(order_by: { created_at: desc }, limit: 20) {
              id status trigger_type started_at completed_at created_at error
              step_runs(order_by: { workflow_step: { step_order: asc } }) {
                id status input output error attempt_count
                approved_by approved_at started_at completed_at
                workflow_step { id name step_type step_order }
              }
            }
          }
        }`,
        { id: workflowId }
      );
      const wf = data.workflows_by_pk;
      if (!wf) {
        router.replace('/workflows');
        return;
      }
      setWorkflow(wf);
      setSteps(wf.workflow_steps);
      setTriggers(wf.workflow_triggers);
      setRuns(wf.workflow_runs);
      setWfName(wf.name);
      setWfDesc(wf.description || '');

      // Auto-select active run
      const activeRun = wf.workflow_runs.find((r: any) => ['running', 'paused'].includes(r.status));
      if (activeRun) {
        setActiveRunId(activeRun.id);
        setLiveStepRuns(activeRun.step_runs);
        setActiveRunStatus(activeRun.status);
        setTab('runs');
      }
    } catch (error) {
      console.error('Failed to load workflow:', error);
    } finally {
      setLoadingData(false);
    }
  }, [workflowId, graphqlRequest, router]);

  useEffect(() => {
    loadWorkflow();
  }, [loadWorkflow]);

  // Poll for live updates when a run is active
  useEffect(() => {
    if (!activeRunId) return;

    const poll = async () => {
      try {
        const data = await graphqlRequest(
          `query GetRunStatus($id: uuid!) {
            workflow_runs_by_pk(id: $id) {
              id status error started_at completed_at
              step_runs(order_by: { workflow_step: { step_order: asc } }) {
                id status input output error attempt_count
                approved_by approved_at started_at completed_at
                workflow_step { id name step_type step_order }
              }
            }
          }`,
          { id: activeRunId }
        );
        if (data.workflow_runs_by_pk) {
          setLiveStepRuns(data.workflow_runs_by_pk.step_runs);
          setActiveRunStatus(data.workflow_runs_by_pk.status);

          // Stop polling if run is done
          if (['completed', 'failed'].includes(data.workflow_runs_by_pk.status)) {
            if (pollRef.current) clearInterval(pollRef.current);
            loadWorkflow(); // Refresh all data
          }
        }
      } catch (e) {
        console.error('Poll error:', e);
      }
    };

    poll(); // Initial fetch
    pollRef.current = setInterval(poll, 1500); // Poll every 1.5s for live updates

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activeRunId, graphqlRequest, loadWorkflow]);

  // ---- Step Operations ----
  const addStep = async (type: string) => {
    try {
      const stepConfig = DEFAULT_CONFIGS[type] || {};
      const typeMeta = STEP_TYPES.find(s => s.value === type);
      await graphqlRequest(
        `mutation InsertStep($workflow_id: uuid!, $step_order: Int!, $name: String!, $step_type: String!, $config: jsonb!) {
          insert_workflow_steps_one(object: {
            workflow_id: $workflow_id, step_order: $step_order,
            name: $name, step_type: $step_type, config: $config
          }) { id }
        }`,
        {
          workflow_id: workflowId,
          step_order: steps.length + 1,
          name: typeMeta?.label || type,
          step_type: type,
          config: stepConfig,
        }
      );
      setShowAddStep(false);
      await loadWorkflow();
    } catch (error: any) {
      alert('Failed to add step: ' + error.message);
    }
  };

  const updateStep = async (step: any) => {
    try {
      await graphqlRequest(
        `mutation UpdateStep($id: uuid!, $name: String!, $step_type: String!, $config: jsonb!, $step_order: Int!) {
          update_workflow_steps_by_pk(pk_columns: { id: $id }, _set: {
            name: $name, step_type: $step_type, config: $config, step_order: $step_order
          }) { id }
        }`,
        { id: step.id, name: step.name, step_type: step.step_type, config: step.config, step_order: step.step_order }
      );
      await loadWorkflow();
    } catch (error: any) {
      alert('Failed to update step: ' + error.message);
    }
  };

  const deleteStep = async (stepId: string) => {
    if (!confirm('Delete this step?')) return;
    try {
      await graphqlRequest(
        `mutation DeleteStep($id: uuid!) { delete_workflow_steps_by_pk(id: $id) { id } }`,
        { id: stepId }
      );
      setSelectedStep(null);
      await loadWorkflow();
    } catch (error: any) {
      alert('Failed to delete step: ' + error.message);
    }
  };

  const moveStep = async (stepId: string, direction: 'up' | 'down') => {
    const idx = steps.findIndex(s => s.id === stepId);
    if ((direction === 'up' && idx === 0) || (direction === 'down' && idx === steps.length - 1)) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    
    try {
      // Swap step orders
      await graphqlRequest(
        `mutation SwapSteps($id1: uuid!, $order1: Int!, $id2: uuid!, $order2: Int!) {
          step1: update_workflow_steps_by_pk(pk_columns: { id: $id1 }, _set: { step_order: $order1 }) { id }
          step2: update_workflow_steps_by_pk(pk_columns: { id: $id2 }, _set: { step_order: $order2 }) { id }
        }`,
        {
          id1: steps[idx].id, order1: steps[swapIdx].step_order,
          id2: steps[swapIdx].id, order2: steps[idx].step_order,
        }
      );
      await loadWorkflow();
    } catch (error: any) {
      alert('Failed to reorder: ' + error.message);
    }
  };

  // ---- Trigger Operations ----
  const addTrigger = async (type: string) => {
    try {
      const config = type === 'webhook' ? { secret: 'agent-flow-webhook-secret-2024' }
        : type === 'scheduled' ? { cron: '*/5 * * * *' }
        : type === 'database_event' ? { table: 'watched_tables', operation: 'INSERT' }
        : {};
      await graphqlRequest(
        `mutation InsertTrigger($workflow_id: uuid!, $trigger_type: String!, $config: jsonb!) {
          insert_workflow_triggers_one(object: {
            workflow_id: $workflow_id, trigger_type: $trigger_type, config: $config
          }) { id }
        }`,
        { workflow_id: workflowId, trigger_type: type, config }
      );
      setShowAddTrigger(false);
      await loadWorkflow();
    } catch (error: any) {
      alert('Failed to add trigger: ' + error.message);
    }
  };

  const deleteTrigger = async (triggerId: string) => {
    try {
      await graphqlRequest(
        `mutation DeleteTrigger($id: uuid!) { delete_workflow_triggers_by_pk(id: $id) { id } }`,
        { id: triggerId }
      );
      await loadWorkflow();
    } catch (error: any) {
      alert('Failed to delete trigger: ' + error.message);
    }
  };

  // ---- Run Operations ----
  const triggerRun = async () => {
    setTriggerRunning(true);
    try {
      const data = await graphqlRequest(
        `mutation TriggerRun($workflow_id: uuid!) {
          triggerWorkflowRun(workflow_id: $workflow_id) {
            workflow_run_id status message
          }
        }`,
        { workflow_id: workflowId }
      );
      const runId = data.triggerWorkflowRun.workflow_run_id;
      setActiveRunId(runId);
      setActiveRunStatus('running');
      setTab('runs');
    } catch (error: any) {
      alert('Failed to trigger run: ' + error.message);
    } finally {
      setTriggerRunning(false);
    }
  };

  const approveStep = async (stepRunId: string) => {
    try {
      await graphqlRequest(
        `mutation Approve($step_run_id: uuid!) {
          approveStep(step_run_id: $step_run_id) {
            success message workflow_run_id
          }
        }`,
        { step_run_id: stepRunId }
      );
    } catch (error: any) {
      alert('Failed to approve: ' + error.message);
    }
  };

  const updateWorkflowMeta = async () => {
    try {
      await graphqlRequest(
        `mutation UpdateWF($id: uuid!, $name: String!, $description: String!) {
          update_workflows_by_pk(pk_columns: { id: $id }, _set: { name: $name, description: $description }) { id }
        }`,
        { id: workflowId, name: wfName, description: wfDesc }
      );
      setEditingWorkflow(false);
      await loadWorkflow();
    } catch (error: any) {
      alert('Failed to update: ' + error.message);
    }
  };

  const canEdit = currentOrg && ['owner', 'editor'].includes(currentOrg.role);
  const canTrigger = currentOrg && ['owner', 'editor'].includes(currentOrg.role);
  const isOwner = currentOrg?.role === 'owner';

  const getStepIcon = (type: string) => STEP_TYPES.find(s => s.value === type)?.icon || '❓';
  const getStepColor = (type: string) => STEP_TYPES.find(s => s.value === type)?.color || 'var(--text-secondary)';

  const getStatusEmoji = (status: string) => {
    const map: Record<string, string> = {
      completed: '✅', running: '⏳', failed: '❌', paused: '⏸️', pending: '⬜', skipped: '⏭️',
    };
    return map[status] || '❓';
  };

  const formatOutput = (output: any) => {
    if (!output) return null;
    try {
      const parsed = typeof output === 'string' ? JSON.parse(output) : output;
      return JSON.stringify(parsed, null, 2);
    } catch {
      return String(output);
    }
  };

  if (loading || !user) return <div className="loading-page"><div className="loading-spinner" style={{ width: 32, height: 32 }}></div></div>;
  if (loadingData) return <div className="app-container"><Sidebar active="workflows" /><div className="main-content"><div className="loading-page"><div className="loading-spinner" style={{ width: 32, height: 32 }}></div><div className="loading-text">Loading workflow...</div></div></div></div>;
  if (!workflow) return null;

  return (
    <div className="app-container">
      <Sidebar active="workflows" />
      <div className="main-content">
        {/* Header */}
        <div className="page-header">
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button className="btn-icon" onClick={() => router.push('/workflows')} title="Back">←</button>
              {editingWorkflow ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input value={wfName} onChange={(e) => setWfName(e.target.value)} style={{ fontSize: 20, fontWeight: 700, padding: '4px 8px' }} />
                  <button className="btn btn-primary btn-sm" onClick={updateWorkflowMeta}>Save</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditingWorkflow(false)}>Cancel</button>
                </div>
              ) : (
                <h2 onClick={() => canEdit && setEditingWorkflow(true)} style={{ cursor: canEdit ? 'pointer' : 'default' }}>
                  {workflow.name}
                </h2>
              )}
            </div>
            <p className="subtitle">{workflow.description || 'No description'}</p>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            {canTrigger && (
              <button
                className="btn btn-primary"
                onClick={triggerRun}
                disabled={triggerRunning || steps.length === 0}
              >
                {triggerRunning ? (
                  <><span className="loading-spinner" style={{ width: 14, height: 14 }}></span> Starting...</>
                ) : (
                  '▶️ Run Workflow'
                )}
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
          <button
            className={`btn ${tab === 'builder' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
            onClick={() => setTab('builder')}
          >
            🔧 Builder
          </button>
          <button
            className={`btn ${tab === 'runs' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
            onClick={() => setTab('runs')}
          >
            📊 Runs {activeRunId && activeRunStatus === 'running' && <span className="status-dot running" style={{ marginLeft: 4 }}></span>}
          </button>
        </div>

        {/* ============= BUILDER TAB ============= */}
        {tab === 'builder' && (
          <div className="workflow-builder">
            <div className="steps-panel">
              {/* Triggers Section */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Triggers
                  </h3>
                  {canEdit && (
                    <button className="btn btn-secondary btn-sm" onClick={() => setShowAddTrigger(true)}>+ Add Trigger</button>
                  )}
                </div>
                <div className="trigger-list">
                  {triggers.length === 0 ? (
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No triggers configured</span>
                  ) : (
                    triggers.map((t) => (
                      <span key={t.id} className="trigger-badge" style={{ cursor: 'pointer' }}>
                        <span className="trigger-icon">{TRIGGER_TYPES.find(tt => tt.value === t.trigger_type)?.icon || '🔧'}</span>
                        {t.trigger_type.replace('_', ' ')}
                        {canEdit && (
                          <span onClick={(e) => { e.stopPropagation(); deleteTrigger(t.id); }}
                            style={{ cursor: 'pointer', opacity: 0.5, marginLeft: 4 }}>✕</span>
                        )}
                      </span>
                    ))
                  )}
                </div>
              </div>

              {/* Steps Section */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Steps ({steps.length})
                </h3>
                {canEdit && (
                  <button className="btn btn-secondary btn-sm" onClick={() => setShowAddStep(true)}>+ Add Step</button>
                )}
              </div>

              <div className="steps-list">
                {steps.map((step, index) => (
                  <div key={step.id}>
                    <div
                      className={`step-card ${selectedStep?.id === step.id ? 'active' : ''}`}
                      onClick={() => setSelectedStep(step)}
                    >
                      <div className={`step-type-icon ${step.step_type}`}>
                        {getStepIcon(step.step_type)}
                      </div>
                      <div className="step-info">
                        <div className="step-name">{step.name}</div>
                        <div className="step-meta">
                          <span className={`badge badge-step`} style={{
                            background: `${getStepColor(step.step_type)}20`,
                            color: getStepColor(step.step_type),
                          }}>
                            {step.step_type.replace('_', ' ')}
                          </span>
                          <span>Step {step.step_order}</span>
                        </div>
                      </div>
                      {canEdit && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn-icon" onClick={(e) => { e.stopPropagation(); moveStep(step.id, 'up'); }} disabled={index === 0} title="Move up">↑</button>
                          <button className="btn-icon" onClick={(e) => { e.stopPropagation(); moveStep(step.id, 'down'); }} disabled={index === steps.length - 1} title="Move down">↓</button>
                          <button className="btn-icon" onClick={(e) => { e.stopPropagation(); deleteStep(step.id); }} title="Delete" style={{ color: 'var(--error)' }}>🗑</button>
                        </div>
                      )}
                    </div>
                    {index < steps.length - 1 && (
                      <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0' }}>
                        <div style={{ width: 2, height: 16, background: 'var(--border-primary)' }}></div>
                      </div>
                    )}
                  </div>
                ))}

                {steps.length === 0 && (
                  <div className="empty-state" style={{ padding: '40px 20px' }}>
                    <div className="empty-icon" style={{ fontSize: 36 }}>🔧</div>
                    <h3>No Steps Yet</h3>
                    <p>Add steps to build your workflow pipeline.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Step Config Panel */}
            {selectedStep && canEdit && (
              <div className="config-panel">
                <h3>
                  {getStepIcon(selectedStep.step_type)} Configure Step
                </h3>
                <StepConfigForm
                  step={selectedStep}
                  onSave={(updated: any) => {
                    updateStep(updated);
                    setSelectedStep(updated);
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* ============= RUNS TAB ============= */}
        {tab === 'runs' && (
          <div>
            {/* Active Run Viewer */}
            {activeRunId && liveStepRuns.length > 0 && (
              <div className="card" style={{ marginBottom: 24 }}>
                <div className="card-header">
                  <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`status-dot ${activeRunStatus}`}></span>
                    Live Run — {activeRunStatus}
                  </div>
                  {activeRunStatus === 'running' && (
                    <span className="badge badge-info">
                      <span className="loading-spinner" style={{ width: 10, height: 10 }}></span>
                      Streaming
                    </span>
                  )}
                </div>

                <div className="run-steps">
                  {liveStepRuns.map((sr, i) => (
                    <div key={sr.id} className={`run-step ${sr.status}`}>
                      <div className="step-status-icon">
                        {getStatusEmoji(sr.status)}
                      </div>
                      <div className="step-content">
                        <div className="step-title">
                          <span>{sr.workflow_step.name}</span>
                          <span className={`badge badge-step`} style={{
                            background: `${getStepColor(sr.workflow_step.step_type)}20`,
                            color: getStepColor(sr.workflow_step.step_type),
                            fontSize: 10,
                          }}>
                            {sr.workflow_step.step_type.replace('_', ' ')}
                          </span>
                          {sr.attempt_count > 1 && (
                            <span className="badge badge-warning" style={{ fontSize: 10 }}>
                              {sr.attempt_count} attempts
                            </span>
                          )}
                        </div>

                        <div className="step-detail">
                          {sr.status === 'running' && 'Executing...'}
                          {sr.status === 'paused' && '⏸️ Waiting for approval'}
                          {sr.status === 'completed' && sr.completed_at && `Completed at ${new Date(sr.completed_at).toLocaleTimeString()}`}
                          {sr.status === 'failed' && sr.error}
                          {sr.status === 'skipped' && 'Skipped by conditional branch'}
                          {sr.status === 'pending' && 'Waiting...'}
                        </div>

                        {sr.output && sr.status === 'completed' && (
                          <div className="step-output">
                            {formatOutput(sr.output)}
                          </div>
                        )}

                        {sr.error && sr.status === 'failed' && (
                          <div className="step-output" style={{ borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                            ❌ {sr.error}
                          </div>
                        )}

                        {/* Approval Gate Actions */}
                        {sr.status === 'paused' && sr.workflow_step.step_type === 'approval_gate' && canTrigger && (
                          <div className="approval-actions">
                            <button className="btn btn-success btn-sm" onClick={() => approveStep(sr.id)}>
                              ✅ Approve & Continue
                            </button>
                          </div>
                        )}

                        {sr.approved_by && (
                          <div style={{ fontSize: 11, color: 'var(--success)', marginTop: 4 }}>
                            ✓ Approved at {new Date(sr.approved_at).toLocaleTimeString()}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Run History */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">Run History</div>
              </div>
              {runs.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: 14, padding: '20px 0' }}>
                  No runs yet.
                </p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Trigger</th>
                      <th>Started</th>
                      <th>Duration</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => {
                      const duration = run.started_at && run.completed_at
                        ? ((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000).toFixed(1) + 's'
                        : run.started_at ? 'In progress' : '—';
                      return (
                        <tr key={run.id}>
                          <td>
                            <span className={`badge ${run.status === 'completed' ? 'badge-success' : run.status === 'failed' ? 'badge-error' : run.status === 'paused' ? 'badge-paused' : 'badge-info'}`}>
                              <span className={`status-dot ${run.status}`}></span>
                              {run.status}
                            </span>
                          </td>
                          <td style={{ color: 'var(--text-secondary)' }}>{run.trigger_type}</td>
                          <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                            {run.created_at ? new Date(run.created_at).toLocaleString() : '—'}
                          </td>
                          <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{duration}</td>
                          <td>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => {
                                setActiveRunId(run.id);
                                setLiveStepRuns(run.step_runs);
                                setActiveRunStatus(run.status);
                              }}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Add Step Modal */}
        {showAddStep && (
          <div className="modal-overlay" onClick={() => setShowAddStep(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>Add Step</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {STEP_TYPES.map((type) => {
                  // Layer 2: Only owners can add db_write and notify
                  const restricted = ['db_write', 'notify'].includes(type.value) && !isOwner;
                  return (
                    <div
                      key={type.value}
                      className="step-card"
                      style={{
                        opacity: restricted ? 0.4 : 1,
                        cursor: restricted ? 'not-allowed' : 'pointer',
                      }}
                      onClick={() => !restricted && addStep(type.value)}
                    >
                      <div className={`step-type-icon ${type.value}`}>{type.icon}</div>
                      <div className="step-info">
                        <div className="step-name">{type.label}</div>
                        <div className="step-meta">{type.desc}</div>
                        {restricted && (
                          <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 2 }}>
                            🔒 Owner only
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Add Trigger Modal */}
        {showAddTrigger && (
          <div className="modal-overlay" onClick={() => setShowAddTrigger(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>Add Trigger</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {TRIGGER_TYPES.map((type) => {
                  const restricted = type.value === 'webhook' && !isOwner;
                  const exists = triggers.some(t => t.trigger_type === type.value);
                  return (
                    <div
                      key={type.value}
                      className="step-card"
                      style={{
                        opacity: restricted || exists ? 0.4 : 1,
                        cursor: restricted || exists ? 'not-allowed' : 'pointer',
                      }}
                      onClick={() => !restricted && !exists && addTrigger(type.value)}
                    >
                      <div className="step-type-icon" style={{ background: 'var(--bg-glass)' }}>{type.icon}</div>
                      <div className="step-info">
                        <div className="step-name">{type.label}</div>
                        {restricted && <div style={{ fontSize: 11, color: 'var(--warning)' }}>🔒 Owner only</div>}
                        {exists && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Already added</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Step Configuration Form
// ============================================================
function StepConfigForm({ step, onSave }: { step: any; onSave: (step: any) => void }) {
  const [name, setName] = useState(step.name);
  const [config, setConfig] = useState<any>(step.config || {});

  useEffect(() => {
    setName(step.name);
    setConfig(step.config || {});
  }, [step]);

  const updateConfig = (key: string, value: any) => {
    setConfig((prev: any) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onSave({ ...step, name, config });
  };

  return (
    <div className="config-form">
      <div className="input-group">
        <label>Step Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      {step.step_type === 'llm_call' && (
        <>
          <div className="input-group">
            <label>Prompt</label>
            <textarea value={config.prompt || ''} onChange={(e) => updateConfig('prompt', e.target.value)} rows={4} />
          </div>
          <div className="input-group">
            <label>Model</label>
            <select value={config.model || 'llama-3.1-8b-instant'} onChange={(e) => updateConfig('model', e.target.value)}>
              <option value="llama-3.1-8b-instant">Llama 3.1 8B (Fast)</option>
              <option value="llama-3.3-70b-versatile">Llama 3.3 70B (Smart)</option>
              <option value="mixtral-8x7b-32768">Mixtral 8x7B</option>
            </select>
          </div>
        </>
      )}

      {step.step_type === 'http_request' && (
        <>
          <div className="input-group">
            <label>URL</label>
            <input value={config.url || ''} onChange={(e) => updateConfig('url', e.target.value)} placeholder="https://api.example.com/data" />
          </div>
          <div className="input-group">
            <label>Method</label>
            <select value={config.method || 'GET'} onChange={(e) => updateConfig('method', e.target.value)}>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>
        </>
      )}

      {step.step_type === 'db_write' && (
        <div className="input-group">
          <label>Target Table</label>
          <input value={config.table_name || ''} onChange={(e) => updateConfig('table_name', e.target.value)} />
        </div>
      )}

      {step.step_type === 'notify' && (
        <>
          <div className="input-group">
            <label>Message</label>
            <textarea value={config.message || ''} onChange={(e) => updateConfig('message', e.target.value)} rows={3} />
          </div>
          <div className="input-group">
            <label>Channel</label>
            <input value={config.channel || ''} onChange={(e) => updateConfig('channel', e.target.value)} placeholder="general" />
          </div>
        </>
      )}

      {step.step_type === 'conditional_branch' && (
        <>
          <div className="input-group">
            <label>Condition</label>
            <input value={config.condition || ''} onChange={(e) => updateConfig('condition', e.target.value)} placeholder='contains("positive")' />
          </div>
          <div className="input-group">
            <label>If True</label>
            <select value={config.true_branch || 'continue'} onChange={(e) => updateConfig('true_branch', e.target.value)}>
              <option value="continue">Continue to next step</option>
              <option value="skip_next">Skip next step</option>
            </select>
          </div>
          <div className="input-group">
            <label>If False</label>
            <select value={config.false_branch || 'skip_next'} onChange={(e) => updateConfig('false_branch', e.target.value)}>
              <option value="continue">Continue to next step</option>
              <option value="skip_next">Skip next step</option>
            </select>
          </div>
        </>
      )}

      {step.step_type === 'approval_gate' && (
        <div className="input-group">
          <label>Required Role to Approve</label>
          <select value={config.required_role || 'owner'} onChange={(e) => updateConfig('required_role', e.target.value)}>
            <option value="owner">Owner only</option>
            <option value="editor">Editor or above</option>
          </select>
        </div>
      )}

      <button className="btn btn-primary" onClick={handleSave} style={{ marginTop: 8 }}>
        💾 Save Changes
      </button>
    </div>
  );
}
