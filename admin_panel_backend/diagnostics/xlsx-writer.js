'use strict';

/**
 * Minimal, zero-dependency .xlsx writer.
 *
 * Produces a valid OOXML spreadsheet (a ZIP of XML parts) without pulling in
 * exceljs / SheetJS — kept tiny on purpose since it only needs to dump audit
 * tables. Strings are written as inline strings (no shared-strings table) and
 * numbers as numeric cells; everything else is stringified.
 *
 *   const { writeXlsx } = require('./xlsx-writer');
 *   const buf = writeXlsx([{ name: 'Summary', rows: [['A','B'], [1, 2]] }]);
 *   fs.writeFileSync('out.xlsx', buf);
 *
 * `rows` is an array of arrays; each inner array is one row of cell values.
 */

const zlib = require('zlib');

// ---- CRC32 (for the ZIP container) ----------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- ZIP (deflate, no zip64; fine for our small files) --------------------
function zip(entries) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const raw = e.data;
    const crc = crc32(raw);
    const comp = zlib.deflateRawSync(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header sig
    local.writeUInt16LE(20, 4);         // version needed
    local.writeUInt16LE(0, 6);          // flags
    local.writeUInt16LE(8, 8);          // method = deflate
    local.writeUInt16LE(0, 10);         // mod time
    local.writeUInt16LE(0x21, 12);      // mod date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);         // extra len
    localChunks.push(local, nameBuf, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);    // central dir header sig
    cd.writeUInt16LE(20, 4);            // version made by
    cd.writeUInt16LE(20, 6);            // version needed
    cd.writeUInt16LE(0, 8);             // flags
    cd.writeUInt16LE(8, 10);            // method
    cd.writeUInt16LE(0, 12);            // mod time
    cd.writeUInt16LE(0x21, 14);         // mod date
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);            // extra len
    cd.writeUInt16LE(0, 32);            // comment len
    cd.writeUInt16LE(0, 34);            // disk number start
    cd.writeUInt16LE(0, 36);            // internal attrs
    cd.writeUInt32LE(0, 38);            // external attrs
    cd.writeUInt32LE(offset, 42);       // local header offset
    centralChunks.push(cd, nameBuf);

    offset += 30 + nameBuf.length + comp.length;
  }

  const central = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);    // end of central dir sig
  eocd.writeUInt16LE(0, 4);             // disk number
  eocd.writeUInt16LE(0, 6);             // disk with cd start
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);       // cd offset
  eocd.writeUInt16LE(0, 20);            // comment len

  return Buffer.concat([...localChunks, central, eocd]);
}

// ---- XML helpers -----------------------------------------------------------
// Strip control chars Excel rejects (keep tab \t, LF \n, CR \r).
const CONTROL_CHARS = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]', 'g');
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(CONTROL_CHARS, '');
}

function colLetter(i) { // 0-based -> A, B, ... Z, AA, ...
  let n = i + 1, s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function cellXml(ref, v) {
  if (v === null || v === undefined || v === '') return `<c r="${ref}"/>`;
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
  if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

function sheetXml(rows) {
  const body = rows.map((row, ri) =>
    `<row r="${ri + 1}">${row.map((v, ci) => cellXml(colLetter(ci) + (ri + 1), v)).join('')}</row>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

// Excel sheet names: <=31 chars, none of : \ / ? * [ ]
function sanitizeSheetName(name, idx) {
  const s = String(name || `Sheet${idx + 1}`).replace(/[:\\/?*[\]]/g, ' ').slice(0, 31).trim();
  return s || `Sheet${idx + 1}`;
}

/**
 * @param {{name: string, rows: Array<Array<any>>}[]} sheets
 * @returns {Buffer} xlsx file bytes
 */
function writeXlsx(sheets) {
  if (!Array.isArray(sheets) || !sheets.length) sheets = [{ name: 'Sheet1', rows: [[]] }];
  const names = sheets.map((s, i) => sanitizeSheetName(s.name, i));

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    `</Types>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
    `</workbook>`;

  const wbRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `</Relationships>`;

  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rootRels, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbook, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(wbRels, 'utf8') },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: Buffer.from(sheetXml(s.rows || []), 'utf8') })),
  ];

  return zip(entries);
}

module.exports = { writeXlsx };
