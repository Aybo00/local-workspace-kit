# Roadmap and wider vision

This roadmap records intentions, not shipped functionality or promised dates. Items advance only with working code, reviewed boundaries and relevant regression evidence.

## Available in this release candidate

- Offline TSV reporting and a source-referenced content work queue.
- Bounded comparisons of saved reports and readable-text source captures.
- Draft, archive paging and text-stream controllers with synthetic regression coverage.
- An ESM build, type declarations, runnable CLI/examples and a prepared CI workflow.

## Next toolkit improvements

1. Make schema errors and locale support easier to integrate. Add configurable labels and English/Turkish fixtures without silently changing the Turkish-first workflow.
2. Publish stable adapter examples for persistent drafts and paging, with explicit authorization and crash/durability boundaries. Keep storage optional.
3. Expand cross-platform and adversarial-input regression coverage. Track real user-reported failures and document performance limits on reproducible inputs.
4. Review the API and versioning with early integrators. Improve migration guides, issue templates and release automation as actual use develops.

## Longer-term product ambition

The wider privately developed project aims to become a useful personal workspace: persistent, user-controlled context; continuing work across sessions; reusable skills; transparent progress and tool choices; and configurable local or cloud models. We want people to retain control of their data and see which work was completed, interrupted or still needs verification.

The experience should remain practical on a gaming PC. Resource release and interruption handling require real integration tests and game performance measurements; this toolkit does not yet provide those capabilities. Providers, account connections, autonomous tools, messaging, schedules, skills and a polished desktop interface belong to the wider product exploration, not the current public package.

Additional reusable components may be released separately after ownership, privacy, licensing and maintenance scope are reviewed. This is not a commitment to publish the entire private product. Upstream components will retain their own attribution and licenses; an integration is not original authorship of an upstream agent.

The purpose of this first extraction is to give other builders useful code now and maintain it transparently while the larger project continues to develop.
