import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// Common ISO 4217 currencies. Symbol falls back to code when none is standard.
export interface CurrencyDef {
  code: string;
  name: string;
  symbol: string;
}

export const CURRENCIES: CurrencyDef[] = [
  { code: "INR", name: "Indian Rupee", symbol: "₹" },
  { code: "USD", name: "US Dollar", symbol: "$" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "GBP", name: "British Pound", symbol: "£" },
  { code: "JPY", name: "Japanese Yen", symbol: "¥" },
  { code: "CNY", name: "Chinese Yuan", symbol: "¥" },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ" },
  { code: "SAR", name: "Saudi Riyal", symbol: "﷼" },
  { code: "QAR", name: "Qatari Riyal", symbol: "﷼" },
  { code: "KWD", name: "Kuwaiti Dinar", symbol: "د.ك" },
  { code: "BHD", name: "Bahraini Dinar", symbol: ".د.ب" },
  { code: "OMR", name: "Omani Rial", symbol: "﷼" },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$" },
  { code: "HKD", name: "Hong Kong Dollar", symbol: "HK$" },
  { code: "AUD", name: "Australian Dollar", symbol: "A$" },
  { code: "NZD", name: "New Zealand Dollar", symbol: "NZ$" },
  { code: "CAD", name: "Canadian Dollar", symbol: "C$" },
  { code: "CHF", name: "Swiss Franc", symbol: "CHF" },
  { code: "SEK", name: "Swedish Krona", symbol: "kr" },
  { code: "NOK", name: "Norwegian Krone", symbol: "kr" },
  { code: "DKK", name: "Danish Krone", symbol: "kr" },
  { code: "PLN", name: "Polish Zloty", symbol: "zł" },
  { code: "CZK", name: "Czech Koruna", symbol: "Kč" },
  { code: "HUF", name: "Hungarian Forint", symbol: "Ft" },
  { code: "RUB", name: "Russian Ruble", symbol: "₽" },
  { code: "TRY", name: "Turkish Lira", symbol: "₺" },
  { code: "ZAR", name: "South African Rand", symbol: "R" },
  { code: "BRL", name: "Brazilian Real", symbol: "R$" },
  { code: "MXN", name: "Mexican Peso", symbol: "Mex$" },
  { code: "ARS", name: "Argentine Peso", symbol: "$" },
  { code: "CLP", name: "Chilean Peso", symbol: "$" },
  { code: "COP", name: "Colombian Peso", symbol: "$" },
  { code: "PEN", name: "Peruvian Sol", symbol: "S/" },
  { code: "VES", name: "Venezuelan Bolívar", symbol: "Bs.S" },
  { code: "NGN", name: "Nigerian Naira", symbol: "₦" },
  { code: "EGP", name: "Egyptian Pound", symbol: "£" },
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh" },
  { code: "GHS", name: "Ghanaian Cedi", symbol: "₵" },
  { code: "MAD", name: "Moroccan Dirham", symbol: "د.م." },
  { code: "TND", name: "Tunisian Dinar", symbol: "د.ت" },
  { code: "DZD", name: "Algerian Dinar", symbol: "د.ج" },
  { code: "ETB", name: "Ethiopian Birr", symbol: "Br" },
  { code: "UGX", name: "Ugandan Shilling", symbol: "USh" },
  { code: "TZS", name: "Tanzanian Shilling", symbol: "TSh" },
  { code: "PKR", name: "Pakistani Rupee", symbol: "₨" },
  { code: "BDT", name: "Bangladeshi Taka", symbol: "৳" },
  { code: "LKR", name: "Sri Lankan Rupee", symbol: "₨" },
  { code: "NPR", name: "Nepalese Rupee", symbol: "₨" },
  { code: "BTN", name: "Bhutanese Ngultrum", symbol: "Nu." },
  { code: "MVR", name: "Maldivian Rufiyaa", symbol: "Rf" },
  { code: "AFN", name: "Afghan Afghani", symbol: "؋" },
  { code: "IRR", name: "Iranian Rial", symbol: "﷼" },
  { code: "IQD", name: "Iraqi Dinar", symbol: "ع.د" },
  { code: "JOD", name: "Jordanian Dinar", symbol: "د.ا" },
  { code: "LBP", name: "Lebanese Pound", symbol: "ل.ل" },
  { code: "SYP", name: "Syrian Pound", symbol: "£" },
  { code: "YER", name: "Yemeni Rial", symbol: "﷼" },
  { code: "ILS", name: "Israeli Shekel", symbol: "₪" },
  { code: "THB", name: "Thai Baht", symbol: "฿" },
  { code: "VND", name: "Vietnamese Dong", symbol: "₫" },
  { code: "IDR", name: "Indonesian Rupiah", symbol: "Rp" },
  { code: "MYR", name: "Malaysian Ringgit", symbol: "RM" },
  { code: "PHP", name: "Philippine Peso", symbol: "₱" },
  { code: "KRW", name: "South Korean Won", symbol: "₩" },
  { code: "KPW", name: "North Korean Won", symbol: "₩" },
  { code: "TWD", name: "Taiwan Dollar", symbol: "NT$" },
  { code: "MOP", name: "Macanese Pataca", symbol: "MOP$" },
  { code: "MMK", name: "Myanmar Kyat", symbol: "K" },
  { code: "KHR", name: "Cambodian Riel", symbol: "៛" },
  { code: "LAK", name: "Lao Kip", symbol: "₭" },
  { code: "MNT", name: "Mongolian Tögrög", symbol: "₮" },
  { code: "KZT", name: "Kazakhstani Tenge", symbol: "₸" },
  { code: "UZS", name: "Uzbekistani Soʻm", symbol: "soʻm" },
  { code: "AZN", name: "Azerbaijani Manat", symbol: "₼" },
  { code: "GEL", name: "Georgian Lari", symbol: "₾" },
  { code: "AMD", name: "Armenian Dram", symbol: "֏" },
  { code: "UAH", name: "Ukrainian Hryvnia", symbol: "₴" },
  { code: "BYN", name: "Belarusian Ruble", symbol: "Br" },
  { code: "RON", name: "Romanian Leu", symbol: "lei" },
  { code: "BGN", name: "Bulgarian Lev", symbol: "лв" },
  { code: "RSD", name: "Serbian Dinar", symbol: "дин" },
  { code: "HRK", name: "Croatian Kuna", symbol: "kn" },
  { code: "ISK", name: "Icelandic Króna", symbol: "kr" },
  { code: "ALL", name: "Albanian Lek", symbol: "L" },
  { code: "MKD", name: "Macedonian Denar", symbol: "ден" },
  { code: "BAM", name: "Bosnia-Herzegovina Mark", symbol: "KM" },
  { code: "MDL", name: "Moldovan Leu", symbol: "L" },
  { code: "XOF", name: "West African CFA Franc", symbol: "CFA" },
  { code: "XAF", name: "Central African CFA Franc", symbol: "FCFA" },
  { code: "XCD", name: "East Caribbean Dollar", symbol: "EC$" },
  { code: "XPF", name: "CFP Franc", symbol: "₣" },
  { code: "JMD", name: "Jamaican Dollar", symbol: "J$" },
  { code: "TTD", name: "Trinidad Dollar", symbol: "TT$" },
  { code: "BBD", name: "Barbadian Dollar", symbol: "Bds$" },
  { code: "BSD", name: "Bahamian Dollar", symbol: "B$" },
  { code: "BMD", name: "Bermudian Dollar", symbol: "BD$" },
  { code: "BZD", name: "Belize Dollar", symbol: "BZ$" },
  { code: "CRC", name: "Costa Rican Colón", symbol: "₡" },
  { code: "GTQ", name: "Guatemalan Quetzal", symbol: "Q" },
  { code: "HNL", name: "Honduran Lempira", symbol: "L" },
  { code: "NIO", name: "Nicaraguan Córdoba", symbol: "C$" },
  { code: "PAB", name: "Panamanian Balboa", symbol: "B/." },
  { code: "DOP", name: "Dominican Peso", symbol: "RD$" },
  { code: "CUP", name: "Cuban Peso", symbol: "₱" },
  { code: "HTG", name: "Haitian Gourde", symbol: "G" },
  { code: "PYG", name: "Paraguayan Guaraní", symbol: "₲" },
  { code: "UYU", name: "Uruguayan Peso", symbol: "$U" },
  { code: "BOB", name: "Bolivian Boliviano", symbol: "Bs." },
  { code: "GYD", name: "Guyanese Dollar", symbol: "G$" },
  { code: "SRD", name: "Surinamese Dollar", symbol: "Sr$" },
  { code: "FJD", name: "Fijian Dollar", symbol: "FJ$" },
  { code: "PGK", name: "Papua New Guinean Kina", symbol: "K" },
  { code: "WST", name: "Samoan Tala", symbol: "WS$" },
  { code: "TOP", name: "Tongan Paʻanga", symbol: "T$" },
  { code: "SBD", name: "Solomon Islands Dollar", symbol: "SI$" },
  { code: "VUV", name: "Vanuatu Vatu", symbol: "VT" },
];

