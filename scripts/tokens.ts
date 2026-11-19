// scripts/tokens.ts — `npm run tokens`: writes packages/design-tokens/tokens.css from its sources.
import { writeFileSync } from "node:fs";
import { tokensCss } from "@ledgerly/design-tokens";

writeFileSync("packages/design-tokens/tokens.css", tokensCss());
