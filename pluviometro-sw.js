// ═══════════════════════════════════════════════════════════
//  Pluviômetro Pro — Service Worker v2.0
//  Estratégia: Cache First para assets, Network First para API
// ═══════════════════════════════════════════════════════════

const CACHE_NAME    = 'pluviometro-v2';
const RUNTIME_CACHE = 'pluviometro-runtime-v2';

// Assets que serão cacheados na instalação
const PRECACHE_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
    'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// ── Install ──────────────────────────────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('[SW] Pre-cacheando assets...');
            // Cacheia o que conseguir, ignora erros individuais
            return Promise.allSettled(
                PRECACHE_ASSETS.map(url => cache.add(url).catch(e => console.warn('[SW] Skip:', url, e.message)))
            );
        }).then(() => self.skipWaiting())
    );
});

// ── Activate ─────────────────────────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(k => k !== CACHE_NAME && k !== RUNTIME_CACHE)
                    .map(k => { console.log('[SW] Deletando cache antigo:', k); return caches.delete(k); })
            )
        ).then(() => self.clients.claim())
    );
});

// ── Fetch ─────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    // Ignora requests não-GET e extensões de Chrome
    if (request.method !== 'GET') return;
    if (url.protocol === 'chrome-extension:') return;

    // Supabase API → Network First (sempre tenta rede, fallback cache)
    if (url.hostname.includes('supabase.co')) {
        event.respondWith(networkFirst(request));
        return;
    }

    // CDN libs → Cache First (estável, raramente muda)
    if (url.hostname.includes('jsdelivr.net') || url.hostname.includes('cdn.')) {
        event.respondWith(cacheFirst(request));
        return;
    }

    // App HTML e assets → Stale While Revalidate
    event.respondWith(staleWhileRevalidate(request));
});

// ── Estratégias de cache ──────────────────────────────────────

async function networkFirst(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(RUNTIME_CACHE);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        const cached = await caches.match(request);
        return cached || new Response(JSON.stringify({ error: 'offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        return new Response('Recurso não disponível offline', { status: 503 });
    }
}

async function staleWhileRevalidate(request) {
    const cached = await caches.match(request);
    const networkPromise = fetch(request).then(response => {
        if (response.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
        }
        return response;
    }).catch(() => null);

    return cached || await networkPromise || new Response('Não disponível offline', { status: 503 });
}

// ── Background Sync (para salvar offline) ────────────────────
self.addEventListener('sync', event => {
    if (event.tag === 'sync-registros') {
        console.log('[SW] Background sync: registros');
        // A sincronização real é feita pelo app ao detectar online
    }
});

// ── Push Notifications (estrutura base) ──────────────────────
self.addEventListener('push', event => {
    if (!event.data) return;
    const data = event.data.json();
    event.waitUntil(
        self.registration.showNotification(data.title || 'Pluviômetro Pro', {
            body: data.body || 'Nova notificação',
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            data: { url: data.url || '/' }
        })
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        clients.openWindow(event.notification.data?.url || '/')
    );
});