const STORAGE_KEY = "currency.code";
const DEFAULT_CODE = "INR";

let _currentCode: string = DEFAULT_CODE;
let _currentSymbol: string = "₹";

const listeners = new Set<() => void>();

function lookupSymbol(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
}

// Initialise from localStorage (browser only).
if (typeof window !== "undefined") {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      _currentCode = stored;
      _currentSymbol = lookupSymbol(stored);
    }
  } catch {
    // ignore
  }
}

export function getCurrentCurrencyCode(): string {
  return _currentCode;
}

export function getCurrentCurrencySymbol(): string {
  return _currentSymbol;
}

export function setCurrentCurrency(code: string): void {
  _currentCode = code;
  _currentSymbol = lookupSymbol(code);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // ignore
    }
  }
  listeners.forEach((fn) => fn());
}

interface Ctx {
  code: string;
  symbol: string;
  setCode: (c: string) => void;
}

const CurrencyContext = createContext<Ctx | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [code, setCodeState] = useState<string>(_currentCode);

  useEffect(() => {
    const fn = () => setCodeState(_currentCode);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  const setCode = (c: string) => setCurrentCurrency(c);

  return (
    <CurrencyContext.Provider value={{ code, symbol: lookupSymbol(code), setCode }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency(): Ctx {
  const ctx = useContext(CurrencyContext);
  if (!ctx) {
    // Fallback so it works even outside provider
    return { code: _currentCode, symbol: _currentSymbol, setCode: setCurrentCurrency };
  }
  return ctx;
}
