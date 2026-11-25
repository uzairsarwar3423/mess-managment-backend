import { pinoHttp } from 'pino-http';
import { logger } from '../../lib/logger';

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => (req as unknown as { requestId: string }).requestId,
  customProps: (req) => {
    const auth = (req as unknown as { auth?: { userId: string; role: string } }).auth;
    return auth ? { user_id: auth.userId, role: auth.role } : {};
  },
  // Log the path only: query strings may carry identifiers we prefer not to keep.
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: String(req.url).split('?')[0] }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  autoLogging: { ignore: (req) => req.url === '/health' },
});
