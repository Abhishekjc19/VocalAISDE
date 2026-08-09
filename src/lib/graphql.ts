// ============================================================
// GraphQL Operations — Queries, Mutations, Subscriptions
// ============================================================

// ---- QUERIES ----

export const GET_USER_ORGS = `
  query GetUserOrgs($user_id: uuid!) {
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
  }
`;

export const GET_ORG_WORKFLOWS = `
  query GetOrgWorkflows($org_id: uuid!) {
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
        config
      }
      workflow_triggers {
        id
        trigger_type
        config
        is_active
      }
      workflow_runs(limit: 1, order_by: { created_at: desc }) {
        id
        status
        trigger_type
        created_at
        started_at
        completed_at
      }
    }
  }
`;

export const GET_WORKFLOW_DETAIL = `
  query GetWorkflowDetail($id: uuid!) {
    workflows_by_pk(id: $id) {
      id
      name
      description
      is_active
      org_id
      created_by
      created_at
      updated_at
      organization {
        id
        name
        quota_limit
        quota_used
      }
      workflow_steps(order_by: { step_order: asc }) {
        id
        step_order
        name
        step_type
        config
      }
      workflow_triggers {
        id
        trigger_type
        config
        is_active
      }
      workflow_runs(order_by: { created_at: desc }, limit: 10) {
        id
        status
        trigger_type
        started_at
        completed_at
        created_at
        error
        step_runs(order_by: { workflow_step: { step_order: asc } }) {
          id
          status
          input
          output
          error
          attempt_count
          approved_by
          approved_at
          started_at
          completed_at
          workflow_step {
            id
            name
            step_type
            step_order
          }
        }
      }
    }
  }
`;

export const GET_ORG_MEMBERS = `
  query GetOrgMembers($org_id: uuid!) {
    org_members(where: { org_id: { _eq: $org_id } }) {
      id
      role
      user_id
      created_at
      user {
        id
        email
        displayName
      }
    }
  }
`;

export const GET_ORG_USAGE = `
  query GetOrgUsage($org_id: uuid!) {
    organizations_by_pk(id: $org_id) {
      id
      name
      quota_limit
      quota_used
    }
    org_monthly_usage(where: { org_id: { _eq: $org_id } }) {
      runs_this_month
      avg_run_duration_seconds
      quota_remaining
    }
  }
`;

// ---- MUTATIONS ----

export const CREATE_ORGANIZATION = `
  mutation CreateOrganization($name: String!, $slug: String!) {
    insert_organizations_one(object: { name: $name, slug: $slug }) {
      id
      name
      slug
    }
  }
`;

export const ADD_ORG_MEMBER = `
  mutation AddOrgMember($org_id: uuid!, $user_id: uuid!, $role: String!) {
    insert_org_members_one(object: { org_id: $org_id, user_id: $user_id, role: $role }) {
      id
    }
  }
`;

export const CREATE_WORKFLOW = `
  mutation CreateWorkflow(
    $org_id: uuid!,
    $name: String!,
    $description: String!
  ) {
    insert_workflows_one(object: {
      org_id: $org_id,
      name: $name,
      description: $description
    }) {
      id
      name
    }
  }
`;

export const UPDATE_WORKFLOW = `
  mutation UpdateWorkflow($id: uuid!, $name: String!, $description: String!, $is_active: Boolean!) {
    update_workflows_by_pk(pk_columns: { id: $id }, _set: {
      name: $name, description: $description, is_active: $is_active
    }) {
      id
      name
    }
  }
`;

export const DELETE_WORKFLOW = `
  mutation DeleteWorkflow($id: uuid!) {
    delete_workflows_by_pk(id: $id) {
      id
    }
  }
`;

export const INSERT_WORKFLOW_STEP = `
  mutation InsertWorkflowStep(
    $workflow_id: uuid!,
    $step_order: Int!,
    $name: String!,
    $step_type: String!,
    $config: jsonb!
  ) {
    insert_workflow_steps_one(object: {
      workflow_id: $workflow_id,
      step_order: $step_order,
      name: $name,
      step_type: $step_type,
      config: $config
    }) {
      id
    }
  }
`;

export const UPDATE_WORKFLOW_STEP = `
  mutation UpdateWorkflowStep($id: uuid!, $name: String!, $step_type: String!, $config: jsonb!, $step_order: Int!) {
    update_workflow_steps_by_pk(pk_columns: { id: $id }, _set: {
      name: $name, step_type: $step_type, config: $config, step_order: $step_order
    }) {
      id
    }
  }
`;

export const DELETE_WORKFLOW_STEP = `
  mutation DeleteWorkflowStep($id: uuid!) {
    delete_workflow_steps_by_pk(id: $id) {
      id
    }
  }
`;

export const INSERT_WORKFLOW_TRIGGER = `
  mutation InsertWorkflowTrigger(
    $workflow_id: uuid!,
    $trigger_type: String!,
    $config: jsonb!
  ) {
    insert_workflow_triggers_one(object: {
      workflow_id: $workflow_id,
      trigger_type: $trigger_type,
      config: $config
    }) {
      id
    }
  }
`;

export const DELETE_WORKFLOW_TRIGGER = `
  mutation DeleteWorkflowTrigger($id: uuid!) {
    delete_workflow_triggers_by_pk(id: $id) {
      id
    }
  }
`;

// Hasura Actions
export const TRIGGER_WORKFLOW_RUN = `
  mutation TriggerWorkflowRun($workflow_id: uuid!) {
    triggerWorkflowRun(workflow_id: $workflow_id) {
      workflow_run_id
      status
      message
    }
  }
`;

export const APPROVE_STEP = `
  mutation ApproveStep($step_run_id: uuid!) {
    approveStep(step_run_id: $step_run_id) {
      success
      message
      workflow_run_id
    }
  }
`;

// ---- SUBSCRIPTIONS ----

export const SUBSCRIBE_STEP_RUNS = `
  subscription StepRunsLive($workflow_run_id: uuid!) {
    step_runs(
      where: { workflow_run_id: { _eq: $workflow_run_id } },
      order_by: { workflow_step: { step_order: asc } }
    ) {
      id
      status
      input
      output
      error
      attempt_count
      approved_by
      approved_at
      started_at
      completed_at
      workflow_step {
        id
        name
        step_type
        step_order
      }
    }
  }
`;

export const SUBSCRIBE_WORKFLOW_RUN = `
  subscription WorkflowRunLive($id: uuid!) {
    workflow_runs_by_pk(id: $id) {
      id
      status
      started_at
      completed_at
      error
    }
  }
`;

export const SUBSCRIBE_ORG_WORKFLOWS = `
  subscription OrgWorkflowsLive($org_id: uuid!) {
    workflows(where: { org_id: { _eq: $org_id } }, order_by: { updated_at: desc }) {
      id
      name
      is_active
      workflow_runs(limit: 1, order_by: { created_at: desc }) {
        id
        status
      }
    }
  }
`;
