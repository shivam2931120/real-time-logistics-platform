export interface BulkOrderCandidate {
  rowNumber: number;
  customerName: string;
  customerEmail: string;
  pickupLabel: string;
  pickupLat: string;
  pickupLng: string;
  dropoffLabel: string;
  dropoffLat: string;
  dropoffLng: string;
  packageWeightKg: string;
  priority: string;
  amount: string;
  currency: string;
  promisedAt: string;
  deliveryWindowStart?: string;
  deliveryNotes?: string;
  parcelCode?: string;
  recipientPin?: string;
}

export interface BulkOrderIssue {
  row: number;
  field?: string;
  message: string;
}

const normalize = (value: string) =>
  value.trim().toLowerCase().replace(/[\s-]+/g, "_");

const aliases: Record<string, keyof BulkOrderCandidate> = {
  customer_name: "customerName",
  customer: "customerName",
  customer_email: "customerEmail",
  email: "customerEmail",
  pickup_label: "pickupLabel",
  pickup_address: "pickupLabel",
  pickup_lat: "pickupLat",
  pickup_latitude: "pickupLat",
  pickup_lng: "pickupLng",
  pickup_lon: "pickupLng",
  pickup_longitude: "pickupLng",
  dropoff_label: "dropoffLabel",
  dropoff_address: "dropoffLabel",
  dropoff_lat: "dropoffLat",
  dropoff_latitude: "dropoffLat",
  dropoff_lng: "dropoffLng",
  dropoff_lon: "dropoffLng",
  dropoff_longitude: "dropoffLng",
  package_weight_kg: "packageWeightKg",
  weight_kg: "packageWeightKg",
  weight: "packageWeightKg",
  priority: "priority",
  amount: "amount",
  currency: "currency",
  promised_at: "promisedAt",
  delivery_deadline: "promisedAt",
  delivery_window_start: "deliveryWindowStart",
  delivery_notes: "deliveryNotes",
  parcel_code: "parcelCode",
  recipient_pin: "recipientPin",
};

function parseCsv(input: string): string[][] {
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
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some((value) => value.length)) rows.push(row);
      row = [];
    } else {
      cell += character;
    }
  }
  if (cell.length || row.length) {
    row.push(cell.trim());
    if (row.some((value) => value.length)) rows.push(row);
  }
  return rows;
}

export function parseBulkOrderCsv(csv: string) {
  if (csv.length > 100_000) throw new Error("Order CSV must be 100 KB or smaller");
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new Error("Order CSV must contain a header and at least one row");
  if (rows.length > 201) throw new Error("Order CSV may contain at most 200 rows");
  const headers = rows[0]!.map(normalize);
  const mapped = headers.map((header) => aliases[header]);
  const required: Array<keyof BulkOrderCandidate> = [
    "customerName", "customerEmail", "pickupLabel", "pickupLat", "pickupLng",
    "dropoffLabel", "dropoffLat", "dropoffLng", "packageWeightKg", "priority",
    "amount", "currency", "promisedAt",
  ];
  const missing = required.filter((key) => !mapped.includes(key));
  if (missing.length) throw new Error(`Order CSV is missing columns: ${missing.join(", ")}`);
  const candidates: BulkOrderCandidate[] = [];
  const issues: BulkOrderIssue[] = [];
  for (const [index, values] of rows.slice(1).entries()) {
    const rowNumber = index + 2;
    const candidate = { rowNumber } as BulkOrderCandidate;
    mapped.forEach((key, column) => {
      if (key) (candidate as unknown as Record<string, string>)[key] = values[column] || "";
    });
    const empty = required.find((key) => !String(candidate[key] || "").trim());
    if (empty) {
      issues.push({ row: rowNumber, field: empty, message: "Required value is missing" });
      continue;
    }
    candidates.push(candidate);
  }
  return { candidates, issues, totalRows: rows.length - 1 };
}
