import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

/** Assigns a correlation id (re-using a sane incoming X-Request-Id) and echoes it back. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
};
