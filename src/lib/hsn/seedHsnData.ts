// Seed the local hsn_master table with a starter set of common Indian HSN/SAC codes.
// Idempotent: runs once per session and uses INSERT OR IGNORE so existing rows are preserved.

import { safeBrainExec, safeBrainSelect } from "@/brain/SqliteBrain";
import { ensureHsnSchema } from "./initHsnSchema";

interface SeedRow {
  hsn_code: string;
  description: string;
  cgst_rate: number;
  sgst_rate: number;
  igst_rate: number;
  is_exempt: number;
}

// Common HSN + SAC codes. Rates are CGST/SGST split (intra-state) and IGST (inter-state).
// Extend freely — every row uses INSERT OR IGNORE so re-running is safe.
const SEED: SeedRow[] = [
  // --- Exempt / Nil rated ---
  { hsn_code: "0401", description: "Fresh milk and cream, not concentrated", cgst_rate: 0, sgst_rate: 0, igst_rate: 0, is_exempt: 1 },
  { hsn_code: "0701", description: "Potatoes, fresh or chilled", cgst_rate: 0, sgst_rate: 0, igst_rate: 0, is_exempt: 1 },
  { hsn_code: "1001", description: "Wheat and meslin", cgst_rate: 0, sgst_rate: 0, igst_rate: 0, is_exempt: 1 },
  { hsn_code: "1006", description: "Rice", cgst_rate: 0, sgst_rate: 0, igst_rate: 0, is_exempt: 1 },

  // --- 5% slab ---
  { hsn_code: "0902", description: "Tea, whether or not flavoured", cgst_rate: 2.5, sgst_rate: 2.5, igst_rate: 5, is_exempt: 0 },
  { hsn_code: "0901", description: "Coffee, whether or not roasted", cgst_rate: 2.5, sgst_rate: 2.5, igst_rate: 5, is_exempt: 0 },
  { hsn_code: "1701", description: "Cane or beet sugar", cgst_rate: 2.5, sgst_rate: 2.5, igst_rate: 5, is_exempt: 0 },
  { hsn_code: "1507", description: "Soya-bean oil and its fractions", cgst_rate: 2.5, sgst_rate: 2.5, igst_rate: 5, is_exempt: 0 },
  { hsn_code: "2710", description: "Petroleum oils (other than crude)", cgst_rate: 2.5, sgst_rate: 2.5, igst_rate: 5, is_exempt: 0 },
  { hsn_code: "3004", description: "Medicaments (pharmaceutical formulations)", cgst_rate: 2.5, sgst_rate: 2.5, igst_rate: 5, is_exempt: 0 },
  { hsn_code: "6403", description: "Footwear with leather uppers (≤ ₹1000)", cgst_rate: 2.5, sgst_rate: 2.5, igst_rate: 5, is_exempt: 0 },

  // --- 12% slab ---
  { hsn_code: "0405", description: "Butter and other fats and oils derived from milk", cgst_rate: 6, sgst_rate: 6, igst_rate: 12, is_exempt: 0 },
  { hsn_code: "2009", description: "Fruit or vegetable juices", cgst_rate: 6, sgst_rate: 6, igst_rate: 12, is_exempt: 0 },
  { hsn_code: "4820", description: "Registers, account books, note books, diaries", cgst_rate: 6, sgst_rate: 6, igst_rate: 12, is_exempt: 0 },
  { hsn_code: "6109", description: "T-shirts, singlets and other vests, knitted", cgst_rate: 6, sgst_rate: 6, igst_rate: 12, is_exempt: 0 },
  { hsn_code: "8517", description: "Telephone sets, including smartphones", cgst_rate: 6, sgst_rate: 6, igst_rate: 12, is_exempt: 0 },

  // --- 18% slab (most common) ---
  { hsn_code: "3208", description: "Paints and varnishes (non-aqueous medium)", cgst_rate: 9, sgst_rate: 9, igst_rate: 18, is_exempt: 0 },
  { hsn_code: "3401", description: "Soap; organic surface-active products", cgst_rate: 9, sgst_rate: 9, igst_rate: 18, is_exempt: 0 },
  { hsn_code: "3923", description: "Plastic articles for the conveyance / packing of goods", cgst_rate: 9, sgst_rate: 9, igst_rate: 18, is_exempt: 0 },
  { hsn_code: "4202", description: "Trunks, suit-cases, handbags, wallets", cgst_rate: 9, sgst_rate: 9, igst_rate: 18, is_exempt: 0 },
  { hsn_code: "4819", description: "Cartons, boxes, cases of paper or paperboard", cgst_rate: 9, sgst_rate: 9, igst_rate: 18, is_exempt: 0 },
  { hsn_code: "4901", description: "Printed books, brochures, leaflets", cgst_rate: 0, sgst_rate: 0, igst_rate: 0, is_exempt: 1 },
  { hsn_code: "7308", description: "Structures of iron or steel", cgst_rate: 9, sgst_rate: 9, igst_rate: 18, is_exempt: 0 },
  { hsn_code: "7318", description: "Screws, bolts, nuts, washers of iron or steel", cgst_rate: 9, sgst_rate: 9, igst_rate: 18, is_exempt: 0 },
  { hsn_code: "8413", description: "Pumps for liquids; liquid elevators", cgst_rate: 9, sgst_rate: 9, igst_rate: 18, is_exempt: 0 },
  { hsn_code: "8443", description: "Printing machinery; printers, copiers", cgst_rate: 9, sgst_rate: 9, igst_rate: 18, is_exempt: 0 },
  { hsn_code: "8471", description: "Automatic data-processing machines (computers, laptops)", cgst_rate: 9, sgst_rate: 9, igst_rate: 18, is_exempt: 0 },
  { hsn_code: "8504", description: "Electrical transformers, static converters, inductors", cgst_rate: 9, sgst_rate: 9, igst_rate: 18, is_exempt: 0 },
  { hsn_code: "8523", description: "Discs, tapes, solid-state non-volatile storage devices", cgst_rate: 9, sgst_rate: 9, igst_rate: 18, is_exempt: 0 },
  { hsn_code: "8528", description: "Monitors and projectors; television receivers", cgst_rate: 9, sgst_rate: 9, igst_rate: 18, is_exempt: 0 },
  { hsn_code: "8536", description: "Electrical apparatus for switching / protecting circuits", cgst_rate: 9, sgst_rate: 9, igst_rate: 18, is_exempt: 0 },
  { hsn_code: "9403", description: "Other furniture and parts thereof", cgst_rate: 9, sgst_rate: 9, igst_rate: 18, is_exempt: 0 },
  { hsn_code: "9405", description: "Lamps and lighting fittings", cgst_rate: 9, sgst_rate: 9, igst_rate: 18, is_exempt: 0 },

  // --- 28% slab ---
  { hsn_code: "2202", description: "Aerated waters, sweetened beverages", cgst_rate: 14, sgst_rate: 14, igst_rate: 28, is_exempt: 0 },
  { hsn_code: "2402", description: "Cigars, cheroots, cigarettes of tobacco", cgst_rate: 14, sgst_rate: 14, igst_rate: 28, is_exempt: 0 },
  { hsn_code: "8703", description: "Motor cars and other motor vehicles", cgst_rate: 14, sgst_rate: 14, igst_rate: 28, is_exempt: 0 },
  { hsn_code: "8711", description: "Motorcycles (including mopeds)", cgst_rate: 14, sgst_rate: 14, igst_rate: 28, is_exempt: 0 },

  // --- SAC (services) — 18% default ---
  { hsn_code: "998311", description: "Management consulting services", cgst_rate: 9, sgst_rate: 9, igst_rate: 18, is_exempt: 0 },
  { hsn_code: "998313", description: "Information technology consulting services", cgst_rate: 9, sgst_rate: 9, igst_rate: 18, is_exempt: 0 },
  { hsn_code: "998314", description: "Information technology design and development services", cgst_rate: 9, sgst_rate: 9, igst_rate: 18, is_exempt: 0 },
  { hsn_code: "998399", description: "Other professional, technical and business services", cgst_rate: 9, sgst_rate: 9, igst_rate: 18, is_exempt: 0 },
  { hsn_code: "997212", description: "Rental services of non-residential property", cgst_rate: 9, sgst_rate: 9, igst_rate: 18, is_exempt: 0 },
  { hsn_code: "996511", description: "Road transport services of goods", cgst_rate: 2.5, sgst_rate: 2.5, igst_rate: 5, is_exempt: 0 },
  { hsn_code: "996819", description: "Other delivery services", cgst_rate: 9, sgst_rate: 9, igst_rate: 18, is_exempt: 0 },
  { hsn_code: "999293", description: "Commercial training and coaching services", cgst_rate: 9, sgst_rate: 9, igst_rate: 18, is_exempt: 0 },
  { hsn_code: "998231", description: "Corporate tax consulting and preparation services", cgst_rate: 9, sgst_rate: 9, igst_rate: 18, is_exempt: 0 },
  { hsn_code: "998222", description: "Accounting and bookkeeping services", cgst_rate: 9, sgst_rate: 9, igst_rate: 18, is_exempt: 0 },
];

let _seeded: Promise<void> | null = null;

export function ensureHsnSeed(): Promise<void> {
  if (_seeded) return _seeded;
  _seeded = (async () => {
    await ensureHsnSchema();
    try {
      const existing = await safeBrainSelect<{ c: number }>(
        `SELECT COUNT(*) as c FROM hsn_master`,
      );
      const count = Number(existing[0]?.c ?? 0);
      // Always run INSERT OR IGNORE so newly added seed rows reach existing installs,
      // but skip the loop entirely if the table already has more than the seed size
      // (user-imported a much larger master).
      if (count > SEED.length * 4) return;
      for (const r of SEED) {
        await safeBrainExec(
          `INSERT OR IGNORE INTO hsn_master
             (hsn_code, description, cgst_rate, sgst_rate, igst_rate, is_exempt)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [r.hsn_code, r.description, r.cgst_rate, r.sgst_rate, r.igst_rate, r.is_exempt],
        );
      }
    } catch {
      // Never throw from a background seed — UI must keep working.
    }
  })();
  return _seeded;
}
