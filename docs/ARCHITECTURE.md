# Architecture

The toolkit separates deterministic data handling from application capabilities.

```text
explicit TSV / JSON --> validation --> reports / comparisons --> JSON or plain text
application storage --> DraftEditor --> view callbacks
application paging  --> ArchivePager --> current page
application stream  --> cursors / UTF-8 decoder --> transient display state
```

`src/reports` contains bounded, deterministic business rules for a content production workflow: text, audio, editing and cover stages. These rules are domain logic rather than question-specific AI answers. Unknown values remain unknown. Import time is separate from the supplied observation/evaluation dates. Comparisons retain source row references.

`src/renderer` contains UI-framework-independent state controllers. Generations invalidate stale asynchronous reads. Draft writes are serialized and use compare-and-swap revision contracts. New typing is retained while a write is pending. Graceful close freezes edits and waits for a matching storage acknowledgment; acknowledgment durability is supplied by the adapter, not proved by this library.

`src/shared` defines public data contracts and framed presentation messages. `src/core/chat-text-stream.ts` coordinates reset/delta delivery and cancellation with receiver backpressure. No model is embedded. A terminal message is provisional until clean stream completion is checked.

`bin` is a Node-only wrapper for explicit local files. The ESM library does not import the CLI or Node file APIs. Zod is the runtime schema dependency. Build tools and test runners are development dependencies.

The first release intentionally does not export the private application host, provider integrations, credentials, stored conversations, game monitor, resource scheduler, database or deployment configuration. It is not a fork or distribution of a third-party agent. Future adapters must preserve the capability boundary rather than silently enabling tools, networking or retries.
