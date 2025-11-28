# Prisma Connection Pool Timeout Fix

## Problem

Documenso was experiencing connection pool timeouts when creating documents:

```
PrismaClientKnownRequestError:
Invalid `prisma.webhook.findMany()` invocation:
Timed out fetching a new connection from the connection pool. 
More info: http://pris.ly/d/connection-pool 
(Current connection pool timeout: 10, connection limit: 1)
```

### Root Cause

1. **Default Prisma pool size is 1 connection** - This is insufficient for concurrent operations
2. **Transaction blocking** - When `createEnvelope` runs a transaction, it holds the single connection
3. **Webhook queries timeout** - `triggerWebhook` tries to query `webhook.findMany()` but can't get a connection because it's locked in the transaction
4. **10-second timeout** - Prisma's default pool timeout is too short for this scenario

### Error Flow

```
POST /api/v1/documents
  → createEnvelope() starts transaction
  → Transaction holds the single connection
  → triggerWebhook() tries to query webhooks
  → Can't get connection (it's in use by transaction)
  → Times out after 10 seconds
  → Document creation fails
```

## Solution

Increased Prisma connection pool configuration in `packages/prisma/helper.ts`:

- **connection_limit**: Increased from 1 (default) to **10**
- **pool_timeout**: Increased from 10s (default) to **20s**

This allows:
- Multiple concurrent queries during transactions
- Better handling of webhook triggers
- More resilient connection management

## Changes Made

**File**: `documenso/packages/prisma/helper.ts`

Added connection pool parameters to the database URL:
- `connection_limit=10` - Allows up to 10 concurrent connections
- `pool_timeout=20` - Increases timeout to 20 seconds

## Deployment

After deploying this fix:

1. **Restart the Documenso service** on Fly.io:
   ```bash
   fly deploy --app conecta-sign
   ```

2. **Verify the fix** by:
   - Creating a new document via API
   - Checking logs for connection pool errors
   - Confirming webhook triggers complete successfully

## Monitoring

Watch for these indicators that the fix is working:
- ✅ No more `P2024` Prisma errors in logs
- ✅ Document creation completes successfully
- ✅ Webhook triggers execute without timeouts
- ✅ No "connection pool timeout" errors

## Technical Details

### Prisma Connection Pool Parameters

Prisma supports these URL parameters for PostgreSQL:
- `connection_limit` - Maximum number of connections in the pool (default: 1)
- `pool_timeout` - Timeout in seconds for acquiring a connection (default: 10)

### Why 10 Connections?

- Allows multiple concurrent queries during transactions
- Handles webhook triggers that run in parallel
- Provides buffer for connection overhead
- Still reasonable for Neon's connection limits

### Why 20s Timeout?

- Gives more time for connections to become available
- Accounts for transaction duration
- Prevents premature timeouts during busy periods
- Still fails fast enough to detect real issues

## Related Issues

This fix addresses:
- Document creation failures
- Webhook trigger timeouts
- Transaction deadlocks
- Connection pool exhaustion

## Future Improvements

Consider:
1. **Monitoring connection pool usage** - Track connection pool metrics
2. **Dynamic pool sizing** - Adjust based on load
3. **Connection pool health checks** - Detect and recover from pool issues
4. **Separate pool for webhooks** - Isolate webhook queries from main transactions

