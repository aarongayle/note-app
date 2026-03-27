import { v } from "convex/values";

export const imageEmbedFieldValidator = v.object({
  id: v.string(),
  fileId: v.id("files"),
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
  rotation: v.number(),
});
