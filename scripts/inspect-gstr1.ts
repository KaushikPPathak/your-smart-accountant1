import fs from 'fs';
import { readSpreadsheet, sheetRows } from '../src/lib/spreadsheet';

async function main() {
  const buf = fs.readFileSync('/mnt/user-uploads/GSTR1_WITH_AI-3.xlsx');
  const wb = await readSpreadsheet(buf);
  for (const n of ['Help Instruction','master']) {
    const s = wb.Sheets[n];
    if (!s) continue;
    const rows = sheetRows(s);
    console.log('===',n);
    console.log(JSON.stringify(rows.slice(0,20)));
  }
}

main();
