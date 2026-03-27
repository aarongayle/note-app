import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAllowedUser } from "./lib/access";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAllowedUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveUploadedFile = mutation({
  args: {
    storageId: v.id("_storage"),
    name: v.string(),
    contentType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAllowedUser(ctx);
    const existing = await ctx.db
      .query("files")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .unique();
    if (existing !== null) {
      throw new Error("This upload is already registered.");
    }
    return await ctx.db.insert("files", {
      storageId: args.storageId,
      userId,
      name: args.name,
      contentType: args.contentType,
      createdAt: Date.now(),
    });
  },
});

export const listMyFiles = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAllowedUser(ctx);
    return await ctx.db
      .query("files")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

export const getDownloadUrl = query({
  args: { fileId: v.id("files") },
  handler: async (ctx, { fileId }) => {
    const { userId } = await requireAllowedUser(ctx);
    const file = await ctx.db.get(fileId);
    if (file === null || file.userId !== userId) {
      return null;
    }
    const url = await ctx.storage.getUrl(file.storageId);
    return url ?? null;
  },
});

/** Signed URLs for note image/PDF embeds (same ownership rules as single-file download). */
export const getBatchDownloadUrls = query({
  args: { fileIds: v.array(v.id("files")) },
  handler: async (ctx, { fileIds }) => {
    const { userId } = await requireAllowedUser(ctx);
    const out: Record<string, string | null> = {};
    const seen = new Set<string>();
    for (const fileId of fileIds) {
      const key = fileId as string;
      if (seen.has(key)) continue;
      seen.add(key);
      const file = await ctx.db.get(fileId);
      if (file === null || file.userId !== userId) {
        out[key] = null;
        continue;
      }
      out[key] = (await ctx.storage.getUrl(file.storageId)) ?? null;
    }
    return out;
  },
});

export const removeFile = mutation({
  args: { fileId: v.id("files") },
  handler: async (ctx, { fileId }) => {
    const { userId } = await requireAllowedUser(ctx);
    const file = await ctx.db.get(fileId);
    if (file === null || file.userId !== userId) {
      throw new Error("File not found.");
    }
    await ctx.storage.delete(file.storageId);
    await ctx.db.delete(fileId);
  },
});
