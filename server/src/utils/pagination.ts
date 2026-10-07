import { z } from 'zod'

export interface Pagination {
  page: number
  limit: number
  offset: number
}

export interface PaginatedMeta {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface Paginated<T> {
  data: T[]
  meta: PaginatedMeta
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export function toPagination(query: { page: number; limit: number }): Pagination {
  return { ...query, offset: (query.page - 1) * query.limit }
}

export function paginated<T>(data: T[], total: number, page: number, limit: number): Paginated<T> {
  return {
    data,
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  }
}

export function paginate<T>(
  rows: T[],
  total: number,
  pagination: Pagination,
): Paginated<T> {
  return paginated(rows, total, pagination.page, pagination.limit)
}
