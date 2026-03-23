import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";
import { assertUserAllowlisted } from "./allowlist";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google],
  callbacks: {
    async beforeSessionCreation(ctx, { userId }) {
      await assertUserAllowlisted(ctx, userId);
    },
  },
});
