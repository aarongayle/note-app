import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireAllowedUser } from "./lib/access";

type DbCtx = QueryCtx | MutationCtx;

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

async function getRowByClientId(
  ctx: DbCtx,
  userId: Id<"users">,
  clientId: string,
) {
  return await ctx.db
    .query("noteItems")
    .withIndex("by_user_clientId", (q) =>
      q.eq("userId", userId).eq("clientId", clientId),
    )
    .unique();
}

async function assertParentBelongsToUser(
  ctx: DbCtx,
  userId: Id<"users">,
  parentClientId: string | null,
) {
  if (parentClientId === null) return;
  const parent = await getRowByClientId(ctx, userId, parentClientId);
  if (parent === null || parent.itemType !== "folder") {
    throw new ConvexError("Parent folder not found.");
  }
}

function collectSubtreeConvexIds(
  rows: Array<{ _id: Id<"noteItems">; clientId: string; parentClientId: string | null }>,
  rootClientId: string,
): Array<Id<"noteItems">> {
  const idToRow = new Map(rows.map((r) => [r.clientId, r]));
  const byParent = new Map<string | "__root__", string[]>();
  for (const r of rows) {
    const pKey =
      r.parentClientId === null ? "__root__" : r.parentClientId;
    if (!byParent.has(pKey)) byParent.set(pKey, []);
    byParent.get(pKey)!.push(r.clientId);
  }
  const out: Array<Id<"noteItems">> = [];
  const queue = [rootClientId];
  while (queue.length > 0) {
    const cid = queue.shift()!;
    const row = idToRow.get(cid);
    if (row === undefined) continue;
    out.push(row._id);
    const kids = byParent.get(cid) ?? [];
    for (const k of kids) queue.push(k);
  }
  return out;
}

export const listForUser = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAllowedUser(ctx);
    return await ctx.db
      .query("noteItems")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const createFolder = mutation({
  args: {
    clientId: v.string(),
    name: v.string(),
    parentClientId: v.union(v.null(), v.string()),
    sortIndex: v.number(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAllowedUser(ctx);
    const trimmed = args.name.trim();
    if (trimmed.length === 0) {
      throw new ConvexError("Folder name cannot be empty.");
    }
    const existing = await getRowByClientId(ctx, userId, args.clientId);
    if (existing !== null) return;
    await assertParentBelongsToUser(ctx, userId, args.parentClientId);
    await ctx.db.insert("noteItems", {
      userId,
      clientId: args.clientId,
      itemType: "folder",
      name: trimmed,
      parentClientId: args.parentClientId,
      sortIndex: args.sortIndex,
      createdAt: args.createdAt,
    });
  },
});

export const createNote = mutation({
  args: {
    clientId: v.string(),
    name: v.string(),
    parentClientId: v.union(v.null(), v.string()),
    sortIndex: v.number(),
    createdAt: v.number(),
    template: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAllowedUser(ctx);
    const trimmed = args.name.trim();
    if (trimmed.length === 0) {
      throw new ConvexError("Note name cannot be empty.");
    }
    const existing = await getRowByClientId(ctx, userId, args.clientId);
    if (existing !== null) return;
    await assertParentBelongsToUser(ctx, userId, args.parentClientId);
    const now = args.createdAt;
    await ctx.db.insert("noteItems", {
      userId,
      clientId: args.clientId,
      itemType: "note",
      name: trimmed,
      parentClientId: args.parentClientId,
      sortIndex: args.sortIndex,
      createdAt: now,
      updatedAt: now,
      template: args.template,
      strokes: [],
      textBlocks: [],
      scrollHeight: 2000,
      zoom: 1,
    });
  },
});

export const deleteItem = mutation({
  args: { clientId: v.string() },
  handler: async (ctx, { clientId }) => {
    const { userId } = await requireAllowedUser(ctx);
    const all = await ctx.db
      .query("noteItems")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const root = all.find((r) => r.clientId === clientId);
    if (root === undefined) return;
    const ids = collectSubtreeConvexIds(all, clientId);
    for (const convexId of ids) {
      await ctx.db.delete(convexId);
    }
  },
});

export const renameItem = mutation({
  args: { clientId: v.string(), name: v.string() },
  handler: async (ctx, { clientId, name }) => {
    const { userId } = await requireAllowedUser(ctx);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new ConvexError("Name cannot be empty.");
    }
    const row = await getRowByClientId(ctx, userId, clientId);
    if (row === null) {
      throw new ConvexError("Item not found.");
    }
    await ctx.db.patch(row._id, { name: trimmed });
  },
});

const NOTE_ZOOM_MIN = 0.5;
const NOTE_ZOOM_MAX = 3;

export const updateNote = mutation({
  args: {
    clientId: v.string(),
    strokes: v.array(strokeValidator),
    textBlocks: v.array(textBlockValidator),
    scrollHeight: v.number(),
    zoom: v.number(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAllowedUser(ctx);
    const row = await getRowByClientId(ctx, userId, args.clientId);
    if (row === null || row.itemType !== "note") {
      throw new ConvexError("Note not found.");
    }
    const z = Number.isFinite(args.zoom)
      ? Math.min(NOTE_ZOOM_MAX, Math.max(NOTE_ZOOM_MIN, args.zoom))
      : 1;
    await ctx.db.patch(row._id, {
      strokes: args.strokes,
      textBlocks: args.textBlocks,
      scrollHeight: args.scrollHeight,
      zoom: z,
      updatedAt: args.updatedAt,
    });
  },
});
