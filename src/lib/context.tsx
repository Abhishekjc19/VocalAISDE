'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { nhost } from './nhost';

// ============================================================
// Auth + Org Context
// Manages user authentication state and current organization
// ============================================================

interface User {
  id: string;
  email: string;
  displayName: string;
}

interface OrgMembership {
  id: string;
  role: 'owner' | 'editor' | 'viewer';
  organization: {
    id: string;
    name: string;
    slug: string;
    quota_limit: number;
    quota_used: number;
  };
}

interface AppContextType {
  user: User | null;
  loading: boolean;
  orgs: OrgMembership[];
  currentOrg: OrgMembership | null;
  setCurrentOrg: (org: OrgMembership) => void;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshOrgs: () => Promise<void>;
  graphqlRequest: (query: string, variables?: Record<string, any>) => Promise<any>;
}

const AppContext = createContext<AppContextType>({} as AppContextType);

export function useApp() {
  return useContext(AppContext);
}

// Simple GraphQL client that works with nhost auth
async function gqlRequest(query: string, variables: Record<string, any> = {}, token?: string | null) {
  const graphqlUrl = 'https://wswbfudwrzygkeyjsofk.graphql.ap-south-1.nhost.run/v1';
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(graphqlUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (json.errors) {
    throw new Error(json.errors[0].message);
  }
  return json.data;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<OrgMembership[]>([]);
  const [currentOrg, setCurrentOrgState] = useState<OrgMembership | null>(null);

  // Check for saved session
  useEffect(() => {
    const savedUser = localStorage.getItem('agentflow_user');
    const savedOrg = localStorage.getItem('agentflow_current_org');
    
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        setUser(parsed);
      } catch {}
    }
    
    setLoading(false);
  }, []);

  // Load orgs when user changes
  useEffect(() => {
    if (user) {
      refreshOrgs();
    }
  }, [user]);

  // Restore current org after orgs load
  useEffect(() => {
    if (orgs.length > 0 && !currentOrg) {
      const savedOrg = localStorage.getItem('agentflow_current_org');
      if (savedOrg) {
        try {
          const parsed = JSON.parse(savedOrg);
          const found = orgs.find(o => o.organization.id === parsed.organization?.id);
          if (found) {
            setCurrentOrgState(found);
            return;
          }
        } catch {}
      }
      setCurrentOrgState(orgs[0]);
    }
  }, [orgs]);

  const graphqlRequest = useCallback(async (query: string, variables: Record<string, any> = {}) => {
    const token = nhost.auth.getAccessToken();
    return gqlRequest(query, variables, token);
  }, []);

  const refreshOrgs = useCallback(async () => {
    if (!user) return;
    try {
      const data = await graphqlRequest(
        `query GetUserOrgs($user_id: uuid!) {
          org_members(where: { user_id: { _eq: $user_id } }) {
            id
            role
            organization {
              id
              name
              slug
              quota_limit
              quota_used
            }
          }
        }`,
        { user_id: user.id }
      );
      setOrgs(data.org_members || []);
    } catch (error) {
      console.error('Failed to load orgs:', error);
    }
  }, [user, graphqlRequest]);

  const setCurrentOrg = useCallback((org: OrgMembership) => {
    setCurrentOrgState(org);
    localStorage.setItem('agentflow_current_org', JSON.stringify(org));
  }, []);

  const signIn = async (email: string, password: string): Promise<{ error?: string }> => {
    try {
      const result = await nhost.auth.signIn({ email, password });
      if (result.error) {
        return { error: result.error.message };
      }
      const nhostUser = result.session?.user;
      if (nhostUser) {
        const userData: User = {
          id: nhostUser.id,
          email: nhostUser.email || '',
          displayName: nhostUser.displayName || email.split('@')[0],
        };
        setUser(userData);
        localStorage.setItem('agentflow_user', JSON.stringify(userData));
      }
      return {};
    } catch (e: any) {
      console.error('SignIn error:', e);
      return { error: 'Failed to connect to authentication server. Please verify your internet connection and Vercel environment variables.' };
    }
  };

  const signUp = async (email: string, password: string, displayName: string): Promise<{ error?: string }> => {
    try {
      const result = await nhost.auth.signUp({
        email,
        password,
        options: { displayName },
      });
      if (result.error) {
        return { error: result.error.message };
      }
      const nhostUser = result.session?.user;
      if (nhostUser) {
        const userData: User = {
          id: nhostUser.id,
          email: nhostUser.email || '',
          displayName: nhostUser.displayName || displayName,
        };
        setUser(userData);
        localStorage.setItem('agentflow_user', JSON.stringify(userData));
      }
      return {};
    } catch (e: any) {
      console.error('SignUp error:', e);
      return { error: 'Failed to connect to authentication server. Please verify your internet connection and Vercel environment variables.' };
    }
  };

  const signOut = async () => {
    try {
      await nhost.auth.signOut();
    } catch {}
    setUser(null);
    setOrgs([]);
    setCurrentOrgState(null);
    localStorage.removeItem('agentflow_user');
    localStorage.removeItem('agentflow_current_org');
  };

  return (
    <AppContext.Provider value={{
      user, loading, orgs, currentOrg, setCurrentOrg,
      signIn, signUp, signOut, refreshOrgs, graphqlRequest,
    }}>
      {children}
    </AppContext.Provider>
  );
}
