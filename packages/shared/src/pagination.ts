export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface PaginationParams {
  limit: number;
  offset: number;
}

export function buildPaginationSql(
  baseQuery: string,
  params: PaginationParams,
): { dataSql: string; countSql: string; dataParams: any[]; countParams: any[] } {
  const dataSql = `${baseQuery} LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) as total FROM (${baseQuery})`;
  const dataParams: any[] = [];
  const countParams: any[] = [];

  return {
    dataSql,
    countSql,
    dataParams: [...dataParams, params.limit, params.offset],
    countParams,
  };
}

export function paginate<T>(
  data: T[],
  total: number,
  params: PaginationParams,
): PaginatedResponse<T> {
  return {
    data,
    total,
    limit: params.limit,
    offset: params.offset,
    hasMore: params.offset + data.length < total,
  };
}
