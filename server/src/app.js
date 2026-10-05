import express from 'express';
import {randomUUID} from 'node:crypto';
import {AppError, ok, errorHandler} from './shared/http.js';
import {createDevProvider} from './modules/auth/providers/dev.js';
import {createSessions} from './modules/auth/session.js';
import {authRoutes} from './modules/auth/routes.js';
import {characterRoutes} from './modules/character/routes.js';

export function createApp(config, repository) {

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

  const sessions = createSessions(repository);

  app.get('/api/health', (req, res) =>
      ok(res, {status: 'up', mode: config.mode})
  );

  app.use(
      '/api/auth',
      authRoutes(createDevProvider(config, repository), sessions)
  );

  app.use(
      '/api/characters',
      characterRoutes(repository, sessions)
  );

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