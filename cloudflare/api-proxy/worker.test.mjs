import test from 'node:test';
import assert from 'node:assert/strict';
import {proxy} from './worker.mjs';
const base='https://api.survivalbob.site/functions/v1/api';
const env={EDGE_PROXY_SECRET:'s'.repeat(64)};
test('proxy preserves body, query, origin, cookies; overwrites spoofed secret; no redirect following',async()=>{
    let calls=0;
    const r=await proxy(new Request(base+'/auth/mastodon/callback?code=test&state=test',{method:'POST',headers:{Cookie:'session=test',Origin:'https://survivalbob.site','x-sangjonbap-proxy':'forged'},body:'payload'}),env,async(url,opts)=>{
        calls++;assert.equal(url,'https://grkohfxvafbquhmgnvwj.supabase.co/functions/v1/api/auth/mastodon/callback?code=test&state=test');
        assert.equal(opts.method,'POST');assert.equal(opts.redirect,'manual');assert.equal(opts.cache,'no-store');
        assert.equal(opts.headers.get('cookie'),'session=test');assert.equal(opts.headers.get('origin'),'https://survivalbob.site');assert.equal(opts.headers.get('x-sangjonbap-proxy'),env.EDGE_PROXY_SECRET);
        assert.equal(await new Response(opts.body).text(),'payload');
        const headers=new Headers({Location:'https://survivalbob.site/'});headers.append('Set-Cookie','__Host-state=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0');headers.append('Set-Cookie','__Host-session=test; Path=/; Secure; HttpOnly; SameSite=Lax');
        return new Response(null,{status:303,headers});
    });
    assert.equal(calls,1);assert.equal(r.status,303);assert.equal(r.headers.get('location'),'https://survivalbob.site/');assert.equal(r.headers.getSetCookie().length,2);assert.equal(r.headers.get('cache-control'),'no-store');
});
test('fixed upstream, fail closed and no retry',async()=>{
    let calls=0;const fail=async()=>{calls++;throw new Error('secret must not leak');};
    assert.equal((await proxy(new Request('https://evil.example/functions/v1/api'),env,fail)).status,404);
    assert.equal((await proxy(new Request(base+'x'),env,fail)).status,404);
    assert.equal((await proxy(new Request(base),{},fail)).status,503);assert.equal(calls,0);
    const r=await proxy(new Request(base,{method:'POST',body:'test'}),env,fail);assert.equal(r.status,502);assert.ok(!(await r.text()).includes('secret'));assert.equal(calls,1);
});
test('OPTIONS forwards original CORS headers and response unchanged',async()=>{
    const r=await proxy(new Request(base+'/health',{method:'OPTIONS',headers:{Origin:'https://survivalbob.site','Access-Control-Request-Method':'GET'}}),env,async(url,opts)=>{
        assert.equal(opts.method,'OPTIONS');assert.equal(opts.headers.get('access-control-request-method'),'GET');return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'https://survivalbob.site','Access-Control-Allow-Credentials':'true'}});
    });assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-credentials'),'true');
});
