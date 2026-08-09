'use client';

import { useApp } from '@/lib/context';
import { useRouter, usePathname } from 'next/navigation';
import { useState } from 'react';

export default function Sidebar({ active }: { active: string }) {
  const { user, currentOrg, orgs, setCurrentOrg, signOut } = useApp();
  const router = useRouter();
  const [showOrgDropdown, setShowOrgDropdown] = useState(false);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊', path: '/dashboard' },
    { id: 'workflows', label: 'Workflows', icon: '⚡', path: '/workflows' },
    { id: 'settings', label: 'Settings', icon: '⚙️', path: '/settings' },
  ];

  const quotaPercent = currentOrg
    ? Math.min(100, (currentOrg.organization.quota_used / currentOrg.organization.quota_limit) * 100)
    : 0;

  return (
    <div className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="logo-icon">⚡</div>
        <h1>AgentFlow</h1>
      </div>

      {/* Org Switcher */}
      {currentOrg && (
        <div style={{ position: 'relative', marginBottom: 20 }}>
          <div className="org-switcher" onClick={() => setShowOrgDropdown(!showOrgDropdown)}>
            <div className="org-name">{currentOrg.organization.name}</div>
            <div className="org-role">{currentOrg.role} · ▾</div>
          </div>
          {showOrgDropdown && (
            <div className="org-dropdown">
              {orgs.map((org) => (
                <div
                  key={org.organization.id}
                  className={`org-option ${org.organization.id === currentOrg.organization.id ? 'active' : ''}`}
                  onClick={() => {
                    setCurrentOrg(org);
                    setShowOrgDropdown(false);
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{org.organization.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{org.role}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <div
            key={item.id}
            className={`nav-item ${active === item.id ? 'active' : ''}`}
            onClick={() => router.push(item.path)}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </div>
        ))}
      </nav>

      {/* Quota Bar */}
      {currentOrg && (
        <div className="quota-bar">
          <div className="quota-label">
            <span>Quota</span>
            <span>{currentOrg.organization.quota_used}/{currentOrg.organization.quota_limit}</span>
          </div>
          <div className="quota-track">
            <div
              className={`quota-fill ${quotaPercent > 80 ? 'warning' : ''}`}
              style={{ width: `${quotaPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* User info & sign out */}
      <div style={{
        padding: '12px 8px',
        borderTop: '1px solid var(--border-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 8,
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{user?.displayName}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{user?.email}</div>
        </div>
        <button
          className="btn-icon"
          onClick={async () => { await signOut(); router.push('/login'); }}
          title="Sign out"
        >
          🚪
        </button>
      </div>
    </div>
  );
}
