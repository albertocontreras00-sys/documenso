import { sValidator } from '@hono/standard-validator';
import type { Prisma } from '@prisma/client';
import { Hono } from 'hono';

import { getOptionalSession } from '@documenso/auth/server/lib/utils/get-session';
import { APP_DOCUMENT_UPLOAD_SIZE_LIMIT } from '@documenso/lib/constants/app';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { verifyEmbeddingPresignToken } from '@documenso/lib/server-only/embedding-presign/verify-embedding-presign-token';
import { getTeamById } from '@documenso/lib/server-only/team/get-team';
import { putNormalizedPdfFileServerSide } from '@documenso/lib/universal/upload/put-file.server';
import { getPresignPostUrl } from '@documenso/lib/universal/upload/server-actions';
import { prisma } from '@documenso/prisma';

import type { HonoEnv } from '../../router';
import { handleEnvelopeItemFileRequest } from './files.helpers';
import {
  type TGetPresignedPostUrlResponse,
  ZGetEnvelopeItemFileDownloadRequestParamsSchema,
  ZGetEnvelopeItemFileRequestParamsSchema,
  ZGetEnvelopeItemFileRequestQuerySchema,
  ZGetEnvelopeItemFileTokenDownloadRequestParamsSchema,
  ZGetEnvelopeItemFileTokenRequestParamsSchema,
  ZGetPresignedPostUrlRequestSchema,
  ZUploadPdfRequestSchema,
} from './files.types';

