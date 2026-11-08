import {api,apiUrl,setToken} from './client';

const originalBase=process.env.REACT_APP_API_BASE;
const originalFetch=global.fetch;
afterEach(()=>{setToken(null);global.fetch=originalFetch;
    if(originalBase===undefined)delete process.env.REACT_APP_API_BASE;else process.env.REACT_APP_API_BASE=originalBase;});

test('local API default and Edge login use the same configured base',()=>{
    delete process.env.REACT_APP_API_BASE;
    expect(apiUrl('/auth/mastodon/login')).toBe('/api/auth/mastodon/login');
    process.env.REACT_APP_API_BASE='https://api.survivalbob.site/functions/v1/api/';
    expect(apiUrl('/auth/mastodon/login')).toBe('https://api.survivalbob.site/functions/v1/api/auth/mastodon/login');
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
