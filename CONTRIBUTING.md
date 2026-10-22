# Contributing

This is an early extraction maintained by Aybo00. The public API is not yet stable. Open an issue for a reproducible failure or propose a focused change after the repository is public. Do not submit private conversations, credentials, real account exports or proprietary source.

Use Node.js 24+ and pnpm 11.25.0:

```sh
pnpm install --frozen-lockfile
pnpm check
```

Keep new behavior within the documented capability boundary. A report parser must not gain implicit network access; a display event must not trigger tools. For changes to asynchronous controllers, include a regression that exercises the real ordering/failure case. Use small synthetic fixtures. Explain behavior changes and test results in the pull request.

There are no contribution rewards, acceptance guarantees or service-level commitments. Release cadence will follow actual maintenance capacity. Contributions are made under the repository's MIT license; do not copy code without preserving the applicable notices and permission.
