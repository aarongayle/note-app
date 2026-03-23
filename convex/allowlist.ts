import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { ConvexError } from "convex/values";

type Ctx = QueryCtx | MutationCtx;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function envEmailSet(): Set<string> {
  const set = new Set<string>();
  const raw = process.env.ALLOWED_EMAILS;
  if (raw) {
    for (const part of raw.split(",")) {
      const e = normalizeEmail(part);
      if (e) set.add(e);
    }
  }
  const jsonList = process.env.AUTHED_USERS;
  if (jsonList) {
    try {
      const parsed: unknown = JSON.parse(jsonList);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === "string" && item.trim()) {
            set.add(normalizeEmail(item));
          }
        }
      }
    } catch {
      // Invalid JSON: ignore (set ALLOWED_EMAILS or fix JSON)
    }
  }
  return set;
}

export async function isEmailAllowlisted(
  ctx: Ctx,
  email: string,
): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  if (envEmailSet().has(normalized)) return true;
  const row = await ctx.db
    .query("allowedEmails")
    .withIndex("by_email", (q) => q.eq("email", normalized))
    .unique();
  return row !== null;
}

export async function assertUserAllowlisted(
  ctx: Ctx,
  userId: Id<"users">,
): Promise<void> {
  const user = await ctx.db.get(userId);
  const email = user?.email;
  if (!email) {
    throw new ConvexError(
      "Your Google account must have an email address to use this app.",
    );
  }
  if (!(await isEmailAllowlisted(ctx, email))) {
    throw new ConvexError(
      "This app is invite-only. Your email is not on the allowlist.",
    );
  }
}
