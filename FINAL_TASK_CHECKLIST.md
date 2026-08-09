# Final Task Scenario — Live Demonstration Checklist

## 🎯 Objective
Demonstrate end-to-end that the system handles complex workflows with proper permission isolation, approval gates, and multi-trigger support.

---

## ✅ Pre-Flight Checklist

Before starting the demo:

- [ ] **App is deployed**
  - Frontend: https://vocal.labs.vercel.app
  - Backend: Nhost services running
  - Check: Nhost dashboard shows "Deployment Succeeded"

- [ ] **Two Test Organizations Created**
  - Org A: "Acme Corp" (Owner + Org A users)
  - Org B: "TechVentures" (Owner + Org B users)
  - Can login to both in separate browsers

- [ ] **Test Users Set Up**
  - Org A: 1 owner, 1 editor
  - Org B: 1 owner, 1 viewer
  - All users have unique email addresses

- [ ] **Backend Services Healthy**
  - Hasura responding at GraphQL endpoint
  - Postgres database connected
  - Functions deployed (trigger-run, approve-step, webhook, cron)

- [ ] **API Keys (Optional)**
  - GROQ_API_KEY: If set, LLM calls will be real; if unset, stubbed with realistic delay
  - WEBHOOK_SECRET: Set to "agent-flow-webhook-secret-2024" (verify in nhost env vars)

---

## 🚀 Demo Flow (15–20 mins)

### Phase 1: Build Complex Workflow (5 mins)

**Step 1.1: Sign in as Org A Owner**
- Navigate to https://vocal.labs.vercel.app
- Login with Org A owner credentials
- Verify dashboard shows "Acme Corp" selected

**Step 1.2: Create New Workflow**
- Click "Workflows" in sidebar
- Click "New Workflow" button
- Name: "Customer Sentiment Analysis"
- Description: "Analyze customer feedback and take action based on sentiment"
- Click "Create Workflow"

**Step 1.3: Add 5 Steps (Drag to reorder)**
1. **Step 1 — LLM Call**
   - Name: "Analyze Sentiment"
   - Type: LLM Call
   - Config: Prompt = "Analyze the input text for sentiment (positive/negative/neutral)"
   - Model: llama-3.1-8b-instant
   - Add step

2. **Step 2 — Conditional Branch**
   - Name: "Check Sentiment"
   - Type: Conditional Branch
   - Config: Condition = "contains('positive')"
   - True branch = "continue"
   - False branch = "skip_next"
   - Add step

3. **Step 3 — HTTP Request**
   - Name: "Submit to CRM"
   - Type: HTTP Request
   - Config: URL = "https://webhook.site/your-unique-id" (or httpbin.org)
   - Method = POST
   - Headers = Content-Type: application/json
   - Add step

4. **Step 4 — Approval Gate**
   - Name: "Manager Approval"
   - Type: Approval Gate
   - Config: Required role = owner
   - Add step

5. **Step 5 — DB Write**
   - Name: "Save Results"
   - Type: DB Write
   - Config: Table = workflow_results
   - Add step

**Step 1.4: Add Triggers**
- Click "Add Trigger"
- **Trigger 1 — Manual**
  - Type: Manual
  - (Default, already present)
  
- **Trigger 2 — Webhook**
  - Type: Webhook
  - Copy webhook URL for later
  - Secret: agent-flow-webhook-secret-2024 (auto-filled)
  - Save

- **Trigger 3 — Scheduled (Optional)**
  - Type: Scheduled
  - Config: Cron = "0 9 * * 1" (Monday 9 AM UTC)
  - Save

**Result:** Workflow shows 5 steps in order + 2–3 triggers

---

### Phase 2: Run Workflow with Approval Gate (5 mins)

**Step 2.1: Manual Trigger → Watch Steps Execute**
- Click "Run" button
- Tab switches to "Runs" view
- Live updates show:
  - Step 1 (Analyze Sentiment): ⏳ running → ✅ completed (show output: LLM response)
  - Step 2 (Check Sentiment): ⏳ running → ✅ completed (show: positive branch selected)
  - Step 3 (Submit to CRM): ⏳ running → ✅ completed (show: HTTP 200)
  - Step 4 (Manager Approval): ⏳ running → ⏹️ **PAUSED** (red highlight)
  - **Approval button appears**
  - Step 5 (Save Results): ⏳ pending (grayed out)

