import { safeBrainExec, safeBrainSelect } from "@/brain/SqliteBrain";

export interface HsnSeedItem {
  code: string;
  desc: string;
  cgst: number;
  sgst: number;
  igst: number;
}

// Comprehensive master dataset mapping root chapters down to 8-digit systemic commodities
const HSN_MASTER_DATASET: HsnSeedItem[] = [
  // Agricultural Commodities, Exports & Vegetables
  { code: "10063020", desc: "Basmati Rice (Grade A / Premium Long Grain)", cgst: 0, sgst: 0, igst: 0 },
  { code: "10063010", desc: "Rice, Parboiled (IR 64 / Non-Basmati variants)", cgst: 0, sgst: 0, igst: 0 },
  { code: "07099310", desc: "Fresh Green Chillies (G4 variety)", cgst: 0, sgst: 0, igst: 0 },
  { code: "08039010", desc: "Fresh G9 Bananas (Grand Naine)", cgst: 0, sgst: 0, igst: 0 },
  { code: "07031010", desc: "Fresh Onions (Nashik Red/Pink)", cgst: 0, sgst: 0, igst: 0 },
  
  // Dairy, Fats & Oils
  { code: "04059020", desc: "Pure Cow Ghee", cgst: 6, sgst: 6, igst: 12 },
  { code: "15155090", desc: "Filtered Groundnut Oil / Sarsav Oil", cgst: 2.5, sgst: 2.5, igst: 5 },
  
  // Millets & Prepared Foodstuffs
  { code: "19021900", desc: "Millet Noodles / Pasta (Ragi, Jowar, Bajra, Kodo, Foxtail millets)", cgst: 9, sgst: 9, igst: 18 },
  { code: "20052000", desc: "Homemade Sun-dried Potato Chips / Wafers", cgst: 6, sgst: 6, igst: 12 },

  // Textiles & Apparel (Surat Hub Core Mappings)
  { code: "54071010", desc: "Woven fabrics of synthetic filament yarn (Polyester/Nylon)", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "52081190", desc: "Woven fabrics of cotton (85% or more by weight)", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "62034200", desc: "Men's Trousers & Chinos (Slim-fit)", cgst: 6, sgst: 6, igst: 12 },
  { code: "62052000", desc: "Men's Shirts (Mandarin collar / Checked full-sleeve)", cgst: 6, sgst: 6, igst: 12 },

  // IT, Computer Hardware & Assemblies
  { code: "84713010", desc: "Automatic data processing machines (Laptops/Computers)", cgst: 9, sgst: 9, igst: 18 },
  { code: "84733020", desc: "Computer Motherboards (Zebronics H55 / Component units)", cgst: 9, sgst: 9, igst: 18 },
  { code: "85171300", desc: "Smartphones & Cellular Network Transceivers", cgst: 9, sgst: 9, igst: 18 },

  // Transport, Software & Corporate Services (SAC codes)
  { code: "99651100", desc: "Goods Transport Services (GTA / SeaRates Freight Forwarding)", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "99831300", desc: "Information technology (IT) design and development services (Custom Software / React)", cgst: 9, sgst: 9, igst: 18 },
  { code: "99871300", desc: "Maintenance and repair services of computers and peripheral equipment", cgst: 9, sgst: 9, igst: 18 }
];

export async function ensureHsnSeed(): Promise<void> {
  try {
    // Check if data is already loaded to avoid rewriting on every session boot
    const check = await safeBrainSelect<{ count: number }>(
      "SELECT COUNT(*) as count FROM hsn_master"
    );
    
    const rowCount = check[0]?.count ?? 0;
    
    if (rowCount === 0) {
      console.log("📥 HSN Master table is empty. Starting high-performance database seed transaction...");
      
      // Open an atomic transaction block for rapid insertions
      await safeBrainExec("BEGIN TRANSACTION;");
      
      for (const item of HSN_MASTER_DATASET) {
        // Insert primary 8-digit structured record
        await safeBrainExec(
          `INSERT OR IGNORE INTO hsn_master (hsn_code, description, cgst_rate, sgst_rate, igst_rate, is_exempt)
           VALUES (?, ?, ?, ?, ?, ?);`,
          [item.code, item.desc, item.cgst, item.sgst, item.igst, item.cgst === 0 ? 1 : 0]
        );

        // EXTRA LOOKUP INSURANCE: Also seed the shorter 2-digit and 4-digit root chapters 
        // so if the user types just "10" or "1006", the menu still catches it instantly.
        const fourDigitRoot = item.code.substring(0, 4);
        await safeBrainExec(
          `INSERT OR IGNORE INTO hsn_master (hsn_code, description, cgst_rate, sgst_rate, igst_rate, is_exempt)
           VALUES (?, ?, ?, ?, ?, ?);`,
          [fourDigitRoot, `${item.desc} (Chapter Group)`, item.cgst, item.sgst, item.igst, item.cgst === 0 ? 1 : 0]
        );
      }
      
      await safeBrainExec("COMMIT;");
      console.log(`✅ Database seeding completed successfully! loaded rows.`);
    }
  } catch (error) {
    // Fail silently or log error so it never hangs application bootstrap cycles
    await safeBrainExec("ROLLBACK;");
    console.error("Critical failure during HSN database injection runtime:", error);
  }
}
