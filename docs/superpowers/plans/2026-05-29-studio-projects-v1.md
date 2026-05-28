# Studio Projects V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build real Studio projects v1 so PDFs can be organized into persisted project groups.

**Architecture:** Add a small `studio_projects` table and a nullable `project_id` on `studio_documents`. Expose project CRUD and document assignment through Tauri commands, then wire React store and Studio sidebar UI onto the same grouping helpers introduced in PR #35.

**Tech Stack:** Tauri Rust backend with `sqlx` SQLite, React + Zustand frontend, Vitest unit tests, Playwright E2E.

---

### Task 1: Backend Persistence And Commands

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [x] **Step 1: Write failing Rust tests**

Add tests for:
- migrations create `studio_projects` and `studio_documents.project_id`
- creating/listing/renaming/deleting a project
- assigning a Studio document to a project and clearing assignment when the project is deleted

Run: `cargo test --manifest-path src-tauri/Cargo.toml studio_project`
Expected: FAIL because functions/columns do not exist.

- [x] **Step 2: Implement backend schema and records**

Add:
- `StudioProject` struct
- migration for `studio_projects`
- nullable `project_id` column on `studio_documents`
- `list_studio_project_records`
- `create_studio_project_record`
- `rename_studio_project_record`
- `delete_studio_project_record`
- `update_studio_document_project_record`

- [x] **Step 3: Expose Tauri commands**

Add commands:
- `list_studio_projects`
- `create_studio_project`
- `rename_studio_project`
- `delete_studio_project`
- `update_studio_document_project`

Run: `cargo test --manifest-path src-tauri/Cargo.toml studio_project`
Expected: PASS.

### Task 2: Frontend Data Layer

**Files:**
- Modify: `src/lib/studio.ts`
- Modify: `src/lib/studioDocuments.ts`
- Modify: `src/lib/studioDocuments.test.ts`
- Modify: `src/store/useAppStore.ts`

- [x] **Step 1: Write failing unit tests**

Update `groupStudioDocumentsByProject` tests so empty persisted projects render and assigned documents use `StudioProject` data.

Run: `npx vitest run src/lib/studioDocuments.test.ts`
Expected: FAIL until grouping accepts persisted projects.

- [x] **Step 2: Add TypeScript APIs and store actions**

Add frontend wrappers and Zustand state/actions for project list, CRUD, and document assignment.

Run: `npx vitest run src/lib/studioDocuments.test.ts`
Expected: PASS.

### Task 3: Studio Sidebar UI

**Files:**
- Modify: `src/components/StudioSidebar.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `tests/e2e/studio.e2e.ts`

- [x] **Step 1: Write failing E2E**

Add a Playwright test for:
- import PDF
- create project from Studio sidebar
- move imported document to that project
- verify sidebar shows document under project

Run: `npx playwright test tests/e2e/studio.e2e.ts -g "organizes Studio documents into projects"`
Expected: FAIL until UI/actions exist.

- [x] **Step 2: Implement UI**

Add:
- New project button in Studio sidebar
- project rename/delete menu
- document context menu items to move to Inbox or existing project
- project grouping fed from real `studioProjects`

Run: `npx playwright test tests/e2e/studio.e2e.ts -g "organizes Studio documents into projects|imports PDF and opens Studio split view"`
Expected: PASS.

### Task 4: Verification And PR Update

**Files:**
- No new production files expected.

- [x] **Step 1: Run full validation**

Run:
- `git diff --check`
- `npm run check`
- Browser smoke on `http://127.0.0.1:5174/`
- Visual Playwright smoke for Studio Projects sidebar

- [x] **Step 2: Commit, push, update PR #35**

Commit on `codex/studio-projects-foundation`, push, and update PR #35 body with validation evidence.
