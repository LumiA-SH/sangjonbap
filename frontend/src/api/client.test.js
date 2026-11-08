import {api,apiUrl,setToken} from './client';

const originalBase=process.env.REACT_APP_API_BASE;
const originalFetch=global.fetch;
const originalNodeEnv=process.env.NODE_ENV;
afterEach(()=>{setToken(null);global.fetch=originalFetch;
    process.env.NODE_ENV=originalNodeEnv;
    if(originalBase===undefined)delete process.env.REACT_APP_API_BASE;else process.env.REACT_APP_API_BASE=originalBase;});

test('local API default and Edge login use the same configured base',()=>{
    delete process.env.REACT_APP_API_BASE;
    expect(apiUrl('/auth/mastodon/login')).toBe('/api/auth/mastodon/login');
    process.env.REACT_APP_API_BASE='https://api.survivalbob.site/functions/v1/api/';
    expect(apiUrl('/auth/mastodon/login')).toBe('https://api.survivalbob.site/functions/v1/api/auth/mastodon/login');
});

test('production requires explicit API base instead of calling GitHub Pages',async()=>{
    process.env.NODE_ENV='production';delete process.env.REACT_APP_API_BASE;
    global.fetch=jest.fn();
    await expect(api('/auth/config')).rejects.toMatchObject({code:'API_BASE_MISSING'});
    expect(global.fetch).not.toHaveBeenCalled();
});
test('HTML response and network failure are distinct from authentication errors',async()=>{
    global.fetch=jest.fn().mockResolvedValue({status:404,json:async()=>{throw new SyntaxError();}});
    await expect(api('/auth/config')).rejects.toMatchObject({code:'API_RESPONSE_INVALID',status:404});
    global.fetch.mockRejectedValue(new TypeError('fetch failed'));
    await expect(api('/auth/config')).rejects.toMatchObject({code:'API_CONNECTION_FAILED'});
});
test('request timeout aborts and permits retry without automatically replaying writes',async()=>{
    jest.useFakeTimers();
    try {
        global.fetch=jest.fn((url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')))));
        const pending=expect(api('/auth/config')).rejects.toMatchObject({code:'API_TIMEOUT'});
        jest.advanceTimersByTime(15000);await pending;
        expect(global.fetch).toHaveBeenCalledTimes(1);
    } finally {jest.useRealTimers();}
});

test('Edge requests include cookies while preserving DEV token and error handling',async()=>{
    process.env.REACT_APP_API_BASE='https://api.survivalbob.site/functions/v1/api';
    setToken('fixture');
    global.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,data:{value:1}})});
    expect(await api('/health')).toEqual({value:1});
    expect(global.fetch).toHaveBeenCalledWith(apiUrl('/health'),expect.objectContaining({credentials:'include',
        headers:{Authorization:'Bearer fixture'}}));
    global.fetch.mockResolvedValue({ok:false,status:401,json:async()=>({ok:false,error:{code:'UNAUTHORIZED',message:'로그인 필요'}})});
    await expect(api('/characters/me')).rejects.toMatchObject({code:'UNAUTHORIZED',status:401});
});
