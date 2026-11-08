// Edge-only configuration: never load the local .env file or enable DEV auth.
export function loadEdgeConfig(env) {
    const required = key => {
        const value = env[key];
        if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing Edge setting: ${key}`);
        return value;
    };
    const origin = required('FRONTEND_ORIGIN');
    if (origin !== 'https://survivalbob.site') throw new Error('Invalid Edge frontend origin');
    const base = new URL(required('PUBLIC_API_BASE_URL'));
    if (base.protocol !== 'https:' || base.port || base.username || base.password || base.search || base.hash ||
        base.pathname.replace(/\/$/, '') !== '/functions/v1/api') throw new Error('Invalid Edge API base URL');
    const projectRef = required('EDGE_PROJECT_REF');
    if (!/^[a-z]{20}$/.test(projectRef) ||
        !['api.survivalbob.site',`${projectRef}.supabase.co`].includes(base.hostname)) throw new Error('Invalid Edge API host');
    const databaseUrl = required('EDGE_DATABASE_URL');
    const db = new URL(databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(db.protocol) || !db.hostname.endsWith('.pooler.supabase.com') ||
        db.port !== '6543' || !decodeURIComponent(db.username).endsWith(`.${projectRef}`)) {
        throw new Error('Edge requires the configured project transaction pooler on port 6543');
    }
    const apiBase = base.href.replace(/\/$/, '');
    return {nodeEnv:'production',provider:'mastodon',mode:'supabase',cors:true,origin,databaseUrl,
        databaseCa:env.EDGE_DATABASE_CA || '',apiBase,
        oauthClientId:required('MASTODON_CLIENT_ID'),oauthClientSecret:required('MASTODON_CLIENT_SECRET'),
        oauthRedirect:apiBase+'/auth/mastodon/callback'};
}
