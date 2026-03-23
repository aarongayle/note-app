import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

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
    scrollHeight: v.optional(v.number()),
    /** View zoom (1 = 100%), clamped client-side to ~0.5–3 */
    zoom: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_clientId", ["userId", "clientId"]),
});
