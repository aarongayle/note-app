import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

export const processPendingNotes = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Find notes that have strokes and have been updated since last transcribed
    const notes = await ctx.db
      .query("noteItems")
      .filter((q) => q.neq(q.field("strokes"), undefined))
      .collect();

    for (const note of notes) {
      if (!note.strokes || note.strokes.length === 0) continue;
      
      const lastUpdated = note.updatedAt ?? note.createdAt;
      const lastTranscribed = note.lastTranscribedAt ?? 0;

      if (lastUpdated > lastTranscribed) {
        // Schedule transcription action
        await ctx.scheduler.runAfter(0, internal.transcribe.transcribeNote, {
          noteId: note._id,
        });
        
        // Optimistically update lastTranscribedAt so we don't schedule it multiple times
        // if the cron runs again before the action finishes.
        // It will be updated again when the action finishes.
        await ctx.db.patch(note._id, { lastTranscribedAt: Date.now() });
      }
    }
  },
});

export const getNoteStrokes = internalQuery({
  args: { noteId: v.id("noteItems") },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.noteId);
    return note?.strokes ?? [];
  },
});

export const saveTranscriptions = internalMutation({
  args: {
    noteId: v.id("noteItems"),
    transcriptions: v.array(
      v.object({
        text: v.string(),
        startY: v.number(),
        endY: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    // Delete existing transcriptions for this note
    const existing = await ctx.db
      .query("transcriptions")
      .withIndex("by_note", (q) => q.eq("noteId", args.noteId))
      .collect();
      
    for (const doc of existing) {
      await ctx.db.delete(doc._id);
    }

    // Insert new ones
    for (const t of args.transcriptions) {
      if (t.text.trim().length > 0) {
        await ctx.db.insert("transcriptions", {
          noteId: args.noteId,
          text: t.text,
          startY: t.startY,
          endY: t.endY,
        });
      }
    }

    // Update lastTranscribedAt
    await ctx.db.patch(args.noteId, { lastTranscribedAt: Date.now() });
  },
});