**Step 2.2: Approve from Org A Editor Account**
- Open second browser tab (private window for clean session)
- Login as Org A editor
- Navigate to same workflow
- In the "Runs" tab, see the paused run
- Click "Approve" button
- Confirmation: "Step approved. Workflow resuming."

**Step 2.3: Watch Remaining Steps Execute**
- Switch back to first browser tab
- See Step 4 update: ⏹️ paused → ✅ completed (show: approved_by = editor, approved_at = timestamp)
- See Step 5 execute: ⏳ running → ✅ completed (show: saved to database)
- Overall run status: ✅ completed

**Step 2.4: Verify Quota Incremented**
- Go to Dashboard
- Verify "Total Requests" increased by 1
- Verify quota bar updated

---

### Phase 3: Test Webhook Trigger (3 mins)

**Step 3.1: Get Webhook URL**
- Go to Workflow → Triggers section
- Copy the webhook URL and secret

**Step 3.2: Trigger via Webhook (using curl)**
```bash
curl -X POST "https://vocal.labs.vercel.app/api/webhooks/trigger" \
  -H "x-webhook-secret: agent-flow-webhook-secret-2024" \
  -H "Content-Type: application/json" \
  -d '{"workflow_id": "YOUR_WORKFLOW_ID", "payload": {"customer_id": 12345, "feedback": "Excellent product, very satisfied with the service"}}'
```

Or use Postman:
- Method: POST
- URL: [webhook URL from app]
- Headers: x-webhook-secret = agent-flow-webhook-secret-2024
- Body (JSON): {"workflow_id": "...", "payload": {...}}
- Send

**Step 3.3: Verify Run Created**
- Refresh "Runs" tab
- New run appears with trigger_type = "webhook"
- Steps execute automatically (no approval needed on 2nd run if different config, or approval pauses again)
- Live status updates show each step

---

### Phase 4: Cross-Org Isolation Proof (5 mins)

**Step 4.1: Switch to Org B User**
- Open third browser tab (private window)
- Logout of all Nhost sessions
- Login as Org B user (editor or viewer)

**Step 4.2: Verify Cannot See Org A Workflows**
- Go to /workflows
- Page loads, but workflow list is empty
- Quota bar shows 0 usage (different org)
- Dashboard shows 0 workflows, 0 runs

**Step 4.3: Attempt Direct ID Access**
- Try to navigate to Org A workflow ID: /workflows/[org-a-workflow-id]
- Page may load, but:
  - Query returns empty result
  - No workflow data displayed
  - Builder is inaccessible

**Step 4.4: Attempt Direct Trigger**
- Open browser console (F12)
- Try to manually trigger via GraphQL:
```javascript
// This will fail because query is scoped to user's orgs
fetch('https://wswbfudwrzygkeyjsofk.graphql.ap-south-1.nhost.run/v1', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer [org-b-user-token]'
  },
  body: JSON.stringify({
    query: `mutation { triggerWorkflowRun(workflow_id: "[org-a-workflow-id]") { workflow_run_id } }`
  })
})
.then(r => r.json())
.then(d => console.log(d))
```
- Result: 403 Permission denied or empty result

**Step 4.5: Verify Org B User Cannot Approve**
- Even if they could trigger (hypothetically), they cannot approve
- approval_gate step requires owner/editor in **that org**
- Org B user is not a member of Org A
- approveStep Action returns 403

**Result:** ✅ Complete cross-org isolation proven

---

## 📋 Success Criteria (All Must Be True)

| Criterion | Pass | Evidence |
|-----------|------|----------|
| Two orgs exist with separate users | ✅ | Can login to both |
| Workflow has 5+ steps of different types | ✅ | Builder shows all 5 steps |
| Steps include llm_call, conditional_branch, http_request | ✅ | Step configs visible |
| Workflow can be triggered manually AND via webhook | ✅ | Both methods create runs |
| Approval gate pauses run | ✅ | Step status = "paused", approval button appears |
| Only owner/editor can approve | ✅ | Org B user cannot access approval button |
| Remaining steps execute after approval | ✅ | Steps 5+ show ✅ completed |
| Live status streams step-by-step | ✅ | Each step updates in real-time |
| Org B user cannot see Org A workflows | ✅ | /workflows shows empty, direct ID returns 404 |
| Org B user cannot trigger Org A workflow | ✅ | triggerWorkflowRun returns 403 |
| Org B user cannot approve Org A steps | ✅ | approveStep returns 403 |

---

## 🐛 Troubleshooting (If Demo Breaks)

