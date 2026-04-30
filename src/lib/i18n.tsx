import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type LangCode = "en" | "hi" | "gu" | "mr" | "bn" | "ta" | "te" | "ml" | "kn";

export const LANGUAGES: { code: LangCode; label: string; native: string }[] = [
  { code: "en", label: "English", native: "English" },
  { code: "hi", label: "Hindi", native: "हिन्दी" },
  { code: "gu", label: "Gujarati", native: "ગુજરાતી" },
  { code: "mr", label: "Marathi", native: "मराठी" },
  { code: "bn", label: "Bengali", native: "বাংলা" },
  { code: "ta", label: "Tamil", native: "தமிழ்" },
  { code: "te", label: "Telugu", native: "తెలుగు" },
  { code: "ml", label: "Malayalam", native: "മലയാളം" },
  { code: "kn", label: "Kannada", native: "ಕನ್ನಡ" },
];

type Dict = Record<string, string>;

// Shared keys used across the app (sidebar sections, items, header, ribbon).
// Keep keys consistent across all language dictionaries.
const NAV_KEYS = {
  // Sections
  "nav.section.company": "Company",
  "nav.section.administration": "Administration",
  "nav.section.transactions": "Transactions",
  "nav.section.display": "Display / Print",
  "nav.section.housekeeping": "Housekeeping",
  // Items
  "nav.dashboard": "Dashboard",
  "nav.companies": "Companies",
  "nav.companySettings": "Company Settings",
  "nav.ledgers": "Ledgers / Parties",
  "nav.items": "Items / Stock",
  "nav.recurring": "Recurring Invoices",
  "nav.allVouchers": "All Vouchers",
  "nav.newSales": "New Sales",
  "nav.newPurchase": "New Purchase",
  "nav.receipt": "Receipt",
  "nav.payment": "Payment",
  "nav.journal": "Journal",
  "nav.reportsHub": "Reports Hub",
  "nav.dayBook": "Day Book",
  "nav.ledgerStatement": "Ledger Statement",
  "nav.groupLedger": "Group Ledger (B/S & P&L)",
  "nav.trialBalance": "Trial Balance",
  "nav.tradingAccount": "Trading Account",
  "nav.profitLoss": "Profit & Loss",
  "nav.balanceSheet": "Balance Sheet",
  "nav.outstanding": "Outstanding",
  "nav.stockSummary": "Stock Summary",
  "nav.gstReturns": "GSTR-1 / 3B / 2B",
  "nav.gstSalesBook": "GST Sales Book",
  "nav.gstPurchaseBook": "GST Purchase Book",
  "nav.accountingTools": "Accounting Tools",
  "nav.bankRecon": "Bank Reconciliation",
  "nav.brs": "BRS (Book vs Bank)",
  "nav.einvoice": "E-Invoice / EWB",
  // Header / chrome
  "header.brand": "Your Mehtaji",
  "header.tagline": "Accounting Suite",
  // Quick entry ribbon
  "ribbon.quickEntry": "Quick Entry",
  "ribbon.sales": "Sales",
  "ribbon.purchase": "Purchase",
  "ribbon.receipt": "Receipt",
  "ribbon.payment": "Payment",
  "ribbon.journal": "Journal",
  "ribbon.contra": "Contra",
};

