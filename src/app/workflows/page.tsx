'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/context';
import Sidebar from '@/components/Sidebar';

const STEP_ICONS: Record<string, string> = {
  llm_call: '🧠',
  http_request: '🌐',
  db_write: '💾',
  notify: '🔔',
  conditional_branch: '🔀',
  approval_gate: '✋',
};

const TRIGGER_ICONS: Record<string, string> = {
  manual: '👆',
  webhook: '🔗',
  scheduled: '⏰',
  database_event: '🗄️',
};

export default function WorkflowsPage() {
  const { user, loading, currentOrg, graphqlRequest } = useApp();
  const router = useRouter();
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  const loadWorkflows = useCallback(async () => {
    if (!currentOrg) return;
    setLoadingData(true);
    try {
      const data = await graphqlRequest(
        `query GetOrgWorkflows($org_id: uuid!) {
          workflows(where: { org_id: { _eq: $org_id } }, order_by: { updated_at: desc }) {
            id
            name
            description
            is_active
            created_at
            updated_at
            workflow_steps(order_by: { step_order: asc }) {
              id
              step_order
              name
              step_type
            }
            workflow_triggers {
              id
              trigger_type
              is_active
            }
            workflow_runs(limit: 1, order_by: { created_at: desc }) {
              id
              status
              created_at
            }
          }
        }`,
        { org_id: currentOrg.organization.id }
      );
      setWorkflows(data.workflows || []);
    } catch (error) {
      console.error('Failed to load workflows:', error);
    } finally {
      setLoadingData(false);
    }
  }, [currentOrg, graphqlRequest]);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  const handleCreate = async () => {
    if (!newName.trim() || !currentOrg) return;
    setCreating(true);
    try {
      const data = await graphqlRequest(
        `mutation CreateWorkflow($org_id: uuid!, $name: String!, $description: String!) {
          insert_workflows_one(object: {
            org_id: $org_id,
            name: $name,
            description: $description
          }) { id name }
        }`,
        { org_id: currentOrg.organization.id, name: newName, description: newDesc }
      );
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
      router.push(`/workflows/${data.insert_workflows_one.id}`);
    } catch (error: any) {
      alert('Failed to create workflow: ' + error.message);
    } finally {
      setCreating(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, string> = {
      completed: 'badge-success',
      running: 'badge-info',
      failed: 'badge-error',
      paused: 'badge-paused',
      pending: 'badge-info',
    };
    return map[status] || 'badge-info';
  };

  const canEdit = currentOrg && ['owner', 'editor'].includes(currentOrg.role);

  if (loading || !user) return <div className="loading-page"><div className="loading-spinner" style={{ width: 32, height: 32 }}></div></div>;

  return (
    <div className="app-container">
      <Sidebar active="workflows" />
      <div className="main-content">
        <div className="page-header">
          <div>
            <h2>Workflows</h2>
            <p className="subtitle">{workflows.length} workflow{workflows.length !== 1 ? 's' : ''} in {currentOrg?.organization.name}</p>
          </div>
          {canEdit && (
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              ➕ New Workflow
            </button>
          )}
        </div>

        {loadingData ? (
          <div className="loading-page" style={{ minHeight: '40vh' }}>
            <div className="loading-spinner" style={{ width: 32, height: 32 }}></div>
            <div className="loading-text">Loading workflows...</div>
          </div>
        ) : workflows.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">⚡</div>
            <h3>No Workflows Yet</h3>
            <p>Create your first AI agent workflow to get started.</p>
            {canEdit && (
              <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                ➕ Create Workflow
              </button>
            )}
          </div>
        ) : (
          <div className="cards-grid">
            {workflows.map((wf) => (
              <div
                key={wf.id}
                className="card"
                style={{ cursor: 'pointer' }}
                onClick={() => router.push(`/workflows/${wf.id}`)}
              >
                <div className="card-header">
                  <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ opacity: wf.is_active ? 1 : 0.4 }}>⚡</span>
                    {wf.name}
                  </div>
                  {wf.workflow_runs[0] && (
                    <span className={`badge ${getStatusBadge(wf.workflow_runs[0].status)}`}>
                      <span className={`status-dot ${wf.workflow_runs[0].status}`}></span>
                      {wf.workflow_runs[0].status}
                    </span>
                  )}
                </div>

                {wf.description && (
                  <p style={{
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                    marginBottom: 12,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {wf.description}
                  </p>
                )}

                {/* Steps preview */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                  {wf.workflow_steps.map((step: any, i: number) => (
                    <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className={`step-type-icon ${step.step_type}`} style={{ width: 24, height: 24, fontSize: 12, borderRadius: 4 }}>
                        {STEP_ICONS[step.step_type] || '❓'}
                      </span>
                      {i < wf.workflow_steps.length - 1 && (
                        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>→</span>
                      )}
                    </div>
                  ))}
                  {wf.workflow_steps.length === 0 && (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No steps yet</span>
                  )}
                </div>

                {/* Triggers */}
                <div className="trigger-list">
                  {wf.workflow_triggers.map((t: any) => (
                    <span key={t.id} className="trigger-badge">
                      <span className="trigger-icon">{TRIGGER_ICONS[t.trigger_type] || '🔧'}</span>
                      {t.trigger_type.replace('_', ' ')}
                    </span>
                  ))}
                </div>

                <div style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  marginTop: 12,
                  display: 'flex',
                  justifyContent: 'space-between',
                }}>
                  <span>{wf.workflow_steps.length} step{wf.workflow_steps.length !== 1 ? 's' : ''}</span>
                  <span>{new Date(wf.updated_at).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create Modal */}
        {showCreate && (
          <div className="modal-overlay" onClick={() => setShowCreate(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>⚡ Create Workflow</h3>
              <div className="config-form">
                <div className="input-group">
                  <label>Workflow Name</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="My AI Workflow"
                    autoFocus
                  />
                </div>
                <div className="input-group">
                  <label>Description</label>
                  <textarea
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="What does this workflow do?"
                    rows={3}
                  />
                </div>
              </div>
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleCreate} disabled={creating || !newName.trim()}>
                  {creating ? 'Creating...' : 'Create Workflow'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