export const filesRoute = new Hono<HonoEnv>()
  /**
   * Uploads a document file to the appropriate storage location and creates
   * a document data record.
   */
  .post('/upload-pdf', sValidator('form', ZUploadPdfRequestSchema), async (c) => {
    // Performance timing: File upload
    const UPLOAD_START = Date.now();
    const uploadRequestId = c.req.header('x-request-id') || c.req.header('fly-request-id') || 'unknown';
    
    let file: File | undefined;
    // Convert MB to bytes (1 MB = 1024 * 1024 bytes)
    const MAX_FILE_SIZE = APP_DOCUMENT_UPLOAD_SIZE_LIMIT * 1024 * 1024;

    try {
      ({ file } = c.req.valid('form'));

      if (!file) {
        return c.json({ error: 'No file provided' }, 400);
      }

      console.log(`[PERF] [${uploadRequestId}] File upload started: ${file?.name}, ${file?.size} bytes`);

      // Todo: (RR7) This is new.
      // Add file size validation.
      if (file.size > MAX_FILE_SIZE) {
        return c.json({ error: 'File too large' }, 400);
      }

      const NORMALIZE_START = Date.now();
      const result = await putNormalizedPdfFileServerSide(file);
      const NORMALIZE_TIME = Date.now();
      console.log(`[PERF] [${uploadRequestId}] PDF normalization took ${NORMALIZE_TIME - NORMALIZE_START}ms`);

      const UPLOAD_TOTAL = Date.now();
      console.log(`[PERF] [${uploadRequestId}] Total upload time: ${UPLOAD_TOTAL - UPLOAD_START}ms`);

      return c.json(result);
    } catch (error) {
      console.error('DOCUMENSO UPLOAD ERROR', {
        timestamp: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        errorName: error instanceof Error ? error.name : typeof error,
        fileName: file?.name,
        fileSize: file?.size,
        contentType: file?.type,
        maxFileSize: MAX_FILE_SIZE,
        requestId: c.req.header('x-request-id') || c.req.header('fly-request-id'),
        userAgent: c.req.header('user-agent'),
      });
      return c.json({ error: 'Upload failed' }, 500);
    }
  })
  .post('/presigned-post-url', sValidator('json', ZGetPresignedPostUrlRequestSchema), async (c) => {
    // Performance timing: Presigned URL generation
    const PRESIGN_START = Date.now();
    const presignRequestId = c.req.header('x-request-id') || c.req.header('fly-request-id') || 'unknown';
    
    const { fileName, contentType } = c.req.valid('json');

    try {
      const { key, url } = await getPresignPostUrl(fileName, contentType);
      const PRESIGN_TIME = Date.now();
      console.log(`[PERF] [${presignRequestId}] Presigned URL generation took ${PRESIGN_TIME - PRESIGN_START}ms`);

      return c.json({ key, url } satisfies TGetPresignedPostUrlResponse);
    } catch (err) {
      console.error(err);

      throw new AppError(AppErrorCode.UNKNOWN_ERROR);
    }
  })
  .get(
    '/envelope/:envelopeId/envelopeItem/:envelopeItemId',
    sValidator('param', ZGetEnvelopeItemFileRequestParamsSchema),
    sValidator('query', ZGetEnvelopeItemFileRequestQuerySchema),
    async (c) => {
      const { envelopeId, envelopeItemId } = c.req.valid('param');
      const { token } = c.req.query();

      const session = await getOptionalSession(c);

      let userId = session.user?.id;

      if (token) {
        const presignToken = await verifyEmbeddingPresignToken({
          token,
        }).catch(() => undefined);

        userId = presignToken?.userId;
      }

      if (!userId) {
        return c.json({ error: 'Unauthorized' }, 401);
      }

      // Performance timing: Database query
      const DB_QUERY_START = Date.now();
      const queryRequestId = c.req.header('x-request-id') || c.req.header('fly-request-id') || 'unknown';
      console.log(`[PERF] [${queryRequestId}] DB query started: envelope ${envelopeId}, item ${envelopeItemId}`);

      const envelope = await prisma.envelope.findFirst({
        where: {
          id: envelopeId,
        },
        include: {
          envelopeItems: {
            where: {
              id: envelopeItemId,
            },
            include: {
              documentData: true,
            },
          },
        },
      });

      const DB_QUERY_TIME = Date.now();
      console.log(`[PERF] [${queryRequestId}] DB query completed in ${DB_QUERY_TIME - DB_QUERY_START}ms`);

      if (!envelope) {
        return c.json({ error: 'Envelope not found' }, 404);
      }

      const [envelopeItem] = envelope.envelopeItems;

      if (!envelopeItem) {
        return c.json({ error: 'Envelope item not found' }, 404);
      }

      const team = await getTeamById({
        userId: userId,
        teamId: envelope.teamId,
      }).catch((error) => {
        console.error(error);

        return null;
      });

      if (!team) {
        return c.json(
          { error: 'User does not have access to the team that this envelope is associated with' },
          403,
        );
      }

      if (!envelopeItem.documentData) {
        return c.json({ error: 'Document data not found' }, 404);
      }

      return await handleEnvelopeItemFileRequest({
        title: envelopeItem.title,
        status: envelope.status,
        documentData: envelopeItem.documentData,
        version: 'signed',
        isDownload: false,
        context: c,
      });
    },
  )
  .get(
    '/envelope/:envelopeId/envelopeItem/:envelopeItemId/download/:version?',
    sValidator('param', ZGetEnvelopeItemFileDownloadRequestParamsSchema),
    async (c) => {
      const { envelopeId, envelopeItemId, version } = c.req.valid('param');

      const session = await getOptionalSession(c);

      if (!session.user) {
        return c.json({ error: 'Unauthorized' }, 401);
      }

      // Performance timing: Database query
      const DB_QUERY_START_2 = Date.now();
      const queryRequestId2 = c.req.header('x-request-id') || c.req.header('fly-request-id') || 'unknown';
      console.log(`[PERF] [${queryRequestId2}] DB query started (download): envelope ${envelopeId}, item ${envelopeItemId}`);

      const envelope = await prisma.envelope.findFirst({
        where: {
          id: envelopeId,
        },
        include: {
          envelopeItems: {
            where: {
              id: envelopeItemId,
            },
            include: {
              documentData: true,
            },
          },
        },
      });

      const DB_QUERY_TIME_2 = Date.now();
      console.log(`[PERF] [${queryRequestId2}] DB query completed (download) in ${DB_QUERY_TIME_2 - DB_QUERY_START_2}ms`);

      if (!envelope) {
        return c.json({ error: 'Envelope not found' }, 404);
      }

      const [envelopeItem] = envelope.envelopeItems;

      if (!envelopeItem) {
        return c.json({ error: 'Envelope item not found' }, 404);
      }

      const team = await getTeamById({
        userId: session.user.id,
        teamId: envelope.teamId,
      }).catch((error) => {
        console.error(error);

        return null;
      });

      if (!team) {
        return c.json(
          { error: 'User does not have access to the team that this envelope is associated with' },
          403,
        );
      }

      if (!envelopeItem.documentData) {
        return c.json({ error: 'Document data not found' }, 404);
      }

      return await handleEnvelopeItemFileRequest({
        title: envelopeItem.title,
        status: envelope.status,
        documentData: envelopeItem.documentData,
        version,
        isDownload: true,
        context: c,
      });
    },
  )
  .get(
    '/token/:token/envelopeItem/:envelopeItemId',
    sValidator('param', ZGetEnvelopeItemFileTokenRequestParamsSchema),
    async (c) => {
      const { token, envelopeItemId } = c.req.valid('param');

      let envelopeWhereQuery: Prisma.EnvelopeItemWhereUniqueInput = {
        id: envelopeItemId,
        envelope: {
          recipients: {
            some: {
              token,
            },
          },
        },
      };

      if (token.startsWith('qr_')) {
        envelopeWhereQuery = {
          id: envelopeItemId,
          envelope: {
            qrToken: token,
          },
        };
      }

      // Performance timing: Database query (token-based view)
      const DB_QUERY_START_3 = Date.now();
      const queryRequestId3 = c.req.header('x-request-id') || c.req.header('fly-request-id') || 'unknown';
      console.log(`[PERF] [${queryRequestId3}] DB query started (token view): item ${envelopeItemId}`);

      const envelopeItem = await prisma.envelopeItem.findUnique({
        where: envelopeWhereQuery,
        include: {
          envelope: true,
          documentData: true,
        },
      });

      const DB_QUERY_TIME_3 = Date.now();
      console.log(`[PERF] [${queryRequestId3}] DB query completed (token view) in ${DB_QUERY_TIME_3 - DB_QUERY_START_3}ms`);

      if (!envelopeItem) {
        return c.json({ error: 'Envelope item not found' }, 404);
      }

      if (!envelopeItem.documentData) {
        return c.json({ error: 'Document data not found' }, 404);
      }

      return await handleEnvelopeItemFileRequest({
        title: envelopeItem.title,
        status: envelopeItem.envelope.status,
        documentData: envelopeItem.documentData,
        version: 'signed',
        isDownload: false,
        context: c,
      });
    },
  )
  .get(
    '/token/:token/envelopeItem/:envelopeItemId/download/:version?',
    sValidator('param', ZGetEnvelopeItemFileTokenDownloadRequestParamsSchema),
    async (c) => {
      const { token, envelopeItemId, version } = c.req.valid('param');

      let envelopeWhereQuery: Prisma.EnvelopeItemWhereUniqueInput = {
        id: envelopeItemId,
        envelope: {
          recipients: {
            some: {
              token,
            },
          },
        },
      };

      if (token.startsWith('qr_')) {
        envelopeWhereQuery = {
          id: envelopeItemId,
          envelope: {
            qrToken: token,
          },
        };
      }

      // Performance timing: Database query (token-based download)
      const DB_QUERY_START_4 = Date.now();
      const queryRequestId4 = c.req.header('x-request-id') || c.req.header('fly-request-id') || 'unknown';
      console.log(`[PERF] [${queryRequestId4}] DB query started (token download): item ${envelopeItemId}`);

      const envelopeItem = await prisma.envelopeItem.findUnique({
        where: envelopeWhereQuery,
        include: {
          envelope: true,
          documentData: true,
        },
      });

      const DB_QUERY_TIME_4 = Date.now();
      console.log(`[PERF] [${queryRequestId4}] DB query completed (token download) in ${DB_QUERY_TIME_4 - DB_QUERY_START_4}ms`);

      if (!envelopeItem) {
        return c.json({ error: 'Envelope item not found' }, 404);
      }

      if (!envelopeItem.documentData) {
        return c.json({ error: 'Document data not found' }, 404);
      }

      return await handleEnvelopeItemFileRequest({
        title: envelopeItem.title,
        status: envelopeItem.envelope.status,
        documentData: envelopeItem.documentData,
        version,
        isDownload: true,
        context: c,
      });
    },
  );
