# Local Workspace Kit

Small, inspectable TypeScript building blocks for local-first workspaces: deterministic content reports, bounded source comparisons, and asynchronous draft, paging and text-stream state.

This is an early standalone extraction from a privately developed Windows assistant project. It is a library and offline CLI, with synthetic examples and regression tests. It is not a complete desktop agent. External adoption has not yet been established, and the API can change before 1.0.

## Try it

Requirements: Node.js 24 or newer and pnpm 11.25.0. Dependency installation needs a network connection; the examples themselves run offline.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm demo
node bin/local-workspace.mjs source-diff examples/source-diff.json
node examples/workspace.mjs
```

The package is marked `private: true` to prevent accidental npm publication. The source can still be published on GitHub under MIT. There is no npm release at this stage.

## What works now

| Component | Behavior | Boundary |
| --- | --- | --- |
| Content importer | Parses pasted TSV, quoted cells, Turkish headers, dates and production states | At most 200 rows, 30 columns, 1,000 characters per cell and 64,000 characters per table |
| Reports and work queue | Counts known/unknown publication states; identifies deadlines and the next production stage | Explicit evaluation date; old data is flagged; suggestions do not run actions |
| Content comparison | Compares two ordered snapshots and identifies additions, missing entries, changed fields and ambiguous names | Matching workspace and normalized source label required; absence is not proof of deletion |
| Source comparison | Compares two supplied readable-text captures of the same HTTPS URL | No fetching; same conversation and chronological order; bounded diff computation |
| `DraftEditor` | Coalesces edits, serializes writes, checks save acknowledgments, preserves newer typing and awaits acknowledgment before close | Caller supplies persistence and revision conflict handling |
| `ArchivePager` | Maintains one visible page and ignores obsolete reads after scope changes | Caller bounds, authorizes and fetches each page |
| Text stream controllers | Validate generations, ordering, frame sizes, terminal results and clean completion | Presentation state only; no provider, server, model or authentication |

Report headers, status labels and table aliases are Turkish-first. README and CLI help are English. A general locale adapter is planned rather than claimed as complete.

## Library examples

Build first; then import the ESM entry point:

```js
import { importContent, contentReport, contentWorkplan } from './dist/index.js';

const snapshot = importContent({
  sourceLabel: 'Editorial board',
  observedOn: '2026-10-08',
  table: 'İçerik\tTeslim tarihi\tYayınlandı\nExample\t2026-10-09\thayır'
});
const report = contentReport(snapshot, '2026-10-08');
const queue = contentWorkplan(snapshot, '2026-10-08');
console.log(report.counts, queue);
```

See [the workspace example](examples/workspace.mjs) for a memory-only draft adapter and archive paging. The adapter must atomically compare `expectedRevision`, persist a successful write, and return the same workspace, conversation and text with revision incremented by one. A failed or mismatched acknowledgment blocks automatic writes; retry/reload is explicit. A memory adapter demonstrates the contract, not crash-safe storage.

## CLI

```sh
node bin/local-workspace.mjs report examples/content.tsv --observed-on 2026-10-08 --as-of 2026-10-08
node bin/local-workspace.mjs plan examples/content.tsv --observed-on 2026-10-08 --as-of 2026-10-08 --text
node bin/local-workspace.mjs source-diff examples/source-diff.json
```

`report` and `plan` emit JSON by default, or plain text with `--text`. `source-diff` consumes exactly `{before, after}` captures; [the supplied JSON](examples/source-diff.json) shows the shape. `content-diff` accepts `{before, after}` records with `id`, `projectId`, `createdAt` and `snapshot`; see [the contracts](docs/CONTRACTS.md).

Only the explicitly named regular file is read, with a 128,000-byte limit and strict UTF-8 decoding. The narrower table/capture limits still apply. Results go to stdout and failures to stderr. Source URLs identify stored captures and are never opened by this CLI.

## Development

`pnpm check` runs type checking, the ESM/declaration build, and the Node test suite. Tests use fixtures and in-memory adapters. They include stale reads, late acknowledgments, explicit save recovery, close races, partial UTF-8 frames, cancellation, diff limits, unknown cells and CLI failures. No model or paid account is required. Tests run one file at a time.

The prepared [CI workflow](.github/workflows/ci.yml) runs the same checks on Windows and Linux. A workflow file is not evidence that a remote CI run has passed; inspect actual runs after publication.

See [architecture](docs/ARCHITECTURE.md), [contracts](docs/CONTRACTS.md), [roadmap](ROADMAP.md) and [contributing](CONTRIBUTING.md).

## Scope and security

The library does not execute table cells, model instructions or source text. It does not implement encryption, database durability, authentication, remote browsing, OS control, game detection or model unloading. Correlation IDs and workspace IDs are not access control. The integrating application is responsible for these properties. Treat all returned text as data when rendering it.

These bounded utilities do not establish factual truth in source text or solve general language-model accuracy. No guarantee is made about game FPS, all-device memory use or crash recovery. See [security boundaries](SECURITY.md).

MIT; see [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).
