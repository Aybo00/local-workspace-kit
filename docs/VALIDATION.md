# Validation record

Release candidate 0.1.0, checked 23 October 2026.

## Local Windows check

- Type check and ESM/type-declaration build passed using the maintainer’s existing declared dependencies.
- 88 tests passed, 0 failed, 0 skipped.
- Draft/paging and work-plan CLI examples passed.
- No local model, GPU, paid API or new dependency download was used.

## Clean GitHub runner checks

[Verified run](https://github.com/Aybo00/local-workspace-kit/actions/runs/39872455464) for commit `3bc52a946c5020e4bbfe8560e1632708b972b568`:

| Environment | Frozen dependency install | Type check / build | Tests | Draft/paging example |
| --- | --- | --- | --- | --- |
| Ubuntu 24.04 runner | Passed | Passed | 88 passed, 0 failed | Passed |
| Windows Server 2025 runner | Passed | Passed | 88 passed, 0 failed | Passed |

The first public run stopped during installation because pnpm 11 no longer reads the old build-permission field in package.json. The correction moved the permission to pnpm-workspace.yaml and allows only the pinned esbuild 0.28.2 dependency to run its install script. General script protections remain enabled. No runtime source changed for that correction.

The run above checks the runtime source and configuration. Later documentation-only changes do not alter the tested code. These are component regressions on synthetic data, not acceptance tests for a complete desktop agent, model-answer quality, storage security or game performance. No independent security audit is claimed.
