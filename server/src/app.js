import express from 'express';
import {battleRoutes} from './modules/battle/routes.js';
import {trainingRoutes} from './modules/training/routes.js';
import {randomUUID} from 'node:crypto';
import {AppError, ok, errorHandler} from './shared/http.js';
import {createDevProvider} from './modules/auth/providers/dev.js';
import {createSessions} from './modules/auth/session.js';
import {createOAuthSessions} from './modules/auth/oauth-session.js';
import {mastodonRoutes} from './modules/auth/mastodon.js';
import {authRoutes} from './modules/auth/routes.js';
import {characterRoutes} from './modules/character/routes.js';
import {inventoryRoutes} from './modules/inventory/routes.js';
import {devRoutes} from './modules/dev/routes.js';
import {shopRoutes} from './modules/shop/routes.js';
import {cookingRoutes} from './modules/cooking/routes.js';
import {gachaRoutes} from './modules/gacha/routes.js';
import {adminRoutes} from './modules/admin/routes.js';
import {investigationRoutes} from './modules/investigation/routes.js';


export function createApp(config, repository, authDependencies={}) {

  const app = express();

  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();

    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'X-Request-Id': res.locals.requestId
    });


    // Compare the original browser origin exactly. The development proxy must
    // preserve it; never trust Host or X-Forwarded-* as an origin allowlist.
    if (req.headers.origin && req.headers.origin !== config.origin) {
      throw new AppError(
          403,
          'ORIGIN_DENIED',
          '허용되지 않은 출처입니다.'
      );
    }

    next();
  });

  app.use(express.json({limit: '16kb'}));

  const sessions = config.provider==='mastodon'?createOAuthSessions(repository,config.origin):createSessions(repository);

  app.get('/api/health', (req, res) =>
      ok(res, {status: 'up', mode: config.mode})
  );

  app.use(
      '/api/auth',
      authRoutes(createDevProvider(config, repository), sessions,config)
  );
  if(config.provider==='mastodon')app.use('/api/auth/mastodon',mastodonRoutes(config,repository,sessions,authDependencies));

  // Complete overdue resets before accepting new gameplay on every instance.
  // Auth/health remain available when reset recovery needs operator attention.
  if(repository.recoverDailyReset) app.use(
      ['/api/characters','/api/inventory','/api/investigation','/api/shop','/api/training','/api/cooking','/api/gacha','/api/battles'],
      sessions.require,async(req,res,next)=>{await repository.recoverDailyReset();next();}
  );

  app.use(
      '/api/characters',
      characterRoutes(repository, sessions,config)
  );

  app.use(
      '/api/inventory',
      inventoryRoutes(repository, sessions)
  );

  app.use('/api/investigation', investigationRoutes(repository, sessions));
  app.use('/api/dev', devRoutes(config, repository, sessions));
  app.use('/api/shop', shopRoutes(repository, sessions));
  app.use('/api/training', trainingRoutes(repository, sessions));
  app.use('/api/cooking', cookingRoutes(repository, sessions));
  app.use('/api/gacha', gachaRoutes(repository, sessions));
  app.use('/api/battles', battleRoutes(repository, sessions));
  app.use('/api/admin', adminRoutes(config, repository, sessions));

  app.use((req, res, next) =>
      next(
          new AppError(
              404,
              'NOT_FOUND',
              '존재하지 않는 API입니다.'
          )
      )
  );

  app.use(errorHandler);

  return app;
}