// Common UI strings. Add keys as needed; missing keys fall back to English then to the key itself.
const STRINGS: Record<LangCode, Dict> = {
  en: {
    "app.title": "Your Mehtaji",
    "app.subtitle": "Open a company",
    "company.select": "Select a company",
    "company.select.desc": "Click a company to open it. Locked companies will ask for a password.",
    "company.new": "New company",
    "company.create": "Create company",
    "company.none": "No companies yet. Create your first one.",
    "company.password": "Company password",
    "company.passwordPlaceholder": "Enter password",
    "company.passwordProtected": "Password protected",
    "company.opensDirectly": "No password — opens directly",
    "common.cancel": "Cancel",
    "common.open": "Open",
    "common.checking": "Checking…",
    "common.loading": "Loading…",
    "common.exit": "Exit",
    "common.language": "Language",
    "common.lock": "Lock",
    ...NAV_KEYS,
  },
  hi: {
    "app.title": "योर मेहताजी",
    "app.subtitle": "कंपनी खोलें",
    "company.select": "कंपनी चुनें",
    "company.select.desc": "खोलने के लिए कंपनी पर क्लिक करें। लॉक कंपनियाँ पासवर्ड माँगेंगी।",
    "company.new": "नई कंपनी",
    "company.create": "कंपनी बनाएँ",
    "company.none": "अभी कोई कंपनी नहीं। पहली कंपनी बनाएँ।",
    "company.password": "कंपनी पासवर्ड",
    "company.passwordPlaceholder": "पासवर्ड दर्ज करें",
    "company.passwordProtected": "पासवर्ड सुरक्षित",
    "company.opensDirectly": "कोई पासवर्ड नहीं — सीधे खुलती है",
    "common.cancel": "रद्द करें",
    "common.open": "खोलें",
    "common.checking": "जाँच हो रही है…",
    "common.loading": "लोड हो रहा है…",
    "common.exit": "बाहर",
    "common.language": "भाषा",
    "common.lock": "लॉक",
  },
  gu: {
    "app.title": "યોર મહેતાજી",
    "app.subtitle": "કંપની ખોલો",
    "company.select": "કંપની પસંદ કરો",
    "company.select.desc": "ખોલવા માટે કંપની પર ક્લિક કરો. લોક કંપનીઓ પાસવર્ડ માગશે.",
    "company.new": "નવી કંપની",
    "company.create": "કંપની બનાવો",
    "company.none": "હજુ કોઈ કંપની નથી. પ્રથમ બનાવો.",
    "company.password": "કંપની પાસવર્ડ",
    "company.passwordPlaceholder": "પાસવર્ડ દાખલ કરો",
    "company.passwordProtected": "પાસવર્ડ સુરક્ષિત",
    "company.opensDirectly": "પાસવર્ડ નથી — સીધી ખુલે છે",
    "common.cancel": "રદ કરો",
    "common.open": "ખોલો",
    "common.checking": "તપાસાઈ રહ્યું છે…",
    "common.loading": "લોડ થઈ રહ્યું છે…",
    "common.exit": "બહાર",
    "common.language": "ભાષા",
    "common.lock": "લોક",
  },
  mr: {
    "app.title": "युअर मेहताजी",
    "app.subtitle": "कंपनी उघडा",
    "company.select": "कंपनी निवडा",
    "company.select.desc": "उघडण्यासाठी कंपनीवर क्लिक करा. लॉक कंपन्या पासवर्ड विचारतील.",
    "company.new": "नवीन कंपनी",
    "company.create": "कंपनी तयार करा",
    "company.none": "अद्याप कोणतीही कंपनी नाही. पहिली तयार करा.",
    "company.password": "कंपनी पासवर्ड",
    "company.passwordPlaceholder": "पासवर्ड टाका",
    "company.passwordProtected": "पासवर्ड संरक्षित",
    "company.opensDirectly": "पासवर्ड नाही — थेट उघडते",
    "common.cancel": "रद्द करा",
    "common.open": "उघडा",
    "common.checking": "तपासत आहे…",
    "common.loading": "लोड होत आहे…",
    "common.exit": "बाहेर",
    "common.language": "भाषा",
    "common.lock": "लॉक",
  },
  bn: {
    "app.title": "ইয়োর মেহতাজি",
    "app.subtitle": "একটি কোম্পানি খুলুন",
    "company.select": "একটি কোম্পানি নির্বাচন করুন",
    "company.select.desc": "খুলতে কোম্পানিতে ক্লিক করুন। লক করা কোম্পানিগুলি পাসওয়ার্ড চাইবে।",
    "company.new": "নতুন কোম্পানি",
    "company.create": "কোম্পানি তৈরি করুন",
    "company.none": "এখনও কোনো কোম্পানি নেই। প্রথমটি তৈরি করুন।",
    "company.password": "কোম্পানির পাসওয়ার্ড",
    "company.passwordPlaceholder": "পাসওয়ার্ড লিখুন",
    "company.passwordProtected": "পাসওয়ার্ড সুরক্ষিত",
    "company.opensDirectly": "পাসওয়ার্ড নেই — সরাসরি খোলে",
    "common.cancel": "বাতিল",
    "common.open": "খুলুন",
    "common.checking": "পরীক্ষা চলছে…",
    "common.loading": "লোড হচ্ছে…",
    "common.exit": "প্রস্থান",
    "common.language": "ভাষা",
    "common.lock": "লক",
  },
  ta: {
    "app.title": "யுவர் மேத்தாஜி",
    "app.subtitle": "நிறுவனத்தைத் திறக்கவும்",
    "company.select": "நிறுவனத்தைத் தேர்ந்தெடுக்கவும்",
    "company.select.desc": "திறக்க நிறுவனத்தைக் கிளிக் செய்யவும். பூட்டப்பட்டவை கடவுச்சொல் கேட்கும்.",
    "company.new": "புதிய நிறுவனம்",
    "company.create": "நிறுவனத்தை உருவாக்கவும்",
    "company.none": "இன்னும் நிறுவனங்கள் இல்லை. முதலாவதை உருவாக்கவும்.",
    "company.password": "நிறுவன கடவுச்சொல்",
    "company.passwordPlaceholder": "கடவுச்சொல்லை உள்ளிடவும்",
    "company.passwordProtected": "கடவுச்சொல் பாதுகாக்கப்பட்டது",
    "company.opensDirectly": "கடவுச்சொல் இல்லை — நேரடியாக திறக்கிறது",
    "common.cancel": "ரத்து",
    "common.open": "திற",
    "common.checking": "சரிபார்க்கிறது…",
    "common.loading": "ஏற்றுகிறது…",
    "common.exit": "வெளியேறு",
    "common.language": "மொழி",
    "common.lock": "பூட்டு",
  },
  te: {
    "app.title": "యువర్ మెహతాజీ",
    "app.subtitle": "కంపెనీని తెరవండి",
    "company.select": "కంపెనీని ఎంచుకోండి",
    "company.select.desc": "తెరవడానికి కంపెనీపై క్లిక్ చేయండి. లాక్ చేయబడినవి పాస్‌వర్డ్ అడుగుతాయి.",
    "company.new": "కొత్త కంపెనీ",
    "company.create": "కంపెనీని సృష్టించండి",
    "company.none": "ఇంకా కంపెనీలు లేవు. మొదటిది సృష్టించండి.",
    "company.password": "కంపెనీ పాస్‌వర్డ్",
    "company.passwordPlaceholder": "పాస్‌వర్డ్ నమోదు చేయండి",
    "company.passwordProtected": "పాస్‌వర్డ్ రక్షితం",
    "company.opensDirectly": "పాస్‌వర్డ్ లేదు — నేరుగా తెరుచుకుంటుంది",
    "common.cancel": "రద్దు",
    "common.open": "తెరువు",
    "common.checking": "తనిఖీ చేస్తోంది…",
    "common.loading": "లోడ్ అవుతోంది…",
    "common.exit": "నిష్క్రమణ",
    "common.language": "భాష",
    "common.lock": "లాక్",
  },
  ml: {
    "app.title": "യുവർ മേത്താജി",
    "app.subtitle": "കമ്പനി തുറക്കുക",
    "company.select": "കമ്പനി തിരഞ്ഞെടുക്കുക",
    "company.select.desc": "തുറക്കാൻ കമ്പനിയിൽ ക്ലിക്ക് ചെയ്യുക. ലോക്ക് ചെയ്തവ പാസ്‌വേഡ് ചോദിക്കും.",
    "company.new": "പുതിയ കമ്പനി",
    "company.create": "കമ്പനി സൃഷ്ടിക്കുക",
    "company.none": "ഇതുവരെ കമ്പനികളില്ല. ആദ്യത്തേത് സൃഷ്ടിക്കുക.",
    "company.password": "കമ്പനി പാസ്‌വേഡ്",
    "company.passwordPlaceholder": "പാസ്‌വേഡ് നൽകുക",
    "company.passwordProtected": "പാസ്‌വേഡ് സംരക്ഷിതം",
    "company.opensDirectly": "പാസ്‌വേഡ് ഇല്ല — നേരിട്ട് തുറക്കുന്നു",
    "common.cancel": "റദ്ദാക്കുക",
    "common.open": "തുറക്കുക",
    "common.checking": "പരിശോധിക്കുന്നു…",
    "common.loading": "ലോഡ് ചെയ്യുന്നു…",
    "common.exit": "പുറത്തുകടക്കുക",
    "common.language": "ഭാഷ",
    "common.lock": "ലോക്ക്",
  },
  kn: {
    "app.title": "ಯುವರ್ ಮೆಹ್ತಾಜಿ",
    "app.subtitle": "ಕಂಪನಿಯನ್ನು ತೆರೆಯಿರಿ",
    "company.select": "ಕಂಪನಿಯನ್ನು ಆಯ್ಕೆಮಾಡಿ",
    "company.select.desc": "ತೆರೆಯಲು ಕಂಪನಿಯ ಮೇಲೆ ಕ್ಲಿಕ್ ಮಾಡಿ. ಲಾಕ್ ಆಗಿರುವವು ಪಾಸ್‌ವರ್ಡ್ ಕೇಳುತ್ತವೆ.",
    "company.new": "ಹೊಸ ಕಂಪನಿ",
    "company.create": "ಕಂಪನಿ ರಚಿಸಿ",
    "company.none": "ಇನ್ನೂ ಕಂಪನಿಗಳಿಲ್ಲ. ಮೊದಲನೆಯದನ್ನು ರಚಿಸಿ.",
    "company.password": "ಕಂಪನಿ ಪಾಸ್‌ವರ್ಡ್",
    "company.passwordPlaceholder": "ಪಾಸ್‌ವರ್ಡ್ ನಮೂದಿಸಿ",
    "company.passwordProtected": "ಪಾಸ್‌ವರ್ಡ್ ಸಂರಕ್ಷಿತ",
    "company.opensDirectly": "ಪಾಸ್‌ವರ್ಡ್ ಇಲ್ಲ — ನೇರವಾಗಿ ತೆರೆಯುತ್ತದೆ",
    "common.cancel": "ರದ್ದು",
    "common.open": "ತೆರೆ",
    "common.checking": "ಪರಿಶೀಲಿಸುತ್ತಿದೆ…",
    "common.loading": "ಲೋಡ್ ಆಗುತ್ತಿದೆ…",
    "common.exit": "ನಿರ್ಗಮಿಸಿ",
    "common.language": "ಭಾಷೆ",
    "common.lock": "ಲಾಕ್",
  },
};

