import { v } from "convex/values";

export const imageEmbedFieldValidator = v.object({
  id: v.string(),
  fileId: v.id("files"),
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
  rotation: v.number(),
  cropLeft: v.optional(v.number()),
  cropTop: v.optional(v.number()),
  cropRight: v.optional(v.number()),
  cropBottom: v.optional(v.number()),
  skewNwX: v.optional(v.number()),
  skewNwY: v.optional(v.number()),
  skewNeX: v.optional(v.number()),
  skewNeY: v.optional(v.number()),
  skewSeX: v.optional(v.number()),
  skewSeY: v.optional(v.number()),
  skewSwX: v.optional(v.number()),
  skewSwY: v.optional(v.number()),
});
