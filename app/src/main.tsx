import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { StartupErrorBoundary } from './components/StartupErrorBoundary'
import { initializeNativeRuntime } from './native/runtime'
import { Onboarding } from './screens/Onboarding'
import { Today } from './screens/Today'
import './styles/base.css'
import './styles/app.css'
import './styles/health-import.css'
import './styles/hello-kitty-theme.css'

// Retire service workers left behind by pre-native development builds. Ruby
// no longer registers a PWA or depends on service-worker caching.
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
    .catch(() => undefined)
}

void initializeNativeRuntime()

// Public evaluation: never hydrate from or write to a shared cloud database.

const onboardingPreview =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('preview') === 'onboarding'
const pillTrackerPreview =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('preview') === 'pill-tracker'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StartupErrorBoundary>
      {onboardingPreview ? (
        <Onboarding
          onDone={() => {
            window.location.assign('/')
          }}
        />
      ) : pillTrackerPreview ? (
        <main>
          <Today />
        </main>
      ) : (
        <App />
      )}
    </StartupErrorBoundary>
  </React.StrictMode>,
)
