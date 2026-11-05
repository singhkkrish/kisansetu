import Decimal from "decimal.js";

/**
 * MOCK BANK PAYMENT FILE
 *
 * This is KisanSetu's own simple CSV layout for a bulk payment instruction. It
 * has NOT been checked against any real bank's specification and must not be
 * uploaded to a bank. Each bank publishes its own bulk-upload format (columns,
 * order, character limits, file naming); before real use, the format below has
 * to be replaced with the one the Producer Company's bank gives in writing.
 * See docs/mock-bank-format.md.
 */

export const BANK_COLUMNS = [
  "beneficiary_name",
  "account_number",
  "ifsc",
  "amount",
  "payment_ref",
  "payment_run_id",
  "farmer_id",
] as const;
export type BankColumn = (typeof BANK_COLUMNS)[number];

export interface BankFileConfig {
  columns: readonly BankColumn[];
  delimiter: "," | ";" | "|" | "\t";
  includeHeader: boolean;
}

/** The documented default layout: the six fields the brief asks for. */
export const DEFAULT_BANK_FILE_CONFIG: BankFileConfig = {
  columns: ["beneficiary_name", "account_number", "ifsc", "amount", "payment_ref", "payment_run_id"],
  delimiter: ",",
  includeHeader: true,
};

export interface BankFileRow {
  beneficiaryName: string;
  accountNumber: string;
  ifsc: string;
  /** Exact decimal string. */
  amount: string;
  paymentRef: string;
  /** The run's number, e.g. PR-20261105-001. */
  runNo: string;
  farmerCode: string;
}

const DELIMITERS = new Map<string, BankFileConfig["delimiter"]>([
  ["comma", ","],
  ["semicolon", ";"],
  ["pipe", "|"],
  ["tab", "\t"],
]);

/**
 * Reads the layout from the environment, falling back to the default on any
 * unknown value rather than producing a file nobody expects:
 *   BANK_FILE_COLUMNS   comma separated column names, in order
 *   BANK_FILE_DELIMITER comma | semicolon | pipe | tab
 *   BANK_FILE_HEADER    true | false
 */
export function loadBankFileConfig(env: Record<string, string | undefined> = process.env): BankFileConfig {
  const config: BankFileConfig = { ...DEFAULT_BANK_FILE_CONFIG };

  const rawColumns = env.BANK_FILE_COLUMNS?.split(",").map((c) => c.trim()).filter(Boolean);
  if (
    rawColumns &&
    rawColumns.length > 0 &&
    new Set(rawColumns).size === rawColumns.length &&
    rawColumns.every((c): c is BankColumn => (BANK_COLUMNS as readonly string[]).includes(c))
  ) {
    config.columns = rawColumns;
  }
  const delimiter = DELIMITERS.get((env.BANK_FILE_DELIMITER ?? "").trim().toLowerCase());
  if (delimiter) config.delimiter = delimiter;
  if (env.BANK_FILE_HEADER === "false") config.includeHeader = false;
  return config;
}

/**
 * One CSV field. Quotes a value that contains the delimiter, a quote or a line
 * break. A value that starts with a character a spreadsheet would treat as a
 * formula (= + - @) is prefixed with an apostrophe so opening the file in Excel
 * cannot run it; legitimate values never start with those characters.
 */
export function csvField(value: string, delimiter: string): string {
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (text.includes(delimiter) || /["\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function cell(column: BankColumn, row: BankFileRow): string {
  switch (column) {
    case "beneficiary_name":
      return row.beneficiaryName;
    case "account_number":
      return row.accountNumber;
    case "ifsc":
      return row.ifsc;
    case "amount":
      return new Decimal(row.amount).toFixed(2);
    case "payment_ref":
      return row.paymentRef;
    case "payment_run_id":
      return row.runNo;
    case "farmer_id":
      return row.farmerCode;
  }
}

export interface BankFile {
  content: string;
  rowCount: number;
  total: string;
}

/**
 * Builds the CSV. Rows are ordered by payment reference so the same run always
 * produces the same file. Lines end with CRLF, amounts use a dot and two
 * decimals with no thousands separator, and account numbers are plain digits.
 */
export function buildBankFile(rows: readonly BankFileRow[], config: BankFileConfig = DEFAULT_BANK_FILE_CONFIG): BankFile {
  const ordered = [...rows].sort((a, b) => a.paymentRef.localeCompare(b.paymentRef));
  const lines: string[] = [];
  if (config.includeHeader) lines.push(config.columns.map((c) => csvField(c, config.delimiter)).join(config.delimiter));
  for (const row of ordered) {
    lines.push(config.columns.map((c) => csvField(cell(c, row), config.delimiter)).join(config.delimiter));
  }
  const total = ordered.reduce((t, r) => t.plus(r.amount), new Decimal(0)).toFixed(2);
  return { content: lines.join("\r\n") + "\r\n", rowCount: ordered.length, total };
}
