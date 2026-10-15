const CACHE_NAME = 'biohazard-v4'

// Only cache truly static public assets — NOT '/' which requires auth
const STATIC_ASSETS = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  // Document loads must go straight to the browser. Intercepting them on iOS
  // home-screen web apps can drop the session cookie on the first request
  // after the app was killed, which sends a still-signed-in user to login.
  // fetch() also follows redirects, so a logged-out 302 used to be cached as
  // the login page under the original URL.
  if (event.request.mode === 'navigate') return

  if (
    event.request.method !== 'GET' ||
    event.request.url.includes('/api/') ||
    event.request.url.includes('supabase.co') ||
    event.request.url.includes('anthropic')
  ) {
    return
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const type = response.headers.get('content-type') || ''
        if (
          response.status === 200 &&
          response.type === 'basic' &&
          !response.headers.has('set-cookie') &&
          !type.includes('text/html')
        ) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
        }
        return response
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => cached ?? Response.error())
      })
  )
})
