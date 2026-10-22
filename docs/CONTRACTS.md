# Integration contracts

## Reports

`importContent(input, importedAt?)` accepts `{sourceLabel, observedOn, table}`. `observedOn` and the `asOf` argument to report/work-queue functions are civil dates (`YYYY-MM-DD`), not elapsed local hours. The optional import timestamp defaults to the current ISO timestamp. Validate externally supplied snapshots with `contentSnapshotSchema` before passing them to typed report functions; TypeScript types are not runtime validation.

Supported title headers include `İçerik` and `Oyun`; `Oyun` is a content title alias, not a process/game detector. Other supported headers include `Teslim tarihi`, `Çıkış tarihi`, `Yayınlandı`, `Key`, `Metin`, `Ses`, `Kurgu` and `Kapak`. See the TSV example. Missing stage/publication data remains unknown, and duplicate aliases are rejected. Formula-looking cells are data, never executable spreadsheet formulas.

`compareContentReports(before, after)` reads records shaped as `{id, projectId, createdAt, snapshot}`; an additional saved `report` field is ignored. IDs are UUIDs, `projectId` is a UUID or null, and timestamps are ISO datetime strings. The snapshots must share project and normalized source label and be ordered by observation/import time. The comparison does not infer deletion from absence or resolve duplicate names arbitrarily.

`compareSources(before, after)` uses `{conversationId, source}`. `source` has `id`, `url`, `title`, `text`, `readAt`, `truncated`. IDs must be UUIDs and `readAt` ISO. URL identity preserves path, query, case and encoding; fragments are ignored. It does not authorize or fetch any URL. Captures over 400 lines use a bounded changed-region view and do not claim full added/removed line counts. Normal diffs retain at most 12 excerpts of at most 700 characters each. Readable text is limited to 40,000 characters per capture.

## Draft storage adapter

`draft(projectId)` returns a detached `ComposerDraft` with the requested project, nullable conversation, text, nonnegative safe-integer revision and nullable timestamp string. `saveDraft` must atomically compare `expectedRevision`, store the exact supplied conversation/text in the same project and return revision `expectedRevision + 1`. Conflicts or failed persistence reject the promise. Do not return success before the durability level promised by your application has been reached.

The editor checks record shape/scope and matching acknowledgments. It cannot independently inspect the database, authenticate callers or establish disk durability. It retains unsaved edits on failure and does not perform automatic conflict overwrite. `retry()` and discard/reload decisions must be deliberate application actions. Call `prepareClose()` before destroying the view and `stop()` when disposing it. `stop()` clears the debounce timer; it is not a substitute for flushing.

## Paging and streams

`ArchivePager` requires the caller to bound and authorize fetched pages. It stores only the current page; the page size itself is not enforced by this generic controller. Scope and generation checks prevent obsolete UI responses from replacing a newer selection, not unauthorized database reads.

Text stream generations/order/frame limits reject inconsistent presentation state. The owner-framing decoder takes UTF-8 byte chunks, returns display events, and validates terminal result/clean EOF in `finish()`. An interrupted or poisoned stream must not be saved as a completed answer. IDs correlate a request/conversation and are not credentials. Fixed failure classifications are display messages only: a classification such as `resource-unavailable` is not proof that resource monitoring or model unloading is implemented here.
