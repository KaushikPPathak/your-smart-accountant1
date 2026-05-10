// Translation dictionary for printed report labels (column headers, section titles,
// totals etc). Used by the central exporter so every report's PDF/Excel output
// is rendered in the user's chosen UI language without touching each route.
import { fmtIndianDate, formatDatesInText } from "@/lib/format-date";
import { getStoredLang, type LangCode } from "@/lib/i18n";

// Source-of-truth English -> per-language map. Add entries as new labels appear.
// Lookup is case-sensitive and matches the WHOLE string, so partial sentences
// fall through unchanged (which is desirable for ledger names, free text, etc).
export const LABELS: Record<string, Partial<Record<LangCode, string>>> = {
  // ---- Report titles ----
  "Day Book": { gu: "રોજમેળ" },
  "Ledger": { gu: "ખાતાવહી" },
  "Ledger A/c": { gu: "ખાતું" },
  "Ledger Account": { gu: "ખાતું" },
  "All Ledgers": { gu: "બધાં ખાતાં" },
  "Group Ledger": { gu: "સમૂહ ખાતાવહી" },
  "Group Ledger Report": { gu: "સમૂહ ખાતાવહી" },
  "Cash Book": { gu: "રોકડ ચોપડી" },
  "Bank Book": { gu: "બેંક ચોપડી" },
  "Cash & Bank": { gu: "રોકડ અને બેંક" },
  "Cash & Bank Book": { gu: "રોકડ અને બેંક ચોપડી" },
  "Trial Balance": { gu: "કાચું સરવૈયું" },
  "Profit & Loss": { gu: "નફા-નુકસાન ખાતું" },
  "Profit and Loss": { gu: "નફા-નુકસાન ખાતું" },
  "Profit & Loss Account": { gu: "નફા-નુકસાન ખાતું" },
  "Income & Expenditure Account": { gu: "આવક-જાવક ખાતું" },
  "Balance Sheet": { gu: "પાકું સરવૈયું" },
  "Trading": { gu: "વેપાર ખાતું" },
  "Trading Account": { gu: "વેપાર ખાતું" },
  "Sales Register": { gu: "વેચાણ રજિસ્ટર" },
  "Purchase Register": { gu: "ખરીદી રજિસ્ટર" },
  "Outstanding": { gu: "બાકી લેણદેણ" },
  "Bill-by-Bill Outstanding": { gu: "બિલવાર બાકી લેણદેણ" },
  "Outstanding Receivables": { gu: "મેળવવાની બાકી રકમ" },
  "Outstanding Payables": { gu: "ચૂકવવાની બાકી રકમ" },
  "Receivables": { gu: "લેણાં" },
  "Payables": { gu: "દેણાં" },
  "Ageing": { gu: "બાકી રકમનું વય-વિશ્લેષણ" },
  "Ageing Analysis": { gu: "બાકી રકમનું વય-વિશ્લેષણ" },
  "Stock Summary": { gu: "સ્ટોક સારાંશ" },
  "GST Sales Book": { gu: "GST વેચાણ ચોપડી" },
  "GST Sales Book (Output Tax)": { gu: "GST વેચાણ ચોપડી (આઉટપુટ ટેક્સ)" },
  "GST Purchase Book": { gu: "GST ખરીદી ચોપડી" },
  "GST Purchase Book (Input Tax)": { gu: "GST ખરીદી ચોપડી (ઇનપુટ ટેક્સ)" },
  "GSTR-1": { gu: "GSTR-1" },
  "GSTR-2B": { gu: "GSTR-2B" },
  "GSTR-3B": { gu: "GSTR-3B" },
  "Bank Reconciliation": { gu: "બેંક મેળવણી" },
  "Bank Reconciliation (BRS)": { gu: "બેંક મેળવણી (BRS)" },

  // ---- Common column headers ----
  "Date": { gu: "તારીખ" },
  "Particulars": { gu: "વિગતો" },
  "Narration": { gu: "નોંધ" },
  "Number": { gu: "નંબર" },
  "Vch No.": { gu: "વાઉચર નં." },
  "Vch No": { gu: "વાઉચર નં." },
  "Voucher No": { gu: "વાઉચર નં." },
  "Voucher No.": { gu: "વાઉચર નં." },
  "Voucher Number": { gu: "વાઉચર નંબર" },
  "Vch Type": { gu: "વાઉચર પ્રકાર" },
  "Voucher Type": { gu: "વાઉચર પ્રકાર" },
  "Type": { gu: "પ્રકાર" },
  "Side": { gu: "બાજુ" },
  "Debit": { gu: "ઉધાર" },
  "Credit": { gu: "જમા" },
  "Dr": { gu: "ઉધાર" },
  "Cr": { gu: "જમા" },
  "Dr.": { gu: "ઉધાર" },
  "Cr.": { gu: "જમા" },
  "Dr. Ledger": { gu: "ઉધાર ખાતું" },
  "Cr. Ledger": { gu: "જમા ખાતું" },
  "Dr. Particulars": { gu: "ઉધાર વિગતો" },
  "Cr. Particulars": { gu: "જમા વિગતો" },
  "Dr.  Particulars": { gu: "ઉધાર વિગતો" },
  "Particulars  Cr.": { gu: "જમા વિગતો" },
  "Dr. Balances": { gu: "ઉધાર સિલક" },
  "Cr. Balances": { gu: "જમા સિલક" },
  "Dr Amount": { gu: "ઉધાર રકમ" },
  "Cr Amount": { gu: "જમા રકમ" },
  "Balance": { gu: "સિલક" },
  "Closing": { gu: "બંધ સિલક" },
  "Opening": { gu: "ઉઘડતી સિલક" },
  "Opening Balance": { gu: "ઉઘડતી સિલક" },
  "Closing Balance": { gu: "બંધ સિલક" },
  "Total": { gu: "કુલ" },
  "TOTAL": { gu: "કુલ" },
  "Sub Total": { gu: "પેટા કુલ" },
  "Subtotal": { gu: "પેટા કુલ" },
  "Grand Total": { gu: "એકંદર કુલ" },
  "Amount": { gu: "રકમ" },
  "Amount (₹)": { gu: "રકમ (₹)" },
  "Value": { gu: "મૂલ્ય" },
  "Value (₹)": { gu: "મૂલ્ય (₹)" },
  "Qty": { gu: "જથ્થો" },
  "Quantity": { gu: "જથ્થો" },
  "Rate": { gu: "દર" },
  "Unit": { gu: "એકમ" },
  "Item": { gu: "માલ" },
  "Item Name": { gu: "માલનું નામ" },
  "Party": { gu: "પક્ષકાર" },
  "Party Name": { gu: "પક્ષકારનું નામ" },
  "Customer": { gu: "ગ્રાહક" },
  "Supplier": { gu: "સપ્લાયર" },
  "Account": { gu: "ખાતું" },
  "Account Name": { gu: "ખાતાનું નામ" },
  "Ledger Name": { gu: "ખાતાનું નામ" },
  "Group": { gu: "સમૂહ" },
  "GSTIN": { gu: "GSTIN" },
  "HSN": { gu: "HSN" },
  "SAC": { gu: "SAC" },
  "CGST": { gu: "CGST" },
  "SGST": { gu: "SGST" },
  "IGST": { gu: "IGST" },
  "Cess": { gu: "સેસ" },
  "POS": { gu: "પુરવઠાનું રાજ્ય" },
  "Tax": { gu: "કર" },
  "Taxable": { gu: "કરપાત્ર" },
  "Taxable Value": { gu: "કરપાત્ર મૂલ્ય" },
  "Invoice Total": { gu: "ઇન્વૉઇસ કુલ" },
  "Invoice No.": { gu: "ઇન્વૉઇસ નં." },
  "Invoice Date": { gu: "ઇન્વૉઇસ તારીખ" },
  "Discount": { gu: "વટાવ" },
  "Days": { gu: "દિવસ" },
  "Bill No": { gu: "બિલ નં." },
  "Bill No.": { gu: "બિલ નં." },
  "Bill Date": { gu: "બિલ તારીખ" },
  "Due Date": { gu: "નિયત તારીખ" },
  "Reference": { gu: "સંદર્ભ" },
  "Ref No": { gu: "સંદર્ભ નં." },
  "Ref No.": { gu: "સંદર્ભ નં." },
  "Status": { gu: "સ્થિતિ" },
  "Inward": { gu: "આવક" },
  "Outward": { gu: "જાવક" },
  "Sr": { gu: "ક્રમ" },
  "Sr No": { gu: "ક્રમ" },
  "Sr No.": { gu: "ક્રમ" },

  // ---- Section / footer ----
  "By": { gu: "જમા બાજુ" },
  "To": { gu: "ઉધાર બાજુ" },
  "As at": { gu: "તા.ના રોજ" },
  "As on": { gu: "તા.ના રોજ" },
  "For the period": { gu: "આ સમયગાળા માટે" },
  "From": { gu: "થી" },
  "Period": { gu: "સમયગાળો" },
  "Income": { gu: "આવક" },
  "Expenditure": { gu: "જાવક" },
  "Expense": { gu: "ખર્ચ" },
  "Expenses": { gu: "ખર્ચ" },
  "Direct Income": { gu: "પ્રત્યક્ષ આવક" },
  "Direct Incomes": { gu: "પ્રત્યક્ષ આવક" },
  "Indirect Income": { gu: "પરોક્ષ આવક" },
  "Indirect Incomes": { gu: "પરોક્ષ આવક" },
  "Direct Expense": { gu: "પ્રત્યક્ષ ખર્ચ" },
  "Direct Expenses": { gu: "પ્રત્યક્ષ ખર્ચ" },
  "Indirect Expense": { gu: "પરોક્ષ ખર્ચ" },
  "Indirect Expenses": { gu: "પરોક્ષ ખર્ચ" },
  "Assets": { gu: "મિલકતો" },
  "Assets (Application of Funds)": { gu: "મિલકતો (નાણાંનો ઉપયોગ)" },
  "Liabilities": { gu: "જવાબદારીઓ" },
  "Equity & Liabilities": { gu: "મૂડી અને જવાબદારીઓ" },
  "Liabilities (Capital & Sources of Funds)": { gu: "જવાબદારીઓ (મૂડી અને નાણાંનાં સ્ત્રોત)" },
  "Capital": { gu: "મૂડી" },
  "Net Profit": { gu: "ચોખ્ખો નફો" },
  "Net Loss": { gu: "ચોખ્ખું નુકસાન" },
  "Net Profit (current period)": { gu: "ચોખ્ખો નફો (ચાલુ સમયગાળો)" },
  "Net Loss (current period)": { gu: "ચોખ્ખું નુકસાન (ચાલુ સમયગાળો)" },
  "Gross Profit": { gu: "સ્થૂળ નફો" },
  "Gross Loss": { gu: "સ્થૂળ નુકસાન" },
  "Opening Stock": { gu: "ઉઘડતો સ્ટોક" },
  "Closing Stock": { gu: "બંધ સ્ટોક" },
  "Balance c/d": { gu: "સિલક આ.લા." },
  "Gross Profit c/d": { gu: "સ્થૂળ નફો આ.લા." },
  "Gross Loss c/d": { gu: "સ્થૂળ નુકસાન આ.લા." },
  "Net Profit c/d": { gu: "ચોખ્ખો નફો આ.લા." },
  "Net Loss c/d": { gu: "ચોખ્ખું નુકસાન આ.લા." },
  "Excess of Income over Expenditure": { gu: "આવકનો જાવક ઉપર વધારો" },
  "Excess of Expenditure over Income": { gu: "જાવકનો આવક ઉપર વધારો" },
  "To Excess of Income over Expenditure": { gu: "આવકનો જાવક ઉપર વધારો" },
  "By Excess of Expenditure over Income": { gu: "જાવકનો આવક ઉપર વધારો" },
  "To Net Profit c/d": { gu: "ચોખ્ખો નફો આ.લા." },
  "By Net Loss c/d": { gu: "ચોખ્ખું નુકસાન આ.લા." },
  "To Opening Stock": { gu: "ઉઘડતો સ્ટોક" },
  "By Closing Stock": { gu: "બંધ સ્ટોક" },
  "To Gross Profit c/d": { gu: "સ્થૂળ નફો આ.લા." },
  "By Gross Loss c/d": { gu: "સ્થૂળ નુકસાન આ.લા." },
  "To Opening Balance": { gu: "ઉઘડતી સિલક" },
  "By Opening Balance": { gu: "ઉઘડતી સિલક" },
  "To Balance c/d": { gu: "સિલક આ.લા." },
  "By Balance c/d": { gu: "સિલક આ.લા." },
  "Out / Purchases / Payments": { gu: "ખરીદી / ચુકવણી / જાવક" },
  "Receipts / Sales": { gu: "રસીદ / વેચાણ" },
  "Dr.  Out / Purchases / Payments": { gu: "ઉધાર: ખરીદી / ચુકવણી / જાવક" },
  "Receipts / Sales  Cr.": { gu: "રસીદ / વેચાણ: જમા" },

  // Account-group labels
  "Capital Account": { gu: "મૂડી ખાતું" },
  "Reserves & Surplus": { gu: "રિઝર્વ અને સરપ્લસ" },
  "Secured Loans": { gu: "સુરક્ષિત લોન" },
  "Unsecured Loans": { gu: "બિનસુરક્ષિત લોન" },
  "Sundry Creditors": { gu: "વિવિધ લેણદારો" },
  "Duties & Taxes": { gu: "ડ્યુટી અને કર" },
  "Provisions": { gu: "જોગવાઈઓ" },
  "Current Liabilities": { gu: "ચાલુ જવાબદારીઓ" },
  "Fixed Assets": { gu: "સ્થિર મિલકતો" },
  "Investments": { gu: "રોકાણો" },
  "Stock-in-Hand": { gu: "હાથ પરનો સ્ટોક" },
  "Sundry Debtors": { gu: "વિવિધ દેવાદારો" },
  "Cash-in-Hand": { gu: "હાથ પરની રોકડ" },
  "Bank Accounts": { gu: "બેંક ખાતાં" },
  "Loans & Advances (Asset)": { gu: "લોન અને એડવાન્સ (મિલકત)" },
  "Current Assets": { gu: "ચાલુ મિલકતો" },
  "Misc. Expenses (Asset)": { gu: "વિવિધ ખર્ચ (મિલકત)" },
  "Sales Accounts": { gu: "વેચાણ ખાતાં" },
  "Purchase Accounts": { gu: "ખરીદી ખાતાં" },

  // Voucher / movement labels
  "Sales": { gu: "વેચાણ" },
  "Purchase": { gu: "ખરીદી" },
  "Receipt": { gu: "રસીદ" },
  "Payment": { gu: "ચુકવણી" },
  "Journal": { gu: "જર્નલ" },
  "Contra": { gu: "કોન્ટ્રા" },
  "Credit Note": { gu: "જમા નોંધ" },
  "Debit Note": { gu: "ઉધાર નોંધ" },
  "Inter": { gu: "અંતરરાજ્ય" },
  "Intra": { gu: "રાજ્ય અંદર" },
  "Page": { gu: "પાનું" },
  "of": { gu: "/" },
  "Printed on": { gu: "છાપ્યાની તારીખ" },

  // ---- Toolbar / chrome (also exposed as i18n keys, mirrored here so the
  //      exporter can localize button labels embedded in headers) ----
  "From": { gu: "થી" },
  "To Date": { gu: "સુધી" },
  "Print": { gu: "પ્રિન્ટ" },
  "Export": { gu: "નિકાસ" },
  "CSV": { gu: "CSV" },
  "Excel": { gu: "એક્સેલ" },
  "PDF": { gu: "PDF" },
  "Word": { gu: "વર્ડ" },
  "Refresh": { gu: "તાજું કરો" },
  "Loading…": { gu: "લોડ થઈ રહ્યું છે…" },
  "Loading...": { gu: "લોડ થઈ રહ્યું છે…" },

  // ---- T-account header variants seen across reports ----
  "Dr.  Particulars": { gu: "ઉધાર  વિગતો" },
  "Particulars  Cr.": { gu: "વિગતો  જમા" },
  "Amount (Rs)": { gu: "રકમ (રૂ.)" },

  // ---- Empty-state copy ----
  "No vouchers in range": { gu: "આ સમયગાળામાં કોઈ વાઉચર નથી" },
  "Adjust the date filter or post some vouchers.": { gu: "તારીખ બદલો અથવા થોડા વાઉચર નોંધાવો." },
  "No data": { gu: "કોઈ માહિતી નથી" },
  "No data for the selected period": { gu: "પસંદ કરેલા સમયગાળા માટે કોઈ માહિતી નથી" },
  "Nothing to show": { gu: "બતાવવા જેવું કંઈ નથી" },
  "Select a ledger": { gu: "ખાતું પસંદ કરો" },
  "Select a group": { gu: "સમૂહ પસંદ કરો" },

  // ---- Print-mode dialog ----
  "Print this report": { gu: "આ રિપોર્ટ છાપો" },
  "Choose where to send the report.": { gu: "રિપોર્ટ ક્યાં મોકલવો તે પસંદ કરો." },
  "Print Preview": { gu: "પ્રિન્ટ પૂર્વાવલોકન" },
  "System Printer": { gu: "સિસ્ટમ પ્રિન્ટર" },
  "Save as PDF": { gu: "PDF તરીકે સંગ્રહો" },
  "Save as Word (.doc)": { gu: "વર્ડ (.doc) તરીકે સંગ્રહો" },
  "Opens a preview window with the report formatted for print.": { gu: "છપાઈ માટે ગોઠવાયેલા રિપોર્ટ સાથે પૂર્વાવલોકન ખુલે છે." },
  "Opens the browser print dialog (your Windows default printer).": { gu: "બ્રાઉઝરનો પ્રિન્ટ સંવાદ ખોલે છે (તમારું ડિફોલ્ટ પ્રિન્ટર)." },
  "Generates a print-ready PDF in your Reports folder.": { gu: "તમારા Reports ફોલ્ડરમાં છાપવા-તૈયાર PDF બનાવે છે." },
  "Editable Word document with the same table layout.": { gu: "એ જ કોઠા-લેઆઉટ સાથેનો સંપાદનક્ષમ Word દસ્તાવેજ." },

  // ---- Stock summary ----
  "Stock Item": { gu: "સ્ટોક વસ્તુ" },
  "Inwards": { gu: "આવક" },
  "Outwards": { gu: "જાવક" },
  "Inward Qty": { gu: "આવક જથ્થો" },
  "Outward Qty": { gu: "જાવક જથ્થો" },
  "Closing Qty": { gu: "બંધ જથ્થો" },
  "Opening Qty": { gu: "ઉઘડતો જથ્થો" },
  "Closing Value": { gu: "બંધ મૂલ્ય" },
  "Opening Value": { gu: "ઉઘડતું મૂલ્ય" },

  // ---- Ageing ----
  "Not due": { gu: "બાકી નથી" },
  "Overdue": { gu: "મુદત વીતેલી" },
  "Bucket": { gu: "વર્ગ" },
  "Total Outstanding": { gu: "કુલ બાકી" },
  "Total Receivable": { gu: "કુલ લેણાં" },
  "Total Payable": { gu: "કુલ દેણાં" },
  "Net Receivable": { gu: "ચોખ્ખાં લેણાં" },
  "Net Payable": { gu: "ચોખ્ખાં દેણાં" },

  // ---- Outstanding / Bill-by-bill ----
  "Bill Ref": { gu: "બિલ સંદર્ભ" },
  "Bill Reference": { gu: "બિલ સંદર્ભ" },
  "Pending": { gu: "બાકી" },
  "Cleared": { gu: "ચુકવાયેલ" },
  "Aged": { gu: "જૂનું" },

  // ---- BRS ----
  "Statement Balance": { gu: "સ્ટેટમેન્ટ સિલક" },
  "Book Balance": { gu: "ચોપડા સિલક" },
  "Reconciled": { gu: "મેળવાયેલ" },
  "Unreconciled": { gu: "નહિ મેળવાયેલ" },
  "Difference": { gu: "તફાવત" },

  // ---- GST returns / books ----
  "Place of Supply": { gu: "પુરવઠાનું સ્થળ" },
  "Reverse Charge": { gu: "વિપરીત શુલ્ક" },
  "Tax Rate": { gu: "કર દર" },
  "Tax Amount": { gu: "કરની રકમ" },
  "Total Tax": { gu: "કુલ કર" },
  "Total Value": { gu: "કુલ મૂલ્ય" },
  "B2B": { gu: "B2B" },
  "B2C": { gu: "B2C" },
  "B2CL": { gu: "B2CL" },
  "B2CS": { gu: "B2CS" },
  "CDNR": { gu: "CDNR" },
  "CDNUR": { gu: "CDNUR" },
  "Exports": { gu: "નિકાસ" },
  "HSN Summary": { gu: "HSN સારાંશ" },
  "Documents Issued": { gu: "જારી થયેલા દસ્તાવેજો" },
  "ITC Available": { gu: "મળવાપાત્ર ITC" },
  "ITC Reversed": { gu: "પાછી ખેંચાયેલ ITC" },
  "Ineligible ITC": { gu: "અપાત્ર ITC" },
  "Output Tax": { gu: "આઉટપુટ ટેક્સ" },
  "Input Tax": { gu: "ઇનપુટ ટેક્સ" },
  "Round Off": { gu: "રાઉન્ડ ઑફ" },
  "TDS": { gu: "TDS" },
  "TCS": { gu: "TCS" },

  // ---- Misc accounting prefixes seen in narrations ----
  "Less": { gu: "ઓછું" },
  "Less:": { gu: "ઓછું:" },
  "Add": { gu: "વધુ" },
  "Add:": { gu: "વધુ:" },
  "Net": { gu: "ચોખ્ખું" },
  "Gross": { gu: "સ્થૂળ" },
  "Notes": { gu: "નોંધો" },
  "Remarks": { gu: "ટિપ્પણીઓ" },
  "Description": { gu: "વર્ણન" },
  "Note": { gu: "નોંધ" },
};

