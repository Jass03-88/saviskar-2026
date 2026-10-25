# Saviskar 2026 — Hostinger Security Audit & Vulnerability Remediation Report

**Date of Audit & Remediation:** 24 October 2026
**Target Domain:** `saviskar.co.in`
**Repository Branch:** `security/hostinger-vulnerabilities-2026` (isolated local feature branch created from `feat/multi-accommodation-production-release`)
**Node.js Version:** `v26.5.0`
**Package Manager:** `npm 11.17.0`
**Status of Remote/Production Environment:** **Untouched & Unmodified** (No commits, pushes, merges, or production deployments executed).

---

## Executive Summary

On 24 October 2026, Hostinger automated dependency vulnerability scanning reported **23 vulnerabilities** for the `saviskar.co.in` deployment:
- **2 Critical**
- **7 High**
- **11 Moderate**
- **3 Low**

An exhaustive, evidence-based audit was conducted locally on branch `security/hostinger-vulnerabilities-2026`. All 23 findings were cross-referenced against the actual repository lockfile (`package-lock.json`), npm security advisory database, GitHub Security Advisories (GHSA), and the live AST/call-sites of parent libraries.

### Remediation Outcome
- **Vulnerabilities Before:** 23 findings (npm audit metadata: 1 Critical, 6 High, 6 Moderate; total 13 package entries spanning 23 advisories).
- **Vulnerabilities After:** **0 (Zero)** — 0 Critical, 0 High, 0 Moderate, 0 Low.
- **Verification Tests:** **1,490 passed | 0 failed** across 102 test files.
- **Production Build:** `next build --webpack` completed successfully (exit code 0), generating 48/48 routes without error.
- **Landing Page Lock Policy:** 100% preserved; no locked landing page or core UI component files were modified.

---

## 1. Baseline vs. Post-Remediation Vulnerability Comparison

| Metric | Hostinger Baseline (24 Oct 2026) | Post-Remediation (`npm audit`) | Status |
| :--- | :---: | :---: | :---: |
| **Critical** | 2 | **0** | **100% Remediated** |
| **High** | 7 | **0** | **100% Remediated** |
| **Moderate** | 11 | **0** | **100% Remediated** |
| **Low** | 3 | **0** | **100% Remediated** |
| **Total Vulnerabilities** | **23** | **0** | **Clean Audit (0 vulnerabilities)** |

---

## 2. Exhaustive Audit & Status of All 23 Hostinger Findings

The table below documents every single reported vulnerability, advisory ID, dependency classification, pre/post versions, reachability in Saviskar-2026, and final verification status.

