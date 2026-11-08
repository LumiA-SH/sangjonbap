const publicOrigin = 'https://api.survivalbob.site';
const upstream = 'https://grkohfxvafbquhmgnvwj.supabase.co';
const prefix = '/functions/v1/api';

export async function proxy(request, env, fetchImpl = fetch) {
    const url = new URL(request.url);
    const allowedOrigin = env.PUBLIC_PROXY_ORIGIN || publicOrigin;
    if (allowedOrigin !== publicOrigin && !/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(allowedOrigin))
        return new Response('Proxy unavailable', {status:503, headers:{'Cache-Control':'no-store'}});
    if (url.origin !== allowedOrigin || !(url.pathname === prefix || url.pathname.startsWith(prefix + '/')))
        return new Response('Not found', {status:404, headers:{'Cache-Control':'no-store'}});
    if (typeof env.EDGE_PROXY_SECRET !== 'string' || env.EDGE_PROXY_SECRET.length < 32)
        return new Response('Proxy unavailable', {status:503, headers:{'Cache-Control':'no-store'}});
    const headers = new Headers(request.headers);
    for (const name of ['host','x-sangjonbap-proxy','forwarded','x-forwarded-host','x-forwarded-proto']) headers.delete(name);
    headers.set('x-sangjonbap-proxy', env.EDGE_PROXY_SECRET);
    try {
        const response = await fetchImpl(upstream + url.pathname + url.search, {
            method:request.method, headers, redirect:'manual',
            ...(request.method === 'GET' || request.method === 'HEAD' ? {} : {body:request.body}),
            cache:'no-store'
        });
        // Clone Headers directly; never combine Set-Cookie with Object.fromEntries/join.
        const out = new Headers(response.headers);
        out.set('Cache-Control','no-store');
        out.delete('CDN-Cache-Control');out.delete('Cloudflare-CDN-Cache-Control');
        out.set('Referrer-Policy','no-referrer');
        return new Response(response.body,{status:response.status,statusText:response.statusText,headers:out});
    } catch {
        // No URL, query, request headers or exception details are logged. No retry.
        return new Response('API unavailable',{status:502,headers:{'Cache-Control':'no-store'}});
    }
}
export default {fetch(request, env) { return proxy(request, env); }};
