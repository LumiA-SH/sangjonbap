import {createCompatApp} from './app.js';

const {app} = createCompatApp({
    probeToken:Deno.env.get('COMPAT_PROBE_TOKEN'),
    databaseUrl:Deno.env.get('COMPAT_DATABASE_URL'),
    ca:Deno.env.get('COMPAT_DATABASE_CA')
});

// Node-compatible listener; no scheduler is started.
app.listen(8000);
