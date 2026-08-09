'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/context';
import Sidebar from '@/components/Sidebar';

export default function SettingsPage() {
  const { user, loading, currentOrg, graphqlRequest, refreshOrgs } = useApp();
  const router = useRouter();
  const [members, setMembers] = useState<any[]>([]);
  const [orgStats, setOrgStats] = useState<any>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('viewer');
  const [newMemberUserId, setNewMemberUserId] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  const loadData = useCallback(async () => {
    if (!currentOrg) return;
    setLoadingData(true);
    try {
      const data = await graphqlRequest(
        `query OrgSettings($org_id: uuid!) {
          org_members(where: { org_id: { _eq: $org_id } }) {
            id role user_id created_at
          }
          organizations_by_pk(id: $org_id) {
            id name slug quota_limit quota_used quota_period_start
          }
        }`,
        { org_id: currentOrg.organization.id }
      );
      setMembers(data.org_members || []);
      setOrgStats(data.organizations_by_pk);
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setLoadingData(false);
    }
  }, [currentOrg, graphqlRequest]);

  useEffect(() => { loadData(); }, [loadData]);

  const addMember = async () => {
    if (!newMemberUserId.trim() || !currentOrg) return;
    setAdding(true);
    try {
      await graphqlRequest(
        `mutation AddMember($org_id: uuid!, $user_id: uuid!, $role: String!) {
          insert_org_members_one(object: { org_id: $org_id, user_id: $user_id, role: $role }) { id }
        }`,
        { org_id: currentOrg.organization.id, user_id: newMemberUserId, role: newMemberRole }
      );
      setShowAddMember(false);
      setNewMemberUserId('');
      setNewMemberEmail('');
      await loadData();
    } catch (error: any) {
      alert('Failed to add member: ' + error.message);
    } finally {
      setAdding(false);
    }
  };

  const removeMember = async (memberId: string) => {
    if (!confirm('Remove this member?')) return;
    try {
      await graphqlRequest(
        `mutation RemoveMember($id: uuid!) { delete_org_members_by_pk(id: $id) { id } }`,
        { id: memberId }
      );
      await loadData();
    } catch (error: any) {
      alert('Failed: ' + error.message);
    }
  };

  const updateMemberRole = async (memberId: string, newRole: string) => {
    try {
      await graphqlRequest(
        `mutation UpdateRole($id: uuid!, $role: String!) {
          update_org_members_by_pk(pk_columns: { id: $id }, _set: { role: $role }) { id }
        }`,
        { id: memberId, role: newRole }
      );
      await loadData();
      await refreshOrgs();
    } catch (error: any) {
      alert('Failed: ' + error.message);
    }
  };

  const isOwner = currentOrg?.role === 'owner';

  if (loading || !user) return <div className="loading-page"><div className="loading-spinner" style={{ width: 32, height: 32 }}></div></div>;

  return (
    <div className="app-container">
      <Sidebar active="settings" />
      <div className="main-content">
        <div className="page-header">
          <div>
            <h2>Settings</h2>
            <p className="subtitle">{currentOrg?.organization.name} organization settings</p>
          </div>
        </div>

        {/* Org Info */}
        {orgStats && (
          <div className="card" style={{ marginBottom: 24, maxWidth: 600 }}>
            <div className="card-title" style={{ marginBottom: 16 }}>🏢 Organization Info</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Name</div>
                <div style={{ fontWeight: 600 }}>{orgStats.name}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Slug</div>
                <div style={{ fontWeight: 600 }}>{orgStats.slug}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Quota Usage</div>
                <div style={{ fontWeight: 600 }}>
                  {orgStats.quota_used} / {orgStats.quota_limit} runs
                </div>
                <div className="quota-track" style={{ marginTop: 6 }}>
                  <div
                    className={`quota-fill ${(orgStats.quota_used / orgStats.quota_limit) > 0.8 ? 'warning' : ''}`}
                    style={{ width: `${Math.min(100, (orgStats.quota_used / orgStats.quota_limit) * 100)}%` }}
                  />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Quota Period</div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {orgStats.quota_period_start ? new Date(orgStats.quota_period_start).toLocaleDateString() : '—'} — now
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Members */}
        <div className="card" style={{ maxWidth: 700 }}>
          <div className="card-header">
            <div className="card-title">👥 Members ({members.length})</div>
            {isOwner && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowAddMember(true)}>
                ➕ Add Member
              </button>
            )}
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>User ID</th>
                <th>Role</th>
                <th>Joined</th>
                {isOwner && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id}>
                  <td style={{ fontSize: 12, fontFamily: 'monospace' }}>
                    {member.user_id.slice(0, 8)}...
                    {member.user_id === user?.id && (
                      <span className="badge badge-info" style={{ marginLeft: 8, fontSize: 9 }}>YOU</span>
                    )}
                  </td>
                  <td>
                    {isOwner && member.user_id !== user?.id ? (
                      <select
                        value={member.role}
                        onChange={(e) => updateMemberRole(member.id, e.target.value)}
                        style={{ padding: '4px 8px', fontSize: 12 }}
                      >
                        <option value="owner">Owner</option>
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    ) : (
                      <span className={`badge ${member.role === 'owner' ? 'badge-success' : member.role === 'editor' ? 'badge-info' : 'badge-warning'}`}>
                        {member.role}
                      </span>
                    )}
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {new Date(member.created_at).toLocaleDateString()}
                  </td>
                  {isOwner && (
                    <td>
                      {member.user_id !== user?.id && (
                        <button className="btn btn-danger btn-sm" onClick={() => removeMember(member.id)}>
                          Remove
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add Member Modal */}
        {showAddMember && (
          <div className="modal-overlay" onClick={() => setShowAddMember(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>➕ Add Member</h3>
              <div className="config-form">
                <div className="input-group">
                  <label>User ID (UUID)</label>
                  <input
                    value={newMemberUserId}
                    onChange={(e) => setNewMemberUserId(e.target.value)}
                    placeholder="Paste the user's UUID"
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    The user must have an account. Share your org slug for them to find you.
                  </span>
                </div>
                <div className="input-group">
                  <label>Role</label>
                  <select value={newMemberRole} onChange={(e) => setNewMemberRole(e.target.value)}>
                    <option value="viewer">Viewer (read-only)</option>
                    <option value="editor">Editor (create/edit/run)</option>
                    <option value="owner">Owner (full control)</option>
                  </select>
                </div>
              </div>
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => setShowAddMember(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={addMember} disabled={adding || !newMemberUserId.trim()}>
                  {adding ? 'Adding...' : 'Add Member'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
