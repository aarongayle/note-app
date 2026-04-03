import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireAllowedUser } from "./lib/access";

export const searchTranscriptions = query({
  args: {
    clientId: v.string(),
    searchQuery: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.searchQuery) return [];
    
    // We need the user ID to query by clientId
    const { userId } = await requireAllowedUser(ctx);

    const note = await ctx.db
      .query("noteItems")
      .withIndex("by_user_clientId", (q) =>
        q.eq("userId", userId).eq("clientId", args.clientId)
      )
      .unique();

    if (!note) return [];
    
    return await ctx.db
      .query("transcriptions")
      .withSearchIndex("search_text", (q) =>
        q.search("text", args.searchQuery).eq("noteId", note._id)
      )
      .take(50);
  },
});
