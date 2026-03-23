import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import ConvexRoot from './ConvexRoot.jsx'

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((r) => r.unregister())
  })
}

if ('caches' in window) {
  caches.keys().then((names) => {
    names.forEach((name) => caches.delete(name))
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ConvexRoot />
  </StrictMode>,
)
