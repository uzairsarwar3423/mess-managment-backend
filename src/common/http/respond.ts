import type { Response } from 'express';

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export function buildMeta(page: number, limit: number, total: number): PageMeta {
  return { page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)) };
}

export function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ success: true, data });
}

export function created<T>(res: Response, data: T): void {
  ok(res, data, 201);
}

export function paginated<T>(res: Response, data: T[], meta: PageMeta | (PageMeta & object)): void {
  res.status(200).json({ success: true, data, meta });
}
