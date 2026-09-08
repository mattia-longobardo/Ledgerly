# Paperless migration reconciliation

Run at 2026-09-06T10:12:04.206Z.

- Legacy payslips seen: 12
- Migrated: 12
- Reused (already migrated): 0
- Skipped, not verified: 0
- Failed: 0

| Legacy id | Month | 13th | Result | Import | Record | Legacy net | New net |
|---|---|---|---|---|---|---|---|
| 152 | 2025-10-01 | no | migrated | 01a07634-2219-7a2f-9bcf-e15a7e4429fb | 01a07634-221d-7ab3-ab70-f4a11e956dac | 1478.00 | 1478.00 |
| 154 | 2025-11-01 | no | migrated | 01a07634-235e-70f2-adbb-57ddc5f90a11 | 01a07634-235f-7aa7-b9c1-5172a9c16cfb | 2311.00 | 2311.00 |
| 156 | 2025-12-01 | no | migrated | 01a07634-23b0-7f67-aeb3-09b4bc654451 | 01a07634-23b2-7ca8-a8c9-4433d5becb4e | 2356.00 | 2356.00 |
| 153 | 2025-12-01 | yes | migrated | 01a07634-2405-7807-a590-81859d33534a | 01a07634-2406-7f1b-b363-0bc4d6571978 | 497.00 | 497.00 |
| 155 | 2026-01-01 | no | migrated | 01a07634-2454-7cae-a31c-c58e76c7102d | 01a07634-2456-7a35-8f09-3436e8d7302d | 2137.00 | 2137.00 |
| 151 | 2026-02-01 | no | migrated | 01a07634-24a5-7a89-be09-d00dd1fcf667 | 01a07634-24a7-7d6a-941e-626a800892b1 | 2051.00 | 2051.00 |
| 150 | 2026-03-01 | no | migrated | 01a07634-24dd-7912-a8ec-23b6f6f0e7bf | 01a07634-24df-706f-b40b-5897deaf2082 | 2072.00 | 2072.00 |
| 149 | 2026-04-01 | no | migrated | 01a07634-2513-7c74-b49c-9bb2e381e3d7 | 01a07634-2515-7340-9e07-7af1f92cf89e | 2065.00 | 2065.00 |
| 148 | 2026-05-01 | no | migrated | 01a07634-254a-75eb-8e38-112f7bd43666 | 01a07634-254b-7a88-863e-e107357186a5 | 2272.00 | 2272.00 |
| 147 | 2026-06-01 | no | migrated | 01a07634-257e-779c-8316-dc4fe5220189 | 01a07634-257f-7f37-9c03-a94fb6ff5a69 | 2080.00 | 2080.00 |
| 146 | 2026-07-01 | no | migrated | 01a07634-25b6-7628-8b5d-bbf7a4a41637 | 01a07634-25b7-7ada-895e-af62c051ec51 | 2698.00 | 2698.00 |
| 145 | 2026-08-01 | no | migrated | 01a07634-25eb-7340-a067-fffff37f21ec | 01a07634-25ec-76a9-a911-24ac5d0217ab | 2093.00 | 2093.00 |

Run `npm run migrate:paperless:validate` next; it diffs every migrated record against its legacy row and exits non-zero on any mismatch.