const STORAGE_KEY = "ym_lang";
const COMPANY_LANG_PREFIX = "ym_lang_company_";

export function getStoredLang(): LangCode {
  if (typeof window === "undefined") return "en";
  const v = localStorage.getItem(STORAGE_KEY);
  if (v && STRINGS[v as LangCode]) return v as LangCode;
  return "en";
}

export function getCompanyLang(companyId: string): LangCode | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(COMPANY_LANG_PREFIX + companyId);
  if (v && STRINGS[v as LangCode]) return v as LangCode;
  return null;
}

export function setCompanyLang(companyId: string, lang: LangCode) {
  localStorage.setItem(COMPANY_LANG_PREFIX + companyId, lang);
}

interface I18nCtx {
  lang: LangCode;
  setLang: (l: LangCode) => void;
  t: (key: string) => string;
}

const Ctx = createContext<I18nCtx | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<LangCode>(() => getStoredLang());

  useEffect(() => {
    document.documentElement.setAttribute("lang", lang);
  }, [lang]);

  const setLang = (l: LangCode) => {
    localStorage.setItem(STORAGE_KEY, l);
    setLangState(l);
  };

  const t = (key: string) => STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const c = useContext(Ctx);
  if (!c) {
    // Fallback when used outside provider — read directly from storage.
    const lang = getStoredLang();
    return {
      lang,
      setLang: (l) => localStorage.setItem(STORAGE_KEY, l),
      t: (key) => STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key,
    };
  }
  return c;
}