### Issue: Workflows page shows "Loading workflows..."
- **Check:** Browser console (F12) for errors
- **Fix:** Click "Try Again" button or refresh page
- **Root cause:** GraphQL endpoint not responding; verify Nhost backend is up

### Issue: Run stuck in "pending" status
- **Check:** Function logs in Nhost dashboard
- **Fix:** May be normal if approval gate is waiting; approve to resume
- **Root cause:** Step execution may be slow on first run (LLM calls take 1–2s)

### Issue: Approval button not appearing
- **Check:** Step 4 status is "paused" (not failed/completed)
- **Fix:** Reload page or check workflow_run status in GraphQL
- **Root cause:** Step may not have paused (wrong step_type or config)

### Issue: Org B can see Org A workflows
- **Check:** Hasura permissions in metadata (tables.yaml)
- **Fix:** Verify org_members relationship is in select_permissions filter
- **Root cause:** RLS not enforced; redeploy Hasura metadata

### Issue: Cannot trigger webhook
- **Check:** Webhook secret in header matches WEBHOOK_SECRET env var
- **Fix:** Regenerate secret in .env, redeploy functions
- **Root cause:** Secret mismatch or webhook endpoint not responding

---

## ⏱️ Estimated Timeline

| Phase | Duration | Notes |
|-------|----------|-------|
| Setup (app loads, login) | 1 min | Should be instant |
| Build workflow | 3 mins | Adding 5 steps, 2–3 triggers |
| Manual trigger + approval | 3 mins | Step-by-step execution + approval flow |
| Webhook trigger | 2 mins | Copy-paste curl command, verify run |
| Cross-org isolation tests | 3 mins | Switch orgs, verify denials |
| **Total** | **12–15 mins** | **Buffer for questions: +5 mins** |

---

## 📹 Recording Tips (If Recording Demo)

- **Screen Resolution:** 1920x1080 or 1280x720 (for YouTube)
- **Font Size:** Zoom browser to 110–125% for readability
- **Narration:** Speak clearly, explain what you're clicking and why
- **Pacing:** Slow down during important transitions (approval gate, cross-org tests)
- **Audio:** Record in quiet environment, no background noise
- **Editing:** Splice out any waits (e.g., LLM API calls) or speed up those sections
- **Title Card:** Start with project name, end date, "Final Task Demonstration"
- **Duration:** ~5–8 minutes for full scenario

---

## 🎬 Go Live Checklist

**Before pressing record:**
- [ ] All browsers logged out
- [ ] Fresh incognito tabs for each user
- [ ] Workflow ready to build (org, user access verified)
- [ ] Webhook URL copied
- [ ] Nhost dashboard open in background tab (in case you need to show logs)
- [ ] Network stable (test speed: https://speedtest.net)
- [ ] Microphone levels tested
- [ ] Recording software running (OBS, Loom, etc.)

**During recording:**
- [ ] Narrate each step clearly
- [ ] Show browser console if errors occur
- [ ] Slow down at approval gate (the key feature)
- [ ] Emphasize cross-org isolation (the security centerpiece)
- [ ] Show user roles when switching accounts

**After recording:**
- [ ] Save video with clear filename: `VocalAISDE_FinalTask_Demo_[Date].mp4`
- [ ] Upload to YouTube (unlisted or private link)
- [ ] Share link in submission

---

## ✨ Demo Notes

- **LLM Calls:** Will take 1–2 seconds (real Groq API if key is set, else stubbed). This is realistic and shows real-world behavior.
- **Approval Gate:** This is the centerpiece. Take your time explaining how Layer 2 permission check happens in the Action handler (not just database).
- **Cross-Org Isolation:** Show the GraphQL filter explicitly if possible (browser DevTools Network tab shows the query with org_members filter).
- **Quota:** May not change visibly if demo is fast; if needed, show before/after numbers in dashboard.

---

## 📊 Final Checklist

When demo is complete and recorded:

- [ ] All 6 success criteria verified
- [ ] Video uploaded and link ready
- [ ] GitHub repo link ready (https://github.com/Abhishekjc19/VocalAISDE)
- [ ] Live app link ready (https://vocal.labs.vercel.app)
- [ ] ASSIGNMENT_COMPLETE.md reviewed for clarity
- [ ] Submission package ready:
  - GitHub repo link
  - Live app URL
  - Demo video link
  - Assignment completion report (ASSIGNMENT_COMPLETE.md)

---

**Status:** ✅ Ready to demonstrate

Run through this checklist before recording. The system is fully functional and the Final Task scenario should flow smoothly if all prerequisites are in place.
