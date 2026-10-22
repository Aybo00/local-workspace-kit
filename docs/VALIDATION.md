# Local validation record

Release candidate 0.1.0, checked 23 October 2026 on Windows with Node.js 24.19.0.

- Type check: passed.
- ESM and type-declaration build: passed.
- Node test suite: 88 passed, 0 failed, 0 skipped.
- Supplied draft/paging example and text work-plan CLI example: passed.
- No model, GPU, paid API, account, network fetch or dependency download was used for these checks.

The finite local check reused the maintainer's already installed versions of the declared dependencies. A fresh dependency installation, Linux execution and remote CI have not yet been verified. The lockfile contains the selected dependency graph only. The CI workflow is prepared for both Windows and Linux; no remote badge or successful run is claimed.

Tests cover these components and synthetic failure cases. They are not acceptance tests for a desktop agent, storage security, game performance or general model-answer quality.
