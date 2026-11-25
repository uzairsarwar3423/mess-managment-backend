import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

interface Schemas {
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
}

/**
 * Validates params / query / body with zod. Parsed (and coerced) values are placed on `req.valid`;
 * controllers must read from there, never from the raw request. Zod errors reach the central
 * error handler, which turns them into VALIDATION_ERROR.
 *
 * Body schemas should be `.strict()` so unknown fields (role, amount, status...) are rejected.
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    try {
      req.valid = {
        params: (schemas.params ? schemas.params.parse(req.params) : {}) as Record<string, unknown>,
        query: (schemas.query ? schemas.query.parse(req.query) : {}) as Record<string, unknown>,
        body: (schemas.body ? schemas.body.parse(req.body ?? {}) : {}) as Record<string, unknown>,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}
