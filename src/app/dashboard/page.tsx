'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/context';
import Sidebar from '@/components/Sidebar';

export default function DashboardPage() {
  const { user, loading, currentOrg, graphqlRequest, refreshOrgs, orgs } = useApp();
  const router = useRouter();
  const [stats, setStats] = useState({ workflows: 0, runs: 0, activeRuns: 0 });
  const [recentRuns, setRecentRuns] = useState<any[]>([]);
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  const loadStats = useCallback(async () => {
    if (!currentOrg) return;
    try {
      const data = await graphqlRequest(
        `query DashboardStats($org_id: uuid!) {
          workflows_aggregate(where: { org_id: { _eq: $org_id } }) {
            aggregate { count }
          }
          workflow_runs(
            where: { workflow: { org_id: { _eq: $org_id } } },
            order_by: { created_at: desc },
            limit: 5
          ) {
            id
            status
            trigger_type
            created_at
            started_at
            completed_at
            workflow {
              id
              name
            }
          }
          running: workflow_runs_aggregate(
            where: { workflow: { org_id: { _eq: $org_id } }, status: { _in: ["running", "paused"] } }
          ) {
            aggregate { count }
          }
          total_runs: workflow_runs_aggregate(
            where: { workflow: { org_id: { _eq: $org_id } } }
          ) {
            aggregate { count }
          }
        }`,
        { org_id: currentOrg.organization.id }
      );
      setStats({
        workflows: data.workflows_aggregate.aggregate.count,
        runs: data.total_runs.aggregate.count,
        activeRuns: data.running.aggregate.count,
      });
      setRecentRuns(data.workflow_runs);
    } catch (error) {
      console.error('Failed to load dashboard stats:', error);
    }
  }, [currentOrg, graphqlRequest]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleCreateOrg = async () => {
    if (!newOrgName.trim() || !user) return;
    setCreating(true);
    try {
      const slug = newOrgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const data = await graphqlRequest(
        `mutation CreateOrg($name: String!, $slug: String!) {
          insert_organizations_one(object: { name: $name, slug: $slug }) {
            id
            name
            slug
          }
        }`,
        { name: newOrgName, slug }
      );

      // Add creator as owner
      await graphqlRequest(
        `mutation AddOwner($org_id: uuid!, $user_id: uuid!) {
          insert_org_members_one(object: { org_id: $org_id, user_id: $user_id, role: "owner" }) {
            id
          }
        }`,
        { org_id: data.insert_organizations_one.id, user_id: user.id }
      );

      await refreshOrgs();
      setShowCreateOrg(false);
      setNewOrgName('');
    } catch (error: any) {
      alert('Failed to create organization: ' + error.message);
    } finally {
      setCreating(false);
    }
  };

  if (loading || !user) return <div className="loading-page"><div className="loading-spinner" style={{ width: 32, height: 32 }}></div></div>;

  const quotaPercent = currentOrg
    ? Math.min(100, (currentOrg.organization.quota_used / currentOrg.organization.quota_limit) * 100)
    : 0;

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

  const formatTime = (ts: string) => {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="app-container">
      <Sidebar active="dashboard" />
      <div className="main-content">
        <div className="page-header">
          <div>
            <h2>Dashboard</h2>
            <p className="subtitle">
              {currentOrg ? `${currentOrg.organization.name} — ${currentOrg.role}` : 'No organization selected'}
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowCreateOrg(true)}>
            ➕ New Organization
          </button>
        </div>

        {!currentOrg && orgs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🏢</div>
            <h3>No Organization Yet</h3>
            <p>Create your first organization to get started with AI workflows.</p>
            <button className="btn btn-primary" onClick={() => setShowCreateOrg(true)}>
              ➕ Create Organization
            </button>
          </div>
        ) : (
          <>
            {/* Stats Grid */}
            <div className="cards-grid" style={{ marginBottom: 32 }}>
              <div className="card">
                <div className="card-header">
                  <span style={{ fontSize: 28 }}>📋</span>
                  <span className="badge badge-info">{stats.workflows}</span>
                </div>
                <div className="card-title">Total Workflows</div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                  Active workflow definitions
                </p>
              </div>

              <div className="card">
                <div className="card-header">
                  <span style={{ fontSize: 28 }}>🚀</span>
                  <span className="badge badge-success">{stats.runs}</span>
                </div>
                <div className="card-title">Total Runs</div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                  All-time workflow executions
                </p>
              </div>

              <div className="card">
                <div className="card-header">
                  <span style={{ fontSize: 28 }}>⚡</span>
                  <span className="badge badge-warning">{stats.activeRuns}</span>
                </div>
                <div className="card-title">Active Runs</div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                  Running or paused right now
                </p>
              </div>
            </div>

            {/* Quota Card */}
            {currentOrg && (
              <div className="card" style={{ marginBottom: 32, maxWidth: 500 }}>
                <div className="card-title" style={{ marginBottom: 12 }}>📊 Usage Quota</div>
                <div className="quota-label">
                  <span>{currentOrg.organization.quota_used} / {currentOrg.organization.quota_limit} runs</span>
                  <span>{quotaPercent.toFixed(0)}%</span>
                </div>
                <div className="quota-track">
                  <div
                    className={`quota-fill ${quotaPercent > 80 ? 'warning' : ''}`}
                    style={{ width: `${quotaPercent}%` }}
                  />
                </div>
              </div>
            )}

            {/* Recent Runs */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">Recent Runs</div>
                <button className="btn btn-secondary btn-sm" onClick={() => router.push('/workflows')}>
                  View All →
                </button>
              </div>
              {recentRuns.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: 14, padding: '20px 0' }}>
                  No runs yet. Create a workflow and trigger a run to see activity here.
                </p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Workflow</th>
                      <th>Status</th>
                      <th>Trigger</th>
                      <th>Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentRuns.map((run) => (
                      <tr key={run.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/workflows/${run.workflow.id}`)}>
                        <td style={{ fontWeight: 600 }}>{run.workflow.name}</td>
                        <td><span className={`badge ${getStatusBadge(run.status)}`}>{run.status}</span></td>
                        <td style={{ color: 'var(--text-secondary)' }}>{run.trigger_type}</td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{formatTime(run.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {/* Create Org Modal */}
        {showCreateOrg && (
          <div className="modal-overlay" onClick={() => setShowCreateOrg(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>🏢 Create Organization</h3>
              <div className="input-group">
                <label>Organization Name</label>
                <input
                  type="text"
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  placeholder="My AI Team"
                  autoFocus
                />
              </div>
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => setShowCreateOrg(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleCreateOrg} disabled={creating || !newOrgName.trim()}>
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
