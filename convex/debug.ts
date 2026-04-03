import { internalQuery } from "./_generated/server";

export const getNoteDates = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("noteItems").collect().then(notes => 
      notes.map(n => ({
        id: n._id, 
        name: n.name, 
        updatedAt: n.updatedAt, 
        lastTranscribedAt: n.lastTranscribedAt,
        strokes: n.strokes?.length
      }))
    );
  },
});
