/**
 * The values of a closed vocabulary as the list of a `CHECK (column IN (…))` constraint: one helper
 * for every schema (audit TR-9). The SQL it writes is the one the migrations already hold.
 */
export const inList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");
