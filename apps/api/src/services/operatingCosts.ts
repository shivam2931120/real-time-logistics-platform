import type { OperatingCostCategory } from "@routepulse/shared";

export type OperatingCostCsvRow = {
  category: OperatingCostCategory;
  amount: number;
  currency: string;
  incurredAt: string;
  driverId?: string;
  routeRunId?: string;
  note?: string;
};

const categories = new Set<OperatingCostCategory>([
  "fuel",
  "driver",
  "toll",
  "maintenance",
  "other",
]);

const normalize = (value: string) => value.trim().toLowerCase().replace(/[\s-]+/g, "_");

function parseCsv(input: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];
    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += character;
  }
  if (cell.length || row.length) {
    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
  }
  return rows;
}

export function parseOperatingCostCsv(input: string): OperatingCostCsvRow[] {
  if (input.length > 100_000) throw new Error("Operating cost CSV must be 100 KB or smaller");
  const rows = parseCsv(input);
  if (rows.length < 2) throw new Error("Operating cost CSV needs a header and at least one row");
  if (rows.length > 501) throw new Error("Operating cost CSV may contain at most 500 rows");
  const headers = rows[0]!.map(normalize);
  for (const required of ["category", "amount", "currency", "incurred_at"])
    if (!headers.includes(required)) throw new Error(`Operating cost CSV needs a ${required} column`);
  return rows.slice(1).map((values, index) => {
    const raw = Object.fromEntries(headers.map((header, position) => [header, values[position] || ""]));
    const category = raw.category?.toLowerCase() as OperatingCostCategory;
    const amount = Number(String(raw.amount || "").replace(/[₹,]/g, ""));
    const currency = String(raw.currency || "").trim().toUpperCase();
    const date = new Date(raw.incurred_at || "");
    if (!categories.has(category) || !Number.isFinite(amount) || amount < 0 || !/^[A-Z]{3}$/.test(currency) || Number.isNaN(date.getTime()))
      throw new Error(`Invalid operating cost row ${index + 2}`);
    return {
      category,
      amount,
      currency,
      incurredAt: date.toISOString(),
      driverId: raw.driver_id?.trim() || undefined,
      routeRunId: raw.route_run_id?.trim() || undefined,
      note: raw.note?.trim() || undefined,
    };
  });
}
