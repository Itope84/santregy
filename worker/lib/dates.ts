// Calendar-date helpers. Always UTC (matches the app's v1 UTC-only timezone policy) and
// always 'YYYY-MM-DD' strings on the wire so there is no timezone-parsing ambiguity.

export function formatDate(y: number, m0: number, d: number): string {
  const dt = new Date(Date.UTC(y, m0, d));
  const yyyy = dt.getUTCFullYear().toString().padStart(4, "0");
  const mm = (dt.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = dt.getUTCDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function parseDate(dateStr: string): { y: number; m0: number; d: number } {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { y, m0: m - 1, d };
}

/**
 * Subtract `months` calendar months from `dateStr`, clamping the day to the last day of the
 * target month when the original day doesn't exist there (e.g. Mar 31 - 1mo -> Feb 28/29).
 */
export function subtractMonths(dateStr: string, months: number): string {
  const { y, m0, d } = parseDate(dateStr);
  const targetIndex = m0 - months;
  const year = y + Math.floor(targetIndex / 12);
  const month = ((targetIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, daysInTargetMonth);
  return formatDate(year, month, day);
}

export function addDays(dateStr: string, days: number): string {
  const { y, m0, d } = parseDate(dateStr);
  const dt = new Date(Date.UTC(y, m0, d + days));
  return formatDate(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
}

export function isWeekend(dateStr: string): boolean {
  const { y, m0, d } = parseDate(dateStr);
  const day = new Date(Date.UTC(y, m0, d)).getUTCDay();
  return day === 0 || day === 6;
}

export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/**
 * Does a user's anniversary (stored as 'MM-DD') fall on `todayDateStr` ('YYYY-MM-DD', UTC)?
 * Feb 29 anniversaries fire on Feb 28 in non-leap years.
 */
export function isAnniversaryToday(anniversaryMMDD: string, todayDateStr: string): boolean {
  const { y: todayY, m0: todayM0, d: todayD } = parseDate(`${todayDateStr}`);
  const todayMMDD = `${(todayM0 + 1).toString().padStart(2, "0")}-${todayD.toString().padStart(2, "0")}`;

  if (anniversaryMMDD === "02-29") {
    return isLeapYear(todayY) ? todayMMDD === "02-29" : todayMMDD === "02-28";
  }
  return todayMMDD === anniversaryMMDD;
}

export function currentAnniversaryYear(todayDateStr: string): number {
  return parseDate(todayDateStr).y;
}