import { tReportText as tReportTextRule } from "@/lib/report-i18n-rules";
export { tReportText } from "@/lib/report-i18n-rules";
// Re-export so callers can keep importing translation helpers from report-i18n.ts.
void tReportTextRule;

export function tReportLabel(text: string, lang: LangCode = getStoredLang()): string {
  if (!text || lang === "en") return text;
  if (lang !== "gu") return LABELS[text]?.[lang] ?? text;

  const trimmed = text.trim();
  const leading = text.match(/^\s*/)?.[0] ?? "";
  const entry = LABELS[trimmed]?.gu ?? LABELS[text]?.gu;
  if (entry) return leading + entry;

  let out = formatDatesInText(trimmed)
    .replace(/\bto\b/g, "થી")
    .replace(/→/g, "થી");

  const ledgerTitle = /^Ledger A\/c\s+[—-]\s+(.+)$/.exec(out);
  if (ledgerTitle) return `${leading}ખાતું — ${ledgerTitle[1]}`;

  const colonTitle = /^(.+?):\s*(.+)$/.exec(out);
  if (colonTitle) {
    const left = tReportLabel(colonTitle[1], lang);
    const right = formatDatesInText(colonTitle[2]).replace(/\bto\b/g, "થી");
    if (left !== colonTitle[1] || right !== colonTitle[2]) return `${leading}${left}: ${right}`;
  }

  const asOn = /^As on\s+(.+)$/.exec(out);
  if (asOn) return `${leading}તા. ${formatDatesInText(asOn[1]).replace(/\bto\b/g, "થી")}ના રોજ`;

  const subtotal = /^Subtotal\s+[—-]\s+(.+)$/.exec(out);
  if (subtotal) return `${leading}પેટા કુલ — ${tReportLabel(subtotal[1], lang)}`;

  const prefixed = /^(To|By)\s+(.+)$/.exec(out);
  if (prefixed) return `${leading}${tReportLabel(prefixed[2], lang)}`;

  const upperEntry = LABELS[trimmed.toUpperCase()]?.gu;
  if (upperEntry && trimmed === trimmed.toUpperCase()) return leading + upperEntry;

  return leading + out;
}

export function tReportRows<T>(rows: T[][], lang: LangCode = getStoredLang()): T[][] {
  if (lang === "en") return rows;
  return rows.map((r) => r.map((c) => (typeof c === "string" ? (tReportLabel(c, lang) as unknown as T) : c)));
}

export function localizeReportDate(value: string | Date | null | undefined): string {
  return fmtIndianDate(value);
}
