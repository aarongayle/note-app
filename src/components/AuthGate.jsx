import { useAuthActions } from '@convex-dev/auth/react'
import { useConvexAuth } from 'convex/react'

export default function AuthGate({ children }) {
  const { isLoading, isAuthenticated } = useConvexAuth()
  const { signIn } = useAuthActions()

  if (isLoading) {
    return (
      <div className="h-dvh flex items-center justify-center bg-surface text-text-muted text-sm">
        Loading…
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center gap-4 bg-surface px-6">
        <p className="text-text-muted text-center text-sm max-w-sm">
          Sign in with Google using an account on the server allowlist.
        </p>
        <button
          type="button"
          onClick={() => void signIn('google')}
          className="rounded-lg bg-white text-gray-900 px-4 py-2.5 text-sm font-medium border border-border shadow-sm hover:bg-gray-50 transition-colors"
        >
          Sign in with Google
        </button>
      </div>
    )
  }

  return (
    <div className="h-dvh w-full">
      {children}
    </div>
  )
}
