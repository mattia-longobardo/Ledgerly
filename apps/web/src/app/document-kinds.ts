// src/app/document-kinds.ts — the kinds of document this instance reads (extension point E1, rule
// M8). Importing this file registers each kind's reader: `imports` must not import the modules that
// own the data, so the one place that knows both is here. Every entry that can read a document by
// its kind imports it: `/api/v1` (the upload) and the worker (the reading, the sweep).
import "server-only";
import { registerDocumentKind } from "@ledgerly/domain/imports";
import { PAYSLIP_DOCUMENT } from "@ledgerly/domain/payroll";

registerDocumentKind(PAYSLIP_DOCUMENT);
