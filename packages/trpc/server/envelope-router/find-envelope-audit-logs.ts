import { findEnvelopeAuditLogs } from '@documenso/lib/server-only/document/find-document-audit-logs';

import { authenticatedProcedure } from '../trpc';
import {
  ZFindEnvelopeAuditLogsRequestSchema,
  ZFindEnvelopeAuditLogsResponseSchema,
  findEnvelopeAuditLogsMeta,
} from './find-envelope-audit-logs.types';

export const findEnvelopeAuditLogsRoute = authenticatedProcedure
  .meta(findEnvelopeAuditLogsMeta)
  .input(ZFindEnvelopeAuditLogsRequestSchema)
  .output(ZFindEnvelopeAuditLogsResponseSchema)
  .query(async ({ input, ctx }) => {
    const { teamId } = ctx;

    const {
      page,
      perPage,
      envelopeId,
      cursor,
      filterForRecentActivity,
      orderByColumn,
      orderByDirection,
    } = input;

    ctx.logger.info({
      input: {
        envelopeId,
      },
    });

    return await findEnvelopeAuditLogs({
      userId: ctx.user.id,
      teamId,
      page,
      perPage,
      envelopeId,
      cursor,
      filterForRecentActivity,
      orderBy: orderByColumn ? { column: orderByColumn, direction: orderByDirection } : undefined,
    });
  });
