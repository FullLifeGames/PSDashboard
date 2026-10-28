import { ENGINE_PROTOCOL, type EngineRequest, type EngineResponse } from './protocol.ts';

export type EngineCheck = { ok: true; response: EngineResponse } | { ok: false; errors: string[] };

const inRange = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= -1 && value <= 1;

/** The side's values: one per option, nothing else, each on the scale. */
function valueErrors(side: 'p1' | 'p2', ids: string[], values: unknown): string[] {
  if (!values || typeof values !== 'object') return [`values.${side} must be an object of option id to value`];
  const record = values as Record<string, unknown>;
  const known = new Set(ids);
  return [
    ...ids.filter(id => !(id in record)).map(id => `values.${side} lacks option "${id}"`),
    ...Object.keys(record).filter(id => !known.has(id)).map(id => `values.${side} names "${id}", which is no option`),
    ...ids.filter(id => id in record && !inRange(record[id])).map(id => `values.${side}["${id}"] must be a number from -1 to 1`),
  ];
}

/** The optional matrix: every option of each side once, and a full grid of values on the scale. */
function matrixErrors(request: EngineRequest, matrix: unknown): string[] {
  if (matrix === undefined) return [];
  if (!matrix || typeof matrix !== 'object') return ['matrix must be an object with p1, p2 and values'];
  const { p1, p2, values } = matrix as { p1?: unknown; p2?: unknown; values?: unknown };
  const sameSet = (list: unknown, ids: string[]) => Array.isArray(list) && list.length === ids.length
    && new Set(list).size === ids.length && ids.every(id => list.includes(id));
  const errors: string[] = [];
  if (!sameSet(p1, request.options.p1.map(option => option.id))) errors.push('matrix.p1 must list every p1 option once');
  if (!sameSet(p2, request.options.p2.map(option => option.id))) errors.push('matrix.p2 must list every p2 option once');
  if (errors.length > 0) return errors;
  const rows = (p1 as string[]).length;
  const columns = (p2 as string[]).length;
  const grid = Array.isArray(values) && values.length === rows
    && values.every(row => Array.isArray(row) && row.length === columns && row.every(inRange));
  return grid ? [] : ['matrix.values must have one row per matrix.p1 entry and one column per matrix.p2 entry, each from -1 to 1'];
}

/**
 * The checks every answer passes before the dashboard reads it; the conformance tool (check-engine)
 * runs the same ones, so an engine that passes there is read here.
 */
export function validateEngineResponse(request: EngineRequest, value: unknown): EngineCheck {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, errors: ['the answer must be a JSON object'] };
  const response = value as Partial<EngineResponse>;
  if (response.protocol !== ENGINE_PROTOCOL) return { ok: false, errors: [`protocol must be "${ENGINE_PROTOCOL}"`] };
  const errors = [
    ...(inRange(response.score) ? [] : ['score must be a number from -1 to 1']),
    ...valueErrors('p1', request.options.p1.map(option => option.id), response.values?.p1),
    ...valueErrors('p2', request.options.p2.map(option => option.id), response.values?.p2),
    ...matrixErrors(request, response.matrix),
  ];
  return errors.length === 0 ? { ok: true, response: value as EngineResponse } : { ok: false, errors };
}
