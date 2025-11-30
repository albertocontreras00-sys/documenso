/**
 * This is the main entry point for the server which will launch the RR7 application
 * and spin up auth, api, etc.
 *
 * Note:
 *  This file will be copied to the build folder during build time.
 *  Running this file will not work without a build.
 */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import handle from 'hono-react-router-adapter/node';

// Performance timing: Server startup
const START_TIME = Date.now();

import server from './hono/server/router.js';
import * as build from './index.js';

const BUILD_LOAD_TIME = Date.now();
console.log(`[PERF] Build loaded in ${BUILD_LOAD_TIME - START_TIME}ms`);

server.use(
  serveStatic({
    root: 'build/client',
    onFound: (path, c) => {
      if (path.startsWith('./build/client/assets')) {
        // Hard cache assets with hashed file names.
        c.header('Cache-Control', 'public, immutable, max-age=31536000');
      } else {
        // Cache with revalidation for rest of static files.
        c.header('Cache-Control', 'public, max-age=0, stale-while-revalidate=86400');
      }
    },
  }),
);

const handler = handle(build, server);

const HANDLER_READY_TIME = Date.now();
console.log(`[PERF] Handler ready in ${HANDLER_READY_TIME - START_TIME}ms`);

const port = parseInt(process.env.PORT || '3000', 10);

serve({ fetch: handler.fetch, port });

const SERVER_START_TIME = Date.now();
console.log(`[PERF] Server listening on port ${port} in ${SERVER_START_TIME - START_TIME}ms total`);
