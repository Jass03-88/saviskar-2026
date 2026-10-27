# SAVISKAR 2K26 — Broadcast Queue Automatic Processing Runbook

**Environment:** Hostinger Node.js Standalone Reverse Proxy (`saviskar.co.in`)<br>
**Target:** Automatic Background Delivery Processing for Participant & Certificate Broadcasts<br>
**Status:** Operations Runbook & Configuration Guide

---

## 1. Overview & Architecture

The SAVISKAR 2K26 broadcast system automatically drains queued email campaigns in controlled, rate-safe batches via scheduled HTTP invocations.

- **Schedule Frequency:** Every 1 minute (`* * * * *`).
- **Endpoint:** `POST https://saviskar.co.in/api/admin/broadcast/cron/process-queue`
- **Execution Budget:** 20 seconds maximum per invocation (guaranteeing completion well within Hostinger's 60-second reverse proxy timeout).
- **Concurrency Control:** Atomic database-backed lease in `broadcast_worker_leases` (`acquire_broadcast_worker_lease` / `release_broadcast_worker_lease`), preventing overlapping execution across multiple cron invocations or connection poolers.
- **Fail-Closed Safeguards:** Fails closed on preview environments (`*.hostingersite.com`), read-only mode, or if live broadcast mode is disabled.
- **Emergency Stop:** Environment variable switch immediately halts all automatic queue dispatches within milliseconds.
- **Fallback:** The manual **"Process Queue"** button in `/admin/broadcast` remains 100% operational.

---

## 2. Server-Only Environment Variables

Configure the following variables in Hostinger hPanel (**Advanced > Environment Variables** or `.env.production`):

| Variable Name | Classification | Default / Example | Purpose |
| :--- | :--- | :--- | :--- |
| `BROADCAST_CRON_SECRET` | `CRITICAL_SECRET` | *(64-character hex string)* | Authenticates scheduled requests from the cron runner. |
| `SAVISKAR_BROADCAST_LIVE_ENABLED` | `INTERNAL_CONFIG` | `"true"` | Global gate required for outbound live email dispatch. |
| `SAVISKAR_BROADCAST_EMERGENCY_STOP`| `INTERNAL_CONFIG` | `"false"` | Global kill switch; set to `"true"` to halt all background dispatching. |
| `RESEND_API_KEY` | `CRITICAL_SECRET` | `re_...` | Resend API key for outbound dispatch. |
| `RESEND_CAMPAIGN_FROM_EMAIL` | `INTERNAL_CONFIG` | `Saviskar Updates <broadcast@updates.saviskar.co.in>` | Authorized sender identity. |

> [!CAUTION]
> **Never prefix these variables with `NEXT_PUBLIC_`**. They are strictly server-only.

---

## 3. How to Generate the Cron Secret

Generate a cryptographically strong 256-bit secret using OpenSSL or Node.js on your local machine:

```bash
# Using OpenSSL:
openssl rand -hex 32

# Or using Node.js:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Save this value into Hostinger’s environment variables as `BROADCAST_CRON_SECRET`.

---

## 4. Hostinger hPanel Cron Job Configuration

1. Log in to **Hostinger hPanel**.
2. Navigate to **Websites > Manage > Advanced > Cron Jobs**.
3. Under **Create a Cron Job**:
   - **Type:** `Custom`
   - **Common Settings:** `Every minute (* * * * *)`
   - **Command:**
     ```bash
     curl -s -X POST https://saviskar.co.in/api/admin/broadcast/cron/process-queue \
       -H "Authorization: Bearer YOUR_GENERATED_BROADCAST_CRON_SECRET" \
       -H "Content-Type: application/json" > /dev/null 2>&1
     ```
     *(Alternatively, pass secret via header `-H "x-broadcast-cron-secret: YOUR_SECRET"`)*
4. Click **Save**.

---

## 5. Emergency Stop & Operational Procedures

### Activating Emergency Stop
If you need to immediately halt email dispatching:
1. In Hostinger hPanel Environment Variables, set:
   ```env
   SAVISKAR_BROADCAST_EMERGENCY_STOP="true"
   ```
2. Restart the Node.js application (or redeploy).
3. Any subsequent cron trigger will immediately exit in `< 5ms` with:
   ```json
   {
     "success": true,
     "status": "emergency_stopped",
     "message": "Queue processing halted by emergency stop (SAVISKAR_BROADCAST_EMERGENCY_STOP=true)."
   }
   ```

### Resuming Automatic Processing
1. Set `SAVISKAR_BROADCAST_EMERGENCY_STOP="false"`.
2. Save and restart the Node.js application.

---

## 6. Verifying Scheduler Invocations & Monitoring

### Readiness & Health Check Probe (GET)
To safely verify endpoint connectivity, cron token authentication, and operational status without triggering queue execution, database mutations, lease acquisition, or email dispatches:

```bash
curl -i https://saviskar.co.in/api/admin/broadcast/cron/process-queue \
  -H "Authorization: Bearer YOUR_BROADCAST_CRON_SECRET"
```

**Expected Responses (HTTP 200):**
- **When live sending is disabled (standby / safe preflight state):**
  ```json
  {
    "success": true,
    "status": "standby",
    "authenticated": true,
    "liveBroadcastEnabled": false,
    "emergencyStopActive": false,
    "message": "Cron scheduler endpoint is healthy and authenticated. Live broadcast sending is disabled (standby). POST queue processing will be rejected until enabled.",
    "timestamp": "2026-10-28T02:00:00.000Z"
  }
  ```
- **When live sending is enabled (`SAVISKAR_BROADCAST_LIVE_ENABLED=true`):**
  ```json
  {
    "success": true,
    "status": "ready",
    "authenticated": true,
    "liveBroadcastEnabled": true,
    "emergencyStopActive": false,
    "message": "Cron scheduler endpoint is healthy and authenticated. Ready to process queue via POST.",
    "timestamp": "2026-10-28T02:00:00.000Z"
  }
  ```
- **When unauthorized (missing or invalid token):**
  ```json
  {
    "error": "Unauthorized: Invalid or missing cron secret."
  }
  ```
  *(HTTP 401)*

### Manual Queue Processing Trigger (POST)
You can test queue processing manually using curl from an authorized terminal:

```bash
curl -i -X POST https://saviskar.co.in/api/admin/broadcast/cron/process-queue \
  -H "Authorization: Bearer YOUR_BROADCAST_CRON_SECRET" \
  -H "Content-Type: application/json"
```

**Expected Responses:**
- **When queue has active deliveries:**
  ```json
  {
    "success": true,
    "status": "completed",
    "batchesExecuted": 2,
    "totalClaimed": 20,
    "totalSent": 20,
    "totalFailed": 0,
    "durationMs": 4850,
    "activeCampaignsProcessed": ["cf1b02a0-ab1c-4121-888b-7790ca208b3f"],
    "message": "Processed 20 deliveries in 2 batches.",
    "timestamp": "2026-10-27T22:00:00.000Z"
  }
  ```
- **When queue is idle:**
  ```json
  {
    "success": true,
    "status": "idle",
    "batchesExecuted": 0,
    "totalClaimed": 0,
    "totalSent": 0,
    "totalFailed": 0,
    "durationMs": 42,
    "activeCampaignsProcessed": [],
    "message": "Queue idle: no active campaigns in queued or processing status.",
    "timestamp": "2026-10-27T22:01:00.000Z"
  }
  ```
- **When another worker lease is currently running:**
  ```json
  {
    "success": true,
    "status": "locked",
    "batchesExecuted": 0,
    "totalClaimed": 0,
    "totalSent": 0,
    "totalFailed": 0,
    "durationMs": 0,
    "activeCampaignsProcessed": [],
    "message": "Skipped: another worker lease is currently active.",
    "timestamp": "2026-10-27T22:02:00.000Z"
  }
  ```
- **When unauthorized (missing or invalid token):**
  ```json
  {
    "error": "Unauthorized: Invalid or missing cron secret."
  }
  ```
  *(HTTP 401)*
