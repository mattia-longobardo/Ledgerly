# Ledgerly documentation

## Guides

Start here. These guides describe Ledgerly as it is today.

| Document                           | Contents                                                          |
| ---------------------------------- | ----------------------------------------------------------------- |
| [Features](features.md)            | Each section of the app and the rules behind its numbers.         |
| [API and MCP](api.md)              | OAuth2, the REST API, the MCP server, the Paperless import.       |
| [Development](development.md)      | Setup, code layout, code rules, tests.                            |
| [Operations](operations.md)        | Containers, jobs, deploy, configuration, backups, admin tasks.    |
| [Release checklist](RELEASE.md)    | A release step by step, with checks and rollback.                 |
| [API changelog](api-changelog.md)  | Changes to `/api/v1` and to the MCP tools.                        |

## Design records

These documents record decisions at the time they were made. Some parts are replaced by later
work; each document says what replaces it. Most are in Italian.

| Document                                                      | Topic                                                    |
| ------------------------------------------------------------- | -------------------------------------------------------- |
| [auth-design.md](auth-design.md)                              | Sign-in, 2FA, OAuth2, MCP, Paperless.                    |
| [scheduler.md](scheduler.md)                                  | The sync schedule of the integrations.                   |
| [design/investments.md](design/investments.md)                | The Investments section (eToro, Binance).                |
| [design/investments-ux.md](design/investments-ux.md)          | Investments redesign, with mockups.                      |
| [design/funds-ux.md](design/funds-ux.md)                      | Funds redesign, with mockups.                            |
| `design/investments-*.md`                                     | The phases of the Investments work, with rollback SQL.   |

## Runbooks

| Document                                                                     | Use                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------- |
| [runbooks/oauth-paperless-migration.md](runbooks/oauth-paperless-migration.md) | Move the Paperless import to OAuth2.              |
| [runbooks/security-review-fixes.md](runbooks/security-review-fixes.md)       | Apply the fixes of the security review.           |
