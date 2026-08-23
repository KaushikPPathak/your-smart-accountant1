# Strategic Code Refactor and Technical Debt Reduction Plan

This plan outlines the systematic cleanup and refactoring of the Smart Accountant codebase to improve performance, maintainability, and clarity while strictly preserving all existing business logic, data models, and local-first architecture.

## Objectives
- Eliminate dead code, unused imports, and duplicate logic.
- Reduce file complexity by extracting utilities and shared patterns.
- Consolidate voucher processing and validation logic.
- Centralize authoritative utilities for dates, currency (paise), and database access.
- Maintain 100% behavioral compatibility with existing features, including AI assistant and local-only mode.

## Proposed Changes

### 1. Discovery & Inventory (Pre-Refactor Audit)
- **Action**: Comprehensive scan of the repository to identify:
  - Files > 300 lines.
  - Potential dead code/unused exports using `ts-prune` or similar analysis.
  - Duplicate type definitions and utility functions.
  - Unused assets and stale Tauri commands.

### 2. Core Utility Consolidation (`src/lib/utils/`)
- **Action**: Create or standardize authoritative modules:
  - `date-utils.ts`: Fiscal year logic, standardized parsing, and display.
  - `currency-utils.ts`: Integer-paise calculations, formatting, and GST rounding.
  - `db-wrappers.ts`: Standardized Dexie transaction and error handling.
- **Goal**: Replace inline logic with these imports across the app.

### 3. Voucher Logic Refactoring (`src/lib/vouchers/`)
- **Action**: Extract shared patterns for Sales, Purchase, Payment, Receipt, and Journal:
  - `voucher-validation.ts`: Common checks (date, party, total balance).
  - `voucher-persistence.ts`: Shared save/update/delete flow logic.
  - `voucher-state.ts`: Standardized form state management hooks.
- **Safety**: Preserve all specific business rules for each voucher type.

### 4. Component & Hook Extraction
- **Action**: Break down files exceeding 300 lines (e.g., large route components):
  - Move presentational sub-components to `src/components/`.
  - Extract complex state logic into `src/hooks/`.
  - Move domain-specific types to `src/types/`.

### 5. Cleanup & Deprecation
- **Action**: Remove confirmed dead code.
- **Action**: Move uncertain code to `_deprecated/` with documentation.
- **Action**: Clean up `src-tauri/` Rust code, removing unused commands.

### 6. Verification & Metrics
- **Action**: Run full TypeScript check (`tsgo`).
- **Action**: Perform manual verification of core flows (Vouchers, Reports, AI, Backups).
- **Deliverable**: Generate a Before/After metrics report (LOC, file count, etc.).

## Technical Details
- **Architecture**: Remains strictly local-first (Dexie/IndexedDB).
- **Monetary Logic**: Strictly integer paise; no floats.
- **Protected Modules**: `planner.ts`, `vector-index.ts`, `local-first.ts`, etc., will not be modified internally.
- **Tauri**: Application identity and executable name remain unchanged.

## Safety Measures
- **No Deletion on Assumption**: Every candidate for deletion must pass a repository-wide reference check.
- **Public API Preservation**: Function signatures, component props, and Tauri interfaces remain unchanged.
- **Incremental Commits**: Changes will be applied in logical batches to ensure stability.

