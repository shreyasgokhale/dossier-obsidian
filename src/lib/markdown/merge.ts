import type { Values } from "./profile";
export type Conflict = {
  field: string;
  base?: string;
  app?: string;
  file?: string;
};
/** Missing is distinct from empty; missing mapped fields never erase database values. */
export function mergeValues(
  base: Values,
  app: Values,
  file: Values,
): { values: Values; conflicts: Conflict[] } {
  const values: Values = { ...app };
  const conflicts: Conflict[] = [];
  for (const key of new Set([
    ...Object.keys(base),
    ...Object.keys(app),
    ...Object.keys(file),
  ]) as Set<keyof Values>) {
    if (file[key] === undefined) continue;
    if (app[key] === file[key]) continue;
    if (app[key] === base[key]) values[key] = file[key];
    else if (file[key] !== base[key])
      conflicts.push({
        field: key,
        base: base[key],
        app: app[key],
        file: file[key],
      });
  }
  return { values, conflicts };
}
