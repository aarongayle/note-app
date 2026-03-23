import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { normalizeEmail } from "./allowlist";

/**
 * Run from your machine (not callable from the browser):
 *   npx convex run allowlistAdmin:seedEmails '{"emails":["you@example.com"]}'
 *
 * Prefer adding rows in the Convex dashboard → Data → allowedEmails when possible.
 */
export const seedEmails = internalMutation({
  args: { emails: v.array(v.string()) },
  handler: async (ctx, { emails }) => {
    const now = Date.now();
    for (const raw of emails) {
      const email = normalizeEmail(raw);
      if (!email) continue;
      const existing = await ctx.db
        .query("allowedEmails")
        .withIndex("by_email", (q) => q.eq("email", email))
        .unique();
      if (existing === null) {
        await ctx.db.insert("allowedEmails", {
          email,
          createdAt: now,
        });
      }
    }
  },
});
