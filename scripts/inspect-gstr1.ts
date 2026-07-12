import fs from 'fs';
import * as XLSX from 'xlsx';
const buf = fs.readFileSync('/mnt/user-uploads/GSTR1_WITH_AI-3.xlsx');
const wb = XLSX.read(buf, { type:'buffer' });
for (const n of ['Help Instruction','master']) {
  const s = wb.Sheets[n];
  if (!s) continue;
  const rows = XLSX.utils.sheet_to_json(s,{header:1});
  console.log('===',n);
  console.log(JSON.stringify(rows.slice(0,20)));
}
