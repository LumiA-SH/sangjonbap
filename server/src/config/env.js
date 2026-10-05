import dotenv from 'dotenv';
import {fileURLToPath} from 'node:url';
dotenv.config({path:fileURLToPath(new URL('../../.env',import.meta.url)),quiet:true});
export function loadConfig(env=process.env) {
  const config={nodeEnv:env.NODE_ENV||'development',host:env.HOST||'127.0.0.1',port:Number(env.PORT||4000),origin:env.FRONTEND_ORIGIN||'http://localhost:3000',provider:env.AUTH_PROVIDER||'dev',mode:env.DATA_MODE||'memory',loginKey:env.DEV_LOGIN_KEY||'',userId:env.DEV_AUTH_USER_ID||'1',databaseUrl:env.DATABASE_URL||'',caPath:env.DATABASE_CA_PATH||''};
  if(config.nodeEnv==='production') throw new Error('Production authentication is not implemented. Do not deploy this dev scaffold.');
  if(config.provider!=='dev') throw new Error('Only dev provider is implemented.');
  if(!['localhost','127.0.0.1','::1'].includes(config.host)) throw new Error('Dev API must bind to loopback.');
  if(!['memory','supabase'].includes(config.mode)) throw new Error('DATA_MODE must be memory or supabase.');
  if(!Number.isInteger(config.port)||config.port<1||config.port>65535) throw new Error('Invalid PORT.');
  if(config.loginKey.length<16) throw new Error('Set DEV_LOGIN_KEY to a local passphrase of at least 16 characters.');
  if(!/^[1-9][0-9]*$/.test(config.userId)||BigInt(config.userId)>9223372036854775807n) throw new Error('Invalid DEV_AUTH_USER_ID.');
  if(config.mode==='supabase'&&!config.databaseUrl) throw new Error('DATABASE_URL is required.');
  return config;
}