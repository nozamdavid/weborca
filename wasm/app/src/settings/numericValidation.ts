import type { ConfigOptionDef } from '../engine/types';

/** Basic scalar checks only; native validation still owns option relationships. */
export function validNumericValue(value: string, def?: ConfigOptionDef): boolean {
  if (!def || !/^(int|float|percent|floatOrPercent)$/.test(def.type)) return true;
  const percent = /percent|OrPercent/.test(def.type);
  const pattern = percent ? /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?%?$/ : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  const number = Number(value.replace(/%$/, ''));
  return pattern.test(value) && Number.isFinite(number) &&
    (def.type !== 'int' || Number.isInteger(number)) &&
    number >= (def.min ?? -Infinity) && number <= (def.max ?? Infinity);
}

export function commitNumericValue(value: string, def: ConfigOptionDef | undefined, commit: (value: string) => void): void {
  if (value.trim() && validNumericValue(value, def)) commit(value);
}
