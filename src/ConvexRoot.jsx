import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { ConvexReactClient } from 'convex/react'
import App from './App.jsx'
import AuthGate from './components/AuthGate.jsx'

export default function ConvexRoot() {
  const convexUrl = import.meta.env.VITE_CONVEX_URL

  if (!convexUrl) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center gap-3 bg-surface px-6 text-center">
        <p className="text-text-primary text-sm font-medium">Convex URL missing</p>
        <p className="text-text-muted text-xs max-w-md">
          Add <code className="text-accent">VITE_CONVEX_URL</code> to{' '}
          <code className="text-accent">.env</code> (from{' '}
          <code className="text-accent">npx convex dev</code>), then restart Vite.
        </p>
      </div>
    )
  }

  const convex = new ConvexReactClient(convexUrl)
  return (
    <ConvexAuthProvider client={convex}>
      <AuthGate>
        <App />
      </AuthGate>
    </ConvexAuthProvider>
  )
}
