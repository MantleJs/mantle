# Security Policy

## Reporting a vulnerability

**Please don't open a public issue for a security problem.** Report it privately through GitHub instead:

1. Go to the [Security tab](https://github.com/MantleJs/mantle/security) of this repository.
2. Click **Report a vulnerability** and fill in the advisory form.

Include the affected package(s) and version(s), what an attacker can do, and the steps or a minimal app that
reproduces it. Only the maintainers can see the report.

You can expect an acknowledgement within 3 business days. We'll keep you updated as we investigate, agree on a
disclosure date with you, and credit you in the advisory unless you'd rather not be named.

## Supported versions

Mantle is pre-1.0 and every package is released in lockstep, so fixes land in the latest release only.

| Version                                                 | Supported                          |
| ------------------------------------------------------- | ---------------------------------- |
| Latest `0.x` release (npm `latest` tag)                 | ✅                                 |
| Latest `-experimental` release (npm `experimental` tag) | ✅                                 |
| Older releases                                          | ❌ — upgrade to the latest release |

## Scope

In scope: every `@mantlejs/*` package and `create-mantlejs` published from this repository, including code
they generate (for example a project scaffolded by `create-mantlejs`).

Out of scope: the example apps under `examples/` (they aren't published or meant for production), the
mantlejs.com website content, and vulnerabilities in third-party dependencies that Mantle doesn't make
exploitable — report those upstream. If you're unsure, report it anyway.
