import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { extractRequestMetadata } from '@documenso/lib/universal/extract-request-metadata';
import { env } from '@documenso/lib/utils/env';

import { setCsrfCookie } from './lib/session/session-cookies';
import { accountRoute } from './routes/account';
import { callbackRoute } from './routes/callback';
import { emailPasswordRoute } from './routes/email-password';
import { oauthRoute } from './routes/oauth';
import { passkeyRoute } from './routes/passkey';
import { sessionRoute } from './routes/session';
import { signOutRoute } from './routes/sign-out';
import { twoFactorRoute } from './routes/two-factor';
import type { HonoAuthContext } from './types/context';

const allowedOrigins = Array.from(
  new Set(
    [NEXT_PUBLIC_WEBAPP_URL(), env('NEXT_PUBLIC_EMBED_URL'), env('NEXT_PUBLIC_EMBED_ALT_URL')]
      .filter(Boolean)
      .map((url) => {
        if (!url) {
          return null;
        }

        try {
          return new URL(url).origin;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as string[],
  ),
);

// Note: You must chain routes for Hono RPC client to work.
export const auth = new Hono<HonoAuthContext>()
  .use(
    '*',
    cors({
      origin: (origin) => {
        if (!origin) {
          return null;
        }

        return allowedOrigins.includes(origin) ? origin : null;
      },
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'Accept'],
      credentials: true,
    }),
  )
  .use(async (c, next) => {
    c.set('requestMetadata', extractRequestMetadata(c.req.raw));

    const headerOrigin = c.req.header('Origin');

    if (headerOrigin && !allowedOrigins.includes(headerOrigin)) {
      return c.json(
        {
          message: 'Forbidden',
          statusCode: 403,
        },
        403,
      );
    }

    await next();
  })
  .get('/csrf', async (c) => {
    const csrfToken = await setCsrfCookie(c);

    return c.json({ csrfToken });
  })
  .route('/', sessionRoute)
  .route('/', signOutRoute)
  .route('/', accountRoute)
  .route('/callback', callbackRoute)
  .route('/oauth', oauthRoute)
  .route('/email-password', emailPasswordRoute)
  .route('/passkey', passkeyRoute)
  .route('/two-factor', twoFactorRoute);

/**
 * Handle errors.
 */
auth.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json(
      {
        code: AppErrorCode.UNKNOWN_ERROR,
        message: err.message,
        statusCode: err.status,
      },
      err.status,
    );
  }

  if (err instanceof AppError) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const statusCode = (err.statusCode || 500) as ContentfulStatusCode;

    return c.json(
      {
        code: err.code,
        message: err.message,
        statusCode: err.statusCode,
      },
      statusCode,
    );
  }

  // Handle other errors
  return c.json(
    {
      code: AppErrorCode.UNKNOWN_ERROR,
      message: 'Internal Server Error',
      statusCode: 500,
    },
    500,
  );
});

export type AuthAppType = typeof auth;
