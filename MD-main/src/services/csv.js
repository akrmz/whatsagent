"use strict";

/**
 * A small CSV reader for imports: quoted fields with commas, quotes ("") and line breaks,
 * \r\n or \n, a UTF-8 byte-order mark (Excel), and ";" as the separator when Excel uses it
 * (common with Arabic/European regional settings). Empty rows are dropped, but each row
 * keeps the line number it starts on, so problems can be reported as in the spreadsheet.
 * @returns {Array<string[] & { line: number }>} rows of cells
 */
function parse(text, { maxRows = 2000 } = {}) {
  let s = String(text || "");
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const end = s.search(/\r?\n/);
  const firstLine = end === -1 ? s : s.slice(0, end);
  // The separator the header uses most: "," (CSV), ";" (Excel with Arabic/European settings) or a tab (Meta's lead exports).
  const count = (ch) => firstLine.split(ch).length - 1;
  const sep = [",", ";", "\t"].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ",");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const endRow = () => {
    row.push(cell);
    cell = "";
    if (row.some((x) => x.trim() !== "")) rows.push(Object.defineProperty(row.map((x) => x.trim()), "line", { value: rowLine, enumerable: false }));
    row = [];
  };
  for (let i = 0; i < s.length && rows.length <= maxRows; i++) {
    const c = s[i];
    if (c === "\n") line++;
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") {
        i++;
        line++;
      }
      endRow();
      rowLine = line;
    } else cell += c;
  }
  if (rows.length <= maxRows) endRow();
  return rows;
}

/** Rows → objects keyed by the header row (keys lower-cased, spaces → "_"); `line` is the spreadsheet row. */
function records(text, opts) {
  const [header, ...rows] = parse(text, opts);
  if (!header) return { header: [], rows: [] };
  const keys = header.map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  return {
    header: keys,
    rows: rows.map((r) => Object.defineProperty(Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])), "line", { value: r.line, enumerable: false })),
  };
}

/**
 * A downloaded file's bytes as text: UTF-16 (Meta's lead exports, Excel's "Unicode text") by
 * its byte-order mark, or by its many zero bytes; otherwise UTF-8.
 */
function decode(buffer) {
  const b = Buffer.from(buffer);
  if (b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString("utf16le");
  if (b[0] === 0xfe && b[1] === 0xff) return Buffer.from(b.subarray(2)).swap16().toString("utf16le");
  const sample = b.subarray(0, 400);
  const zeros = sample.filter((x) => x === 0).length;
  if (sample.length >= 4 && zeros > sample.length / 4) return (sample[0] === 0 ? Buffer.from(b.subarray(0, b.length - (b.length % 2))).swap16() : b).toString("utf16le");
  return b.toString("utf8");
}

module.exports = { parse, records, decode };
