# Security boundaries

The package is an early release candidate and has not received an independent security audit. The tests are regression evidence, not a security certification.

It does not provide authentication, encryption, database durability, an HTTP server, URL fetching, OS tooling, model hosting or game/resource isolation. Workspace IDs are not authorization. Secure these boundaries in the application adapter. Never render source/report strings as executable HTML or shell commands.

The supplied CLI reads the explicitly named local regular file and emits its report to stdout. Review the contents before sharing a report. Do not use confidential real data in public issues or demonstrations. File path selection and access rights belong to the caller and operating system.

For a suspected vulnerability, use the maintainer's verified private contact route if one is available on the GitHub profile. If none is available, open an issue containing only a request for a private reporting channel, without exploit details, secrets or private data. GitHub private vulnerability reporting is not claimed to be enabled yet.
