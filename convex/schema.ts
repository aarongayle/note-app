import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { imageEmbedFieldValidator } from "./noteValidators";

const strokeValidator = v.object({
  points: v.array(v.array(v.number())),
  options: v.object({
    size: v.number(),
    thinning: v.optional(v.number()),
    smoothing: v.optional(v.number()),
    streamline: v.optional(v.number()),
    simulatePressure: v.optional(v.boolean()),
  }),
  color: v.string(),
  opacity: v.optional(v.number()),
});

const textBlockValidator = v.object({
  id: v.string(),
  content: v.string(),
});

const textBoxValidator = v.object({
  id: v.string(),
  x: v.number(),
  y: v.number(),
  width: v.number(),
  content: v.string(),
  rotation: v.optional(v.number()),
});

export default defineSchema({
  ...authTables,
  allowedEmails: defineTable({
    email: v.string(),
    note: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_email", ["email"]),
  files: defineTable({
    storageId: v.id("_storage"),
    userId: v.id("users"),
    name: v.string(),
    contentType: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_storage", ["storageId"]),
  noteItems: defineTable({
    userId: v.id("users"),
    clientId: v.string(),
    itemType: v.union(v.literal("folder"), v.literal("note")),
    name: v.string(),
    parentClientId: v.union(v.null(), v.string()),
    sortIndex: v.number(),
    createdAt: v.number(),
    template: v.optional(v.string()),
    strokes: v.optional(v.array(strokeValidator)),
    textBlocks: v.optional(v.array(textBlockValidator)),
    textBoxes: v.optional(v.array(textBoxValidator)),
    /** Pinned images (drawn above background, below strokes). */
    imageEmbeds: v.optional(v.array(imageEmbedFieldValidator)),
    /** PDF displayed as full-width stacked pages behind ink/text. */
    pdfBackgroundFileId: v.optional(v.id("files")),
    /** Raw EPUB file rendered as fixed-width HTML behind ink/text. */
    epubBackgroundFileId: v.optional(v.id("files")),
    /** Fixed layout width (px) for EPUB content; set at import, never changes. */
    epubContentWidth: v.optional(v.number()),
    /**
     * Body text size (pt) chosen at import; scales rasterized PDF vs note typography (baseline 20).
     */
    importDocFontSizePt: v.optional(v.number()),
    /** EPUB conversion margin (pt); legacy uniform margin for older notes. */
    importEpubMarginPt: v.optional(v.number()),
    /** Per-side EPUB→PDF margins (pt); preferred when present. */
    importEpubMargins: v.optional(
      v.object({
        top: v.number(),
        right: v.number(),
        bottom: v.number(),
        left: v.number(),
      }),
    ),
    scrollHeight: v.optional(v.number()),
    /** View zoom (1 = 100%), clamped client-side to ~0.5–3 */
    zoom: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_clientId", ["userId", "clientId"]),
});
