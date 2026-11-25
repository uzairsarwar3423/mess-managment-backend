/** Converts page/limit into an inclusive Supabase `.range(from, to)`. */
export function toRange(page: number, limit: number): { from: number; to: number } {
  const from = (page - 1) * limit;
  return { from, to: from + limit - 1 };
}
