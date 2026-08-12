import fs from 'fs';
import * as XLSX from 'xlsx';
import { convertGstr1Xlsx, fpFromMonth, fpFromQuarter } from '../src/lib/gstr1-xlsx-to-json';

const input = process.argv[2];
const buf = fs.readFileSync(input);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const wb = XLSX.read(ab, { type: 'array' });
console.error('Sheets:', wb.SheetNames);
for (const name of ['profile','Profile','help','Help']) {
  const s = wb.Sheets[name];
  if (s) {
    const rows = XLSX.utils.sheet_to_json(s, {header:1});
    console.error(name, JSON.stringify(rows.slice(0,15)));
  }
}
const gstin = process.argv[3] || '24EAIPS7135C1ZP';
const fp = process.argv[4] || '062026';
const r = convertGstr1Xlsx(ab, { gstin, fp });
console.error('Summary:', r.summary);
console.error('Warnings:', r.warnings);
fs.writeFileSync(process.argv[5] || '/tmp/gstr1.json', JSON.stringify(r.json));
