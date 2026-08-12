import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type DateFormatCode =
  | "dd-mm-yyyy"
  | "dd/mm/yyyy"
  | "mm-dd-yyyy"
  | "mm/dd/yyyy"
  | "yyyy-mm-dd"
  | "dd-mmm-yyyy";

export interface DateFormatDef {
  code: DateFormatCode;
  label: string;
  sample: string;
}

export const DATE_FORMATS: DateFormatDef[] = [
  { code: "dd-mm-yyyy", label: "DD-MM-YYYY (Indian)", sample: "31-12-2025" },
  { code: "dd/mm/yyyy", label: "DD/MM/YYYY", sample: "31/12/2025" },
  { code: "mm-dd-yyyy", label: "MM-DD-YYYY (US)", sample: "12-31-2025" },
  { code: "mm/dd/yyyy", label: "MM/DD/YYYY (US)", sample: "12/31/2025" },
  { code: "yyyy-mm-dd", label: "YYYY-MM-DD (ISO)", sample: "2025-12-31" },
  { code: "dd-mmm-yyyy", label: "DD-MMM-YYYY", sample: "31-Dec-2025" },
];

const STORAGE_KEY = "date.format";
const DEFAULT_FORMAT: DateFormatCode = "dd-mm-yyyy";

let _current: DateFormatCode = DEFAULT_FORMAT;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v && DATE_FORMATS.some((f) => f.code === v)) _current = v as DateFormatCode;
  } catch {
    /* ignore */
  }
}

export function getCurrentDateFormat(): DateFormatCode {
  return _current;
}

export function setCurrentDateFormat(code: DateFormatCode): void {
  _current = code;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, code);
    } catch {
      /* ignore */
    }
  }
  listeners.forEach((fn) => fn());
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Apply a given date-format code to UTC y/m/d parts. */
export function applyDateFormat(y: number, m: number, d: number, code: DateFormatCode = _current): string {
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const yyyy = String(y);
  const mmm = MONTHS[m - 1] ?? "";
  switch (code) {
    case "dd/mm/yyyy": return `${dd}/${mm}/${yyyy}`;
    case "mm-dd-yyyy": return `${mm}-${dd}-${yyyy}`;
    case "mm/dd/yyyy": return `${mm}/${dd}/${yyyy}`;
    case "yyyy-mm-dd": return `${yyyy}-${mm}-${dd}`;
    case "dd-mmm-yyyy": return `${dd}-${mmm}-${yyyy}`;
    case "dd-mm-yyyy":
    default:
      return `${dd}-${mm}-${yyyy}`;
  }
}

interface Ctx {
  code: DateFormatCode;
  setCode: (c: DateFormatCode) => void;
}

const DateFormatContext = createContext<Ctx | null>(null);

export function DateFormatProvider({ children }: { children: ReactNode }) {
  const [code, setCodeState] = useState<DateFormatCode>(_current);
  useEffect(() => {
    const fn = () => setCodeState(_current);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return (
    <DateFormatContext.Provider value={{ code, setCode: setCurrentDateFormat }}>
      {children}
    </DateFormatContext.Provider>
  );
}

export function useDateFormat(): Ctx {
  const ctx = useContext(DateFormatContext);
  if (!ctx) return { code: _current, setCode: setCurrentDateFormat };
  return ctx;
}