| # | Package & Reported Version | Advisory ID / CVE | Severity | Dep Type | Parent Introducer | Pre-Fix Version | Post-Fix Version | Reachability in Saviskar | Final Status |
|---|----------------------------|-------------------|----------|----------|-------------------|-----------------|------------------|--------------------------|--------------|
| 1 | `next@16.3.8` | [GHSA-673q-mjm6-r5xr](https://github.com/advisories/GHSA-673q-mjm6-r5xr) | Critical | Direct | `package.json` | `16.3.8` | `16.4.3` | Low (`use cache` with typed arrays not used in app) | **Fixed and verified locally** |
| 2 | `next@16.3.8` | [GHSA-2464-fhr4-w9xw](https://github.com/advisories/GHSA-2464-fhr4-w9xw) | Critical | Direct | `package.json` | `16.3.8` | `16.4.3` | Medium (Next.js Image Optimization API active) | **Fixed and verified locally** |
| 3 | `undici@7.30.0` | [GHSA-4qv8-2p9j-2685](https://github.com/advisories/GHSA-4qv8-2p9j-2685)<br>(CVE-2026-109869) | High | Transitive | `shadcn@4.21.1` -> `@dotenvx/dotenvx` | `7.30.0` | `7.30.1` | Low (CLI config parsing only) | **Fixed and verified locally** |
| 4 | `body-parser@2.3.0` | [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828)<br>(CVE-2026-111181) | High | Transitive | `shadcn` -> `@modelcontextprotocol/sdk` -> `express@5.2.1` | `2.3.0` | `2.4.0` | Low (MCP dev server dependency in CLI tool) | **Fixed and verified locally** |
| 5 | `next@16.3.8` | [GHSA-p3m5-59mp-jv5r](https://github.com/advisories/GHSA-p3m5-59mp-jv5r)<br>(CVE-2026-94482) | High | Direct | `package.json` | `16.3.8` | `16.4.3` | High (Server Actions actively used in App Router) | **Fixed and verified locally** |
| 6 | `vite@8.2.2` | [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv)<br>(CVE-2026-112942) | High | Transitive Dev | `vitest@4.1.11` | `8.2.2` | `8.3.5` (target >=8.2.4) | Low (Dev/test runner only, not shipped to prod) | **Development-only and patched** |
| 7 | `zod@3.25.76` | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)<br>(CVE-2023-54404) | High | Transitive | `shadcn@4.21.1` -> `@shadcn/registry@0.1.0` | `3.25.76` | *Removed* (`^4.2.0` in `shadcn@4.22.1`) | None (CLI component installer dependency) | **Fixed and verified locally** |
| 8 | `zod@4.6.5` | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)<br>(CVE-2023-54404) | High | Transitive | `shadcn@4.21.1`, `eslint-config-next` | `4.6.5` | `4.6.7` | Low (CLI schema validation only) | **Fixed and verified locally** |
| 9 | `uuid@8.3.2` | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)<br>(CVE-2026-41907) | High / Moderate | Transitive | `exceljs@4.4.0` | `8.3.2` | `11.1.1` | Unreachable (`exceljs` only calls `uuidv4()` for random XML node IDs; no v3/v5/v6 buffer parsing) | **Fixed and verified locally** |
| 10 | `undici@7.30.0` | [GHSA-f72v-6w45-q472](https://github.com/advisories/GHSA-f72v-6w45-q472)<br>(CVE-2026-109924) | Moderate | Transitive | `shadcn@4.21.1` | `7.30.0` | `7.30.1` | None | **Fixed and verified locally** |
| 11 | `undici@7.30.0` | [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c)<br>(CVE-2026-109841) | Moderate | Transitive | `shadcn@4.21.1` | `7.30.0` | `7.30.1` | None | **Fixed and verified locally** |
| 12 | `fast-uri@3.1.8` | [GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg)<br>(CVE-2026-110306) | Moderate | Transitive | `shadcn` -> `ajv@8.20.0` | `3.1.8` | `3.1.9` | None | **Fixed and verified locally** |
| 13 | `fast-uri@3.1.8` | [GHSA-xhq7-xmqj-769h](https://github.com/advisories/GHSA-xhq7-xmqj-769h)<br>(CVE-2026-110180) | Moderate | Transitive | `shadcn` -> `ajv@8.20.0` | `3.1.8` | `3.1.9` | None | **Fixed and verified locally** |
| 14 | `ip-address@10.7.3` | [GHSA-rxp7-6hxx-x8q5](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5)<br>(CVE-2026-111997) | Moderate | Transitive | `shadcn` -> `socks` / `express-rate-limit` | `10.7.3` | `10.7.4` | None | **Fixed and verified locally** |
| 15 | `@vitest/mocker@4.1.11` | [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8)<br>(CVE-2026-112949) | Moderate | Transitive Dev | `vitest@4.1.11` | `4.1.11` | `4.1.12` | Low (Local unit testing mocking only) | **Development-only and patched** |
| 16 | `@vitest/mocker@4.1.11` | [GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp)<br>(CVE-2026-112950) | Moderate | Transitive Dev | `vitest@4.1.11` | `4.1.11` | `4.1.12` | Low (Windows test mock redirection only) | **Development-only and patched** |
| 17 | `vite@8.2.2` | [GHSA-9jrq-w75r-8gcw](https://github.com/advisories/GHSA-9jrq-w75r-8gcw)<br>(CVE-2026-112946) | Moderate | Transitive Dev | `vitest@4.1.11` | `8.2.2` | `8.3.5` (target >=8.2.4) | Low (Test environment runner only) | **Development-only and patched** |
| 18 | `vite@8.2.2` | [GHSA-rq7h-c2jc-7f22](https://github.com/advisories/GHSA-rq7h-c2jc-7f22)<br>(CVE-2026-112947) | Moderate | Transitive Dev | `vitest@4.1.11` | `8.2.2` | `8.3.5` (target >=8.2.4) | Low (Test environment runner only) | **Development-only and patched** |
| 19 | `vite@8.2.2` | [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm)<br>(CVE-2026-112944) | Moderate | Transitive Dev | `vitest@4.1.11` | `8.2.2` | `8.3.5` (target >=8.2.4) | Low (launch-editor in test runner) | **Development-only and patched** |
| 20 | `vite@8.2.2` | [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw)<br>(CVE-2026-112943) | Moderate | Transitive Dev | `vitest@4.1.11` | `8.2.2` | `8.3.5` (target >=8.2.4) | Low (launch-editor in test runner) | **Development-only and patched** |
| 21 | `fast-uri@3.1.8` | [GHSA-wjr9-j795-jxcr](https://github.com/advisories/GHSA-wjr9-j795-jxcr)<br>(CVE-2026-110095) | Low | Transitive | `shadcn` -> `ajv@8.20.0` | `3.1.8` | `3.1.9` | None | **Fixed and verified locally** |
| 22 | `fast-uri@3.1.8` | [GHSA-333x-w4r6-6crp](https://github.com/advisories/GHSA-333x-w4r6-6crp)<br>(CVE-2026-110725) | Low | Transitive | `shadcn` -> `ajv@8.20.0` | `3.1.8` | `3.1.9` | None | **Fixed and verified locally** |
| 23 | `vite@8.2.2` | [GHSA-vfpm-58rq-9qcg](https://github.com/advisories/GHSA-vfpm-58rq-9qcg)<br>(CVE-2026-112945) | Low | Transitive Dev | `vitest@4.1.11` | `8.2.2` | `8.3.5` (target >=8.2.4) | Low (Dev/test runner only) | **Development-only and patched** |

---

## 3. Technical Changes Applied & Engineering Rationale

All changes were strictly limited to package declarations and dependency graph resolutions without altering application source code, API routes, or locked landing page components.

### 1. `package.json` Updates
```diff
--- a/package.json
+++ b/package.json
@@ -27,3 +27,3 @@
-    "next": "^16.3.6",
+    "next": "^16.4.3",
@@ -33,3 +33,3 @@
-    "shadcn": "4.21.1",
+    "shadcn": "4.22.1",
@@ -46,5 +46,10 @@
-    "eslint-config-next": "^16.3.8",
+    "eslint-config-next": "^16.4.3",
@@ -49,3 +54,8 @@
-    "vitest": "^4.1.11"
+    "vitest": "^4.1.12"
   },
+  "overrides": {
+    "exceljs": {
+      "uuid": "11.1.1"
+    }
+  }
```

### 2. Rationale for Each Change
- **`next` (`^16.3.6` -> `^16.4.3`) & `eslint-config-next` (`^16.3.8` -> `^16.4.3`):**
  Directly eliminates GHSA-673q-mjm6-r5xr, GHSA-2464-fhr4-w9xw, and CVE-2026-94482 within the supported Next.js 16.x line. Remains fully compatible with React `19.2.4`, Node.js `v26.5.0`, and Webpack build pipeline.
- **`shadcn` (`4.21.1` -> `4.22.1`):**
  `shadcn@4.21.1` had pinned `@shadcn/registry@0.1.0` (which pulled `zod@3.25.76`). Upgrading to `4.22.1` promotes `@shadcn/registry` to `0.2.0`, aligning all internal CLI dependencies to `"zod": "^4.2.0"`, eliminating `zod@3`, and resolving `zod@4.6.7`.
- **`vitest` (`^4.1.11` -> `^4.1.12`):**
  Promotes `@vitest/mocker` to `4.1.12` (fixing CVE-2026-112949 and CVE-2026-112950) and updates internal `vite` resolution to `8.2.4` (fixing 6 CVEs including Windows `launch-editor` injection).
- **Semver Updates for Transitives (`undici`, `body-parser`, `fast-uri`, `ip-address`):**
  All four packages were allowed by their respective parent packages' semver constraints:
  - `undici@7.30.1` satisfies `shadcn`'s `"undici": "^7.29.1"`.
  - `body-parser@2.4.0` satisfies `express@5.2.1`'s `"body-parser": "^2.2.1"`.
  - `fast-uri@3.1.9` satisfies `ajv@8.20.0`'s `"fast-uri": "^3.0.1"`.
  - `ip-address@10.7.4` satisfies `socks`'s `"ip-address": "^10.1.1"` and `express-rate-limit`'s `"ip-address": "^10.2.0"`.
- **`uuid` Override for `exceljs` (`11.1.1`):**
  `exceljs@4.4.0` declared `"uuid": "^8.3.0"`, locking `uuid@8.3.2`. Upstream `uuid` maintainers patched CVE-2026-41907 in `11.1.1` without an 8.x backport. Code inspection of `exceljs` revealed that `uuid` is only invoked in `cf-rule-ext-xform.js`: `const {v4: uuidv4} = require('uuid'); model.x14Id = '{' + uuidv4() + '}'.toUpperCase();`. `uuid@11.1.1` maintains full CommonJS `require('uuid').v4` parity. Adding an exact override resolves the advisory, and rigorous regression tests (`__tests__/admin/excel-workbook-export.test.ts` and runtime conditional formatting XML generation) confirmed 100% functionality.

---

## 4. Verification Evidence & Quality Gates

### 1. Complete Test Suite
```bash
npm test
```
- **Test Files:** 102 passed | 2 skipped (104 files)
- **Tests:** **1,490 passed | 11 skipped | 15 todo (0 failed)**
- **Duration:** 7.46s

### 2. Targeted Critical Workflows Verified
- **Authentication & MFA:** `__tests__/auth/session-secret.test.ts`, `__tests__/auth/trusted-origin.test.ts`, `__tests__/auth/admin-mfa-regression.test.ts` — PASSED.
- **Registration (Individual & Team):** `__tests__/registration/fee-and-email-invariants.test.ts`, `__tests__/registration/team-member-accommodation.test.ts`, `__tests__/registration/master-registration-accommodation-history.test.ts` — PASSED.
- **Accommodation & Inventory:** `__tests__/accommodation/floor-inventory.test.ts`, `__tests__/accommodation/schema-foundation.test.ts`, `__tests__/accommodation/safe-accommodation-only-e2e-verification.test.ts` — PASSED.
- **PayU Payments & Settlement:** `__tests__/payments/p0-fixes.test.ts`, `__tests__/payments/integrity.test.ts`, `__tests__/payments/canonical-callback-url.test.ts`, `__tests__/payments/payu-environment.test.ts` — PASSED.
- **Admin Exports & ExcelJS:** `__tests__/admin/excel-workbook-export.test.ts` (19 tests), `__tests__/admin/admin-csv-export.test.ts` (17 tests), `__tests__/admin/export-modes-and-counts.test.ts` (19 tests) — ALL PASSED.
- **Receipt PDF Generation:** Verified in `safe-accommodation-only-e2e-verification.test.ts` — PASSED.

### 3. Production Build
```bash
npm run build
```
- **Engine:** Next.js 16.4.3 (webpack)
- **Rulebook Sync:** 49/49 individual event PDFs generated and synced cleanly.
- **Compilation:** Compiled successfully in 30.0s.
- **TypeScript:** Type-checking passed cleanly in 23.5s.
- **Routes Generated:** 48/48 static & dynamic routes collected and optimized.
- **Exit Code:** `0` (Success).

### 4. Dependency Consistency & Audit
```bash
npm audit
```
- **Output:** `found 0 vulnerabilities`
- **Metadata:**
  ```json
  {"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}}
  ```

### 5. Node.js Runtime Compatibility Analysis
- **Local Dev Environment:** Node.js `v26.5.0` (all 1,490 tests and production build passed).
- **CI Configuration:** `.github/workflows/ci.yml:27` explicitly specifies `node-version: 22`.
- **Package Engine Constraints:**
  - `next@16.4.3`: `node: ">=20.9.0"`
  - `undici@7.30.1`: `node: ">=20.18.1"`
  - `shadcn@4.22.1`: `node: ">=20.18.1"`
  - `vite@8.3.5`: `node: "^20.19.0 || >=22.12.0"`
  - `vitest@4.1.12`: `node: "^20.0.0 || ^22.0.0 || >=24.0.0"`
  - `exceljs@4.4.0`: `node: ">=8.3.0"`
- **Production Hosting Requirement:** Node.js 22 LTS or Node.js 20 (>=20.18.1). Because hosting environment dashboard configurations cannot be queried from local git files, the actual Node.js version in Hostinger/Vercel settings must be manually verified to ensure it is set to Node.js 20.18.1+ or Node.js 22 LTS prior to production deployment.

### 6. Code Quality & Linter Results
```bash
npm run lint
```
- **Exit Code:** `1`
- **Findings:** 51 pre-existing errors and 892 warnings.
- **Root Cause:** All 51 errors are pre-existing formatting issues in non-security files (`components/sponsors/SponsorsView.tsx` unescaped apostrophes, `run-tests.js` CJS require, `lib/supabase/batch.ts` prefer-const).
- **Regression Impact:** Zero lint errors were introduced by the security dependency update. All modified security files (`package.json`, `package-lock.json`) pass lint and type checking with 0 errors.

---

## 5. Protected Assets & Policy Adherence

1. **Production Branch Unmodified:** The live `main` branch was never checked out, modified, committed to, or pushed.
2. **Local Work Preserved:** Pre-existing uncommitted work in `lib/auth/send-otp-email.ts`, `lib/send-registration-email.ts`, `lib/email/`, and accommodation E2E test files was preserved completely.
3. **Investigation of `__tests__/email/test-transport.test.ts`:**
   - **Origin:** Created during the prior isolated local E2E test suite (Task 7 in history) to verify Mailpit SMTP isolation and test recipient safety guards.
   - **Status in Git:** Untracked (`?? __tests__/email/test-transport.test.ts`).
   - **Reason for Modification:** During baseline build validation (`next build --webpack`), Next.js executed TypeScript compilation over all test files and identified two type-checker errors:
     1. `TS2540: Cannot assign to 'NODE_ENV' because it is a read-only property` — resolved by standard cast `const setNodeEnv = (val: string) => { (process.env as Record<string, string | undefined>).NODE_ENV = val; };`, identical to `__tests__/email/recipient-safeguard.test.ts`.
     2. `TS2353: Object literal may only specify known properties` — test payload used `{ duration, checkIn, checkOut }` instead of the typed `AccommodationEmailDetails` interface (`{ participantName, dates, amount }`).
   - **Verification:** All 12 test cases in `__tests__/email/test-transport.test.ts` pass cleanly under `vitest run`. It is completely separate from the Hostinger security updates, remains untracked, and is fully preserved.
4. **Landing Page Lock Invariant:** None of the 11 locked files (`app/page.tsx`, `components/home/*`, `components/ui/ScrollEngine3D.tsx`, `components/ui/DomeGallery.tsx`, `components/ui/Preloader.tsx`, `components/ui/Navbar.tsx`, `components/ui/Footer.tsx`) were modified or touched.
5. **No Secrets Exposed:** No credentials, API keys, or environment files were touched or printed.

---

## 6. Safe Deployment & Rollback Plan

When authorized to deploy these remediations to production:

### Step 1: Pre-Deployment Review
```powershell
git status --short
git diff package.json
```
Verify that only `package.json` and `package-lock.json` are included in the security commit.

### Step 2: Merge & Build Verification on Feature Branch
1. Commit the dependency updates to `security/hostinger-vulnerabilities-2026`:
   ```powershell
   git add package.json package-lock.json
   git commit -m "security: remediate 23 hostinger dependency vulnerabilities (next 16.4.3, uuid 11.1.1, vite 8.3.5)"
   ```
2. Pull latest remote changes before any push:
   ```powershell
   git pull --rebase origin <target-branch>
   ```

### Step 3: Deployment Verification in Hostinger
1. Trigger build and deployment on Hostinger / Vercel.
2. Re-run Hostinger Dependency Vulnerability Scanner.
3. Confirm Hostinger scanner displays 0 active vulnerabilities.
4. Verify registration, payment callback, admin dashboard, and PDF receipt download on the live site.

### Step 4: Instant Rollback Plan
If any unforeseen production anomaly occurs:
1. Revert the commit:
   ```powershell
   git revert HEAD
   git push origin <branch>
   ```
2. Hostinger / Vercel redeploys previous bundle within 2 minutes.
