# Indefinite Client Entitlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the existing sole owner an explicit, revocable, no-payment CLIENT entitlement without changing finite subscriptions or granting administrators a bypass.

**Architecture:** Add a versioned authority table for explicit indefinite client grants.  A shared authority query treats an active finite interval or an unretracted indefinite grant as entitled, while identity activity and the CLIENT role remain independent mandatory conditions.  The existing owner-only offline bootstrap path gains an audited, exact-email workflow; public role mutation remains unchanged.

**Tech Stack:** Node.js ESM, SQLite (`node:sqlite`), Node test runner, React/Vitest frontend contract checks.

**Spec:** `/home/jhonsnake/.hermes/cache/scratch/johngym-indefinite-codex-brief.txt`

## Global Constraints

- No production, account, deployment, raw-SQL operator workaround, fake expiry, or session forging.
- Existing finite intervals retain their semantics and responses.
- Grants are explicit, revocable, audited, owner-only offline operations; no email or UID is embedded in product logic.
- The account must be active and retain CLIENT for access.
- Schema snapshots/export stay compatible and reject newer schemas as before.

## Review Focus

- Revoked indefinite grant must deny every personal/trainer/commercial read even if the actor is an admin.
- Disabled/deleted identity or removed CLIENT role must deny despite an active grant.
- A finite subscription response and expiry timing must remain unchanged.
- An email attachment must reject malformed and duplicate normalized addresses without partially provisioning.
- The operator receipt must reveal only audited identifiers/state and be safely replayable.

### Task 1: Authority schema and entitlement read model

**Files:** `api/authority-store.js`, `api/authority-service.js`, `api/authority-training.js`, authority store/service/training tests.

- [ ] Write focused failing tests for indefinite authorization, revocation, disabled identity, removed CLIENT role, trainer relations, commercial lists, and unchanged finite interval behavior.
- [ ] Run those tests and verify they fail because no indefinite entitlement exists.
- [ ] Add schema-v6 migration, a shared active-entitlement query, and aggregate/version/audit handling.
- [ ] Run focused tests and verify they pass.

### Task 2: Audited owner provisioning

**Files:** `api/identity-authority.js`, `api/scripts/bootstrap-operational-role.mjs`, service/script tests.

- [ ] Write failing tests for exact email format/uniqueness, all three roles, explicit entitlement, readback/audit, replay and sole-owner preservation.
- [ ] Run the script tests and verify failure before the workflow exists.
- [ ] Implement a transactional safe-offline identity attachment plus owner-only bootstrap grant and JSON receipt.
- [ ] Run focused tests and verify they pass.

### Task 3: Contracts, UI safety, backup and operations documentation

**Files:** `api/openapi.yaml`, `frontend/src/lib/access-gate.*`, `OPERATIONS.md`, tests and relevant docs.

- [ ] Write/extend a contract test proving indefinite entitlement has no bogus expiry and validates at the browser gate.
- [ ] Run it RED, then update contract/UI validation and compatibility tests GREEN.
- [ ] Document backup-before-operation, audited command/readback, rollback implications, source files, build/test recipe, and production-not-touched boundary.

### Task 4: Verification and commit

- [ ] Run focused authority, operator, snapshot and frontend tests; run full API and frontend relevant suites/build.
- [ ] Independently search for remaining finite-only entitlement checks and forbidden hardcoding.
- [ ] Inspect `git diff`/`git status` and commit the scoped conventional change.
