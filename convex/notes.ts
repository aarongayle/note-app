import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { imageEmbedFieldValidator } from "./noteValidators";
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

const textBoxValidator = v.object({
  id: v.string(),
  x: v.number(),
  y: v.number(),
  width: v.number(),
  content: v.string(),
});

const importEpubMarginsValidator = v.object({
  top: v.number(),
  right: v.number(),
  bottom: v.number(),
  left: v.number(),
});

const EPUB_MARGIN_MIN = 0;
const EPUB_MARGIN_MAX = 120;

const EPUB_WIDTH_MIN = 200;
const EPUB_WIDTH_MAX = 1600;

function clampEpubMarginSide(n: number): number {
  return Math.min(EPUB_MARGIN_MAX, Math.max(EPUB_MARGIN_MIN, n));
}

function clampEpubMargins(m: {
  top: number;
  right: number;
  bottom: number;
  left: number;
}): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  return {
    top: clampEpubMarginSide(m.top),
    right: clampEpubMarginSide(m.right),
    bottom: clampEpubMarginSide(m.bottom),
    left: clampEpubMarginSide(m.left),
  };
}

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

async function assertFilesOwnedByUser(
  ctx: DbCtx,
  userId: Id<"users">,
  fileIds: Id<"files">[],
) {
  const unique = [...new Set(fileIds)];
  for (const fileId of unique) {
    const file = await ctx.db.get(fileId);
    if (file === null || file.userId !== userId) {
      throw new ConvexError("File not found.");
    }
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
    imageEmbeds: v.optional(v.array(imageEmbedFieldValidator)),
    pdfBackgroundFileId: v.optional(v.id("files")),
    epubBackgroundFileId: v.optional(v.id("files")),
    epubContentWidth: v.optional(v.number()),
    importDocFontSizePt: v.optional(v.number()),
    importEpubMarginPt: v.optional(v.number()),
    importEpubMargins: v.optional(importEpubMarginsValidator),
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
    const embeds = args.imageEmbeds ?? [];
    const pdfId = args.pdfBackgroundFileId;
    const epubId = args.epubBackgroundFileId;
    const fileIds: Id<"files">[] = [...embeds.map((e) => e.fileId)];
    if (pdfId !== undefined) {
      fileIds.push(pdfId);
    }
    if (epubId !== undefined) {
      fileIds.push(epubId);
    }
    if (fileIds.length > 0) {
      await assertFilesOwnedByUser(ctx, userId, fileIds);
    }
    const now = args.createdAt;
    const template =
      pdfId !== undefined || epubId !== undefined ? "blank" : args.template;
    const fontPt =
      args.importDocFontSizePt !== undefined
        ? Math.min(48, Math.max(10, args.importDocFontSizePt))
        : undefined;
    const epubMarginsRow =
      args.importEpubMargins !== undefined
        ? clampEpubMargins(args.importEpubMargins)
        : undefined;
    const epubMargin =
      args.importEpubMarginPt !== undefined && epubMarginsRow === undefined
        ? Math.min(EPUB_MARGIN_MAX, Math.max(EPUB_MARGIN_MIN, args.importEpubMarginPt))
        : undefined;
    await ctx.db.insert("noteItems", {
      userId,
      clientId: args.clientId,
      itemType: "note",
      name: trimmed,
      parentClientId: args.parentClientId,
      sortIndex: args.sortIndex,
      createdAt: now,
      updatedAt: now,
      template,
      strokes: [],
      textBlocks: [],
      imageEmbeds: embeds.length > 0 ? embeds : undefined,
      ...(pdfId !== undefined ? { pdfBackgroundFileId: pdfId } : {}),
      ...(epubId !== undefined ? { epubBackgroundFileId: epubId } : {}),
      ...(epubId !== undefined && args.epubContentWidth !== undefined
        ? { epubContentWidth: Math.min(EPUB_WIDTH_MAX, Math.max(EPUB_WIDTH_MIN, args.epubContentWidth)) }
        : {}),
      ...(fontPt !== undefined ? { importDocFontSizePt: fontPt } : {}),
      ...(epubMarginsRow !== undefined
        ? { importEpubMargins: epubMarginsRow }
        : {}),
      ...(epubMargin !== undefined ? { importEpubMarginPt: epubMargin } : {}),
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
    textBoxes: v.array(textBoxValidator),
    imageEmbeds: v.array(imageEmbedFieldValidator),
    pdfBackgroundFileId: v.union(v.null(), v.id("files")),
    epubBackgroundFileId: v.union(v.null(), v.id("files")),
    epubContentWidth: v.union(v.null(), v.number()),
    bookmarkY: v.union(v.null(), v.number()),
    lastScrollY: v.union(v.null(), v.number()),
    inputMode: v.union(v.null(), v.literal("stylus"), v.literal("keyboard"), v.literal("select")),
    scrollHeight: v.number(),
    zoom: v.number(),
    updatedAt: v.number(),
    importDocFontSizePt: v.number(),
    importEpubMarginPt: v.union(v.null(), v.number()),
    importEpubMargins: v.union(v.null(), importEpubMarginsValidator),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAllowedUser(ctx);
    const row = await getRowByClientId(ctx, userId, args.clientId);
    if (row === null || row.itemType !== "note") {
      throw new ConvexError("Note not found.");
    }
    const fileIds: Id<"files">[] = args.imageEmbeds.map((e) => e.fileId);
    if (args.pdfBackgroundFileId !== null) {
      fileIds.push(args.pdfBackgroundFileId);
    }
    if (args.epubBackgroundFileId !== null) {
      fileIds.push(args.epubBackgroundFileId);
    }
    if (fileIds.length > 0) {
      await assertFilesOwnedByUser(ctx, userId, fileIds);
    }
    const z = Number.isFinite(args.zoom)
      ? Math.min(NOTE_ZOOM_MAX, Math.max(NOTE_ZOOM_MIN, args.zoom))
      : 1;
    const fontPt = Math.min(48, Math.max(10, args.importDocFontSizePt));
    let nextEpubMargins: {
      top: number;
      right: number;
      bottom: number;
      left: number;
    } | undefined;
    let nextEpubMarginPt: number | undefined;
    if (args.importEpubMargins !== null) {
      nextEpubMargins = clampEpubMargins(args.importEpubMargins);
      nextEpubMarginPt = undefined;
    } else if (args.importEpubMarginPt !== null) {
      nextEpubMarginPt = Math.min(
        EPUB_MARGIN_MAX,
        Math.max(EPUB_MARGIN_MIN, args.importEpubMarginPt),
      );
      nextEpubMargins = undefined;
    } else {
      nextEpubMargins = undefined;
      nextEpubMarginPt = undefined;
    }
    await ctx.db.patch(row._id, {
      strokes: args.strokes,
      textBlocks: args.textBlocks,
      textBoxes: args.textBoxes.length > 0 ? args.textBoxes : undefined,
      imageEmbeds: args.imageEmbeds.length > 0 ? args.imageEmbeds : undefined,
      pdfBackgroundFileId:
        args.pdfBackgroundFileId === null
          ? undefined
          : args.pdfBackgroundFileId,
      epubBackgroundFileId:
        args.epubBackgroundFileId === null
          ? undefined
          : args.epubBackgroundFileId,
      epubContentWidth:
        args.epubContentWidth === null
          ? undefined
          : args.epubContentWidth != null
            ? Math.min(EPUB_WIDTH_MAX, Math.max(EPUB_WIDTH_MIN, args.epubContentWidth))
            : undefined,
      bookmarkY: args.bookmarkY === null ? undefined : args.bookmarkY,
      lastScrollY: args.lastScrollY === null ? undefined : args.lastScrollY,
      inputMode: args.inputMode === null ? undefined : args.inputMode,
      scrollHeight: args.scrollHeight,
      zoom: z,
      updatedAt: args.updatedAt,
      importDocFontSizePt: fontPt,
      importEpubMargins: nextEpubMargins,
      importEpubMarginPt: nextEpubMarginPt,
    });
  },
});
