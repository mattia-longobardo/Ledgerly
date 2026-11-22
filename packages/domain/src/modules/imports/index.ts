// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { DOCUMENT_KINDS, IN_FLIGHT, MAX_DOCUMENT_BYTES } from "./rules";
export { checkOriginalLink, originalLinkFor } from "./original-link";
export type { LinkCheck } from "./original-link";
export { ImportError, expireOriginals, listDocuments, readOriginal, stuckDocuments } from "./service";
export {
  documentReaderOf,
  readDocument,
  readKinds,
  registerDocumentKind,
  uploadDocuments,
} from "./service/reading";
export type { DocumentReader, Reading } from "./service/reading";
