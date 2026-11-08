import {publicAsset} from './publicAsset';
const original=process.env.PUBLIC_URL;
afterEach(()=>{if(original===undefined)delete process.env.PUBLIC_URL;else process.env.PUBLIC_URL=original;});
test.each(['','/','/sangjonbap','/sangjonbap/','https://survivalbob.site','https://lumia-sh.github.io/sangjonbap'])('public image base %s',base=>{
  process.env.PUBLIC_URL=base;
  expect(publicAsset('/assets/decor/icon-home.svg')).toBe(base.replace(/\/$/,'')+'/assets/decor/icon-home.svg');
  expect(publicAsset('test.png')).toBe(base.replace(/\/$/,'')+'/test.png');
});
