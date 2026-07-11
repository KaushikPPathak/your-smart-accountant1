## Goal
Convert `GSTR1_WITH_AI.xlsx` (standard GSTN Offline-Tool workbook) into a single GSTR-1 JSON file that is directly uploadable at gst.gov.in → Returns → GSTR-1 → Prepare Offline → Upload.

## Inputs (confirmed)
- Supplier GSTIN: `24EAIPS7135C1ZP`
- Supplier state code: `24` (Gujarat)
- Return period: Q1 2026-27 → FP `062026` (quarterly GSTR-1 is filed with the last month of the quarter, i.e. June)
- Filing type: `QRTR` (quarterly)
- Version: `GST3.2.6` (current GSTN Offline-Tool schema)

## Sheets that will be parsed
From your workbook (non-empty sections detected):
- `b2b,sez,de` → **b2b** section (Regular B2B / SEZWP / SEZWOP / DE grouped by GSTIN → invoice → rate lines)
- `b2cs` → **b2cs** section (OE/E split by POS × Rate)
- `hsn(b2b)` + `hsn(b2c)` → **hsn.data** merged
- `docs` → **doc_issue** section
- `b2cl`, `cdnr`, `cdnur`, `exp`, `exemp`, `at`, `atadj`, and all `*a` amendment sheets → included when non-empty (currently empty in your file, so they'll be omitted)

## Output shape (GSTN v3.2.6 schema)
```json
{
  "gstin": "24EAIPS7135C1ZP",
  "fp": "062026",
  "filing_type": "QRTR",
  "version": "GST3.2.6",
  "hash": "hash",
  "b2b":  [ { "ctin": "...", "inv": [ { "inum","idt","val","pos","rchrg","inv_typ","itms":[{"num","itm_det":{"rt","txval","iamt","camt","samt","csamt"}}] } ] } ],
  "b2cs": [ { "sply_ty","pos","typ","rt","txval","iamt","camt","samt","csamt" } ],
  "hsn":  { "data": [ { "num","hsn_sc","desc","uqc","qty","rt","txval","iamt","camt","samt","csamt","val" } ] },
  "doc_issue": { "doc_det": [ { "doc_num": 1, "docs":[{ "num","from","to","totnum","cancel","net_issue" }] } ] }
}
```
- Intra vs inter-state tax split is derived from `POS vs supplier state = 24`: intra → CGST+SGST, inter → IGST.
- POS is normalised to the 2-digit code (e.g. `"24-Gujarat"` → `"24"`).
- Dates are normalised to `dd-mm-yyyy`.
- Rounding: 2 dp on all amounts.

## Deliverable
A single file written to `/mnt/documents/GSTR1_24EAIPS7135C1ZP_062026.json`, ready for direct upload to the GST portal. I'll also print a one-line summary (B2B invoices, B2CS rows, HSN rows, DOCS rows, totals) so you can eyeball-verify before uploading.

## Not in scope
- No changes to app source code — this is a one-off conversion of your uploaded file. If you later want a permanent in-app "Import Offline Excel → JSON" button, that's a separate task.
