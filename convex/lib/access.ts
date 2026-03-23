import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { assertUserAllowlisted } from "../allowlist";

type Ctx = QueryCtx | MutationCtx;

export async function requireAllowedUser(ctx: Ctx): Promise<{
  userId: Id<"users">;
  email: string;
}> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError("Not signed in.");
  }
  await assertUserAllowlisted(ctx, userId);
  const user = await ctx.db.get(userId);
  const email = user?.email;
  if (!email) {
    throw new ConvexError("Account has no email.");
  }
  return { userId, email };
}
