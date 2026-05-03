// Entity status helpers — single source of truth for the "type of business" UI bundling.
// Phase 1: form-field bundling. Phase 2 will reuse these flags in the Balance Sheet / P&L.

import type { LucideIcon } from "lucide-react";
import { User, Users, Building2, Landmark, HeartHandshake, Briefcase } from "lucide-react";

export type EntityStatus =
  | "individual"
  | "huf"
  | "aop"
  | "pvt_ltd"
  | "registered_firm"
  | "trust";

export interface EntityStatusMeta {
  value: EntityStatus;
  label: string;
  short: string;
  icon: LucideIcon;
  description: string;
}

export const ENTITY_STATUSES: EntityStatusMeta[] = [
  { value: "individual",      label: "Individual / Proprietor",         short: "Individual", icon: User,           description: "Sole proprietor, freelancer, professional." },
  { value: "huf",             label: "HUF (Hindu Undivided Family)",    short: "HUF",        icon: Users,          description: "Family-owned business with a Karta." },
  { value: "aop",             label: "AOP (Association of Persons)",    short: "AOP",        icon: Users,          description: "Two or more persons jointly carrying on activity." },
  { value: "pvt_ltd",         label: "Pvt Ltd Company",                  short: "Pvt Ltd",   icon: Building2,      description: "Schedule III formats; share capital & directors." },
  { value: "registered_firm", label: "Registered Firm (Partnership)",   short: "RF",         icon: Briefcase,      description: "Partners with profit-sharing ratio." },
  { value: "trust",           label: "Trust",                            short: "Trust",     icon: HeartHandshake, description: "Income & Expenditure A/c; Corpus Fund." },
];

export const getEntityMeta = (s: EntityStatus | null | undefined): EntityStatusMeta =>
  ENTITY_STATUSES.find((e) => e.value === s) ?? ENTITY_STATUSES[0];

export interface EntityFeatureFlags {
  // Form bundling
  showCIN: boolean;
  showShareCapital: boolean;
  showDirectors: boolean;       // Pvt Ltd
  showPartners: boolean;        // RF — with PSR
  showTrustees: boolean;        // Trust
  showCorpusFund: boolean;      // Trust
  showKarta: boolean;           // HUF
  // Reporting (used in Phase 2)
  capitalLabel: string;          // "Capital Account" vs "Shareholder Funds" vs "Corpus & Reserves"
  plLabel: string;               // "Profit & Loss A/c" vs "Income & Expenditure A/c"
  scheduleIII: boolean;          // Pvt Ltd formal layout
  membersTabLabel: string | null;
  memberRoleLabel: string | null; // For the entity_members.member_role default
}

export const getEntityFeatures = (s: EntityStatus): EntityFeatureFlags => {
  switch (s) {
    case "pvt_ltd":
      return {
        showCIN: true, showShareCapital: true, showDirectors: true,
        showPartners: false, showTrustees: false, showCorpusFund: false, showKarta: false,
        capitalLabel: "Shareholders' Funds", plLabel: "Profit & Loss A/c",
        scheduleIII: true, membersTabLabel: "Directors", memberRoleLabel: "director",
      };
    case "registered_firm":
      return {
        showCIN: false, showShareCapital: false, showDirectors: false,
        showPartners: true, showTrustees: false, showCorpusFund: false, showKarta: false,
        capitalLabel: "Partners' Capital Accounts", plLabel: "Profit & Loss A/c",
        scheduleIII: false, membersTabLabel: "Partners", memberRoleLabel: "partner",
      };
    case "trust":
      return {
        showCIN: false, showShareCapital: false, showDirectors: false,
        showPartners: false, showTrustees: true, showCorpusFund: true, showKarta: false,
        capitalLabel: "Corpus & Reserves", plLabel: "Income & Expenditure A/c",
        scheduleIII: false, membersTabLabel: "Trustees", memberRoleLabel: "trustee",
      };
    case "huf":
      return {
        showCIN: false, showShareCapital: false, showDirectors: false,
        showPartners: false, showTrustees: false, showCorpusFund: false, showKarta: true,
        capitalLabel: "Capital Account (Karta)", plLabel: "Profit & Loss A/c",
        scheduleIII: false, membersTabLabel: "Karta / Coparceners", memberRoleLabel: "karta",
      };
    case "aop":
      return {
        showCIN: false, showShareCapital: false, showDirectors: false,
        showPartners: true, showTrustees: false, showCorpusFund: false, showKarta: false,
        capitalLabel: "Members' Capital Accounts", plLabel: "Profit & Loss A/c",
        scheduleIII: false, membersTabLabel: "Members", memberRoleLabel: "member",
      };
    case "individual":
    default:
      return {
        showCIN: false, showShareCapital: false, showDirectors: false,
        showPartners: false, showTrustees: false, showCorpusFund: false, showKarta: false,
        capitalLabel: "Capital Account", plLabel: "Profit & Loss A/c",
        scheduleIII: false, membersTabLabel: null, memberRoleLabel: null,
      };
  }
};

// Indian DD-MM-YYYY date formatting
export const formatDateIN = (d: string | Date | null | undefined): string => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return String(d);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
};

// CIN basic format: L/U + 5-digit industry + 2-letter state + 4-digit year + 3-letter org type + 6-digit reg no.
export const CIN_REGEX = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;