// Users and settings · labels and the categories of a source (rewrite plan R2, 05-refactor.md §5.5;
// spec §7.2; rewrite plan N3.1).
import { z } from "zod";
import { defineRoute } from "../route";
import { hexColor, id } from "../primitives";
import { CATEGORY_ID, categoryType, TAXONOMY_ERRORS } from "./shared";

const label = z.object({ id: id(), name: z.string(), color: hexColor().nullable(), usage: z.number().int() });
const LABEL_ID = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";
const labelInput = z
  .object({ name: z.string().trim().min(1).max(60), color: hexColor().nullable() })
  .strict();

export const listLabels = defineRoute({
  id: "list_labels",
  method: "GET",
  path: "/labels",
  scope: "read",
  capability: "categories",
  summary: "The person's labels, with how many movements carry each.",
  actions: [],
  response: z.object({ labels: z.array(label) }),
  errors: [],
  mcp: {
    title: "Labels",
    description: "The user's labels as GET /api/v1/labels, with how many movements carry each.",
  },
  example: { response: { labels: [{ id: LABEL_ID, name: "Holiday", color: "#3366cc", usage: 3 }] } },
});

export const createLabel = defineRoute({
  id: "create_label",
  method: "POST",
  path: "/labels",
  scope: "write",
  capability: "categories",
  summary: "Creates a label.",
  actions: ["createLabelAction"],
  body: labelInput,
  response: label,
  status: 201,
  errors: TAXONOMY_ERRORS,
  example: {
    body: { name: "Holiday", color: "#3366cc" },
    response: { id: LABEL_ID, name: "Holiday", color: "#3366cc", usage: 0 },
  },
});

export const updateLabel = defineRoute({
  id: "update_label",
  method: "PATCH",
  path: "/labels/{id}",
  scope: "write",
  capability: "categories",
  summary: "Changes a label's name or colour.",
  actions: ["saveLabelAction"],
  params: z.object({ id: id() }),
  body: labelInput,
  response: label,
  errors: TAXONOMY_ERRORS,
  example: {
    params: { id: LABEL_ID },
    body: { name: "Trips", color: null },
    response: { id: LABEL_ID, name: "Trips", color: null, usage: 3 },
  },
});

export const deleteLabel = defineRoute({
  id: "delete_label",
  method: "DELETE",
  path: "/labels/{id}",
  scope: "write",
  capability: "categories",
  summary: "Deletes a label; the movements keep everything else.",
  actions: ["deleteLabelAction"],
  params: z.object({ id: id() }),
  response: null,
  status: 204,
  errors: TAXONOMY_ERRORS,
  example: { params: { id: LABEL_ID } },
});

const sourceCategory = z.object({
  id: id(),
  /** The source: a provider of the core or `plugin:<id>`. */
  provider: z.string(),
  name: z.string(),
  groupName: z.string().nullable(),
  choice: z.enum(["added", "matched"]),
  /** Where its movements count; null only until the next reading brings it back. */
  categoryId: id().nullable(),
  isNew: z.boolean(),
  count: z.number().int(),
});
const SOURCE_CATEGORY_ID = "6f5e4d3c-2b1a-4098-8f7e-6d5c4b3a2918";

export const listSourceCategories = defineRoute({
  id: "list_source_categories",
  method: "GET",
  path: "/source-categories",
  scope: "read",
  capability: "categories",
  summary: "Every category the person's sources bring, and where its movements count here.",
  actions: [],
  response: z.object({ sourceCategories: z.array(sourceCategory) }),
  errors: [],
  example: {
    response: {
      sourceCategories: [
        {
          id: SOURCE_CATEGORY_ID,
          provider: "plugin:enablebanking",
          name: "Supermarket",
          groupName: null,
          choice: "matched",
          categoryId: CATEGORY_ID,
          isNew: false,
          count: 7,
        },
      ],
    },
  },
});

export const setSourceCategory = defineRoute({
  id: "set_source_category",
  method: "PUT",
  path: "/source-categories/{id}",
  scope: "write",
  capability: "categories",
  summary: "Sets where a source's category counts: a category of the person, or its own (`null`).",
  actions: ["setSourceCategoryAction"],
  params: z.object({ id: id() }),
  body: z.object({ categoryId: id().nullable() }).strict(),
  response: z.object({
    name: z.string(),
    categoryName: z.string(),
    choice: z.enum(["added", "matched"]),
    macro: z.object({ from: categoryType, to: categoryType }).nullable(),
    moved: z.number().int(),
    undoId: id().nullable(),
  }),
  errors: ["invalid", "not_found"],
  example: {
    params: { id: SOURCE_CATEGORY_ID },
    body: { categoryId: CATEGORY_ID },
    response: {
      name: "Supermarket",
      categoryName: "Groceries",
      choice: "matched",
      macro: null,
      moved: 7,
      undoId: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a",
    },
  },
});

export const undoSourceCategory = defineRoute({
  id: "undo_source_category",
  method: "POST",
  path: "/source-categories/undo/{undoId}",
  scope: "write",
  capability: "categories",
  summary: "Undoes a change of where a source's category counts.",
  actions: ["undoSourceCategoryAction"],
  params: z.object({ undoId: id() }),
  response: null,
  status: 204,
  errors: ["invalid", "not_found"],
  example: { params: { undoId: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a" } },
});

export const keepSourceCategory = defineRoute({
  id: "keep_source_category",
  method: "POST",
  path: "/source-categories/{id}/keep",
  scope: "write",
  capability: "categories",
  summary: "«Keep as it is» on a new category of a source: it stays added and is no longer new.",
  actions: ["keepSourceCategoryAction"],
  params: z.object({ id: id() }),
  response: null,
  status: 204,
  errors: ["invalid"],
  example: { params: { id: SOURCE_CATEGORY_ID } },
});
