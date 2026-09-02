import type { UniverseConstituent } from "../types";

const CONSTITUENTS_URL =
  "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv";

/** Normalize a ticker so GitHub-CSV and Polygon symbols always join correctly
 * (case, stray whitespace) even though both sources use the same dot notation
 * for share classes, e.g. "BRK.B". */
export function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

/** Current S&P 500 constituents (ticker, name, GICS sector) from a community-maintained,
 * weekly-refreshed GitHub CSV — free, keyless, and reachable without a finance API budget. */
export async function fetchConstituents(): Promise<UniverseConstituent[]> {
  const res = await fetch(CONSTITUENTS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch S&P 500 constituents: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const [header, ...rows] = lines;
  const columns = parseCsvLine(header);
  const symbolIdx = columns.indexOf("Symbol");
  const nameIdx = columns.indexOf("Security");
  const sectorIdx = columns.indexOf("GICS Sector");
  if (symbolIdx === -1 || nameIdx === -1 || sectorIdx === -1) {
    throw new Error("Unexpected constituents CSV format: missing expected columns");
  }

  return rows.map((line) => {
    const cols = parseCsvLine(line);
    return {
      ticker: normalizeTicker(cols[symbolIdx]),
      name: cols[nameIdx],
      sector: cols[sectorIdx],
    };
  });
}
