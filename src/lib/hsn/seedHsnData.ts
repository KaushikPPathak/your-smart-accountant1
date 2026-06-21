import { safeBrainExec, safeBrainSelect } from "@/brain/SqliteBrain";

export interface HsnSeedItem {
  code: string;
  desc: string;
  cgst: number;
  sgst: number;
  igst: number;
}

// Comprehensive HSN/SAC master dataset — common Indian trade & service codes.
// Covers Chapters 04, 07, 08, 10, 15, 17, 19, 20, 22, 30, 33, 39, 40, 44, 48, 49,
// 52, 54, 61, 62, 63, 64, 69, 72, 73, 84, 85, 87, 90, 94, 95 and key SAC ranges.
export const HSN_MASTER_DATASET: HsnSeedItem[] = [
  // === Chapter 04 — Dairy ===
  { code: "0401", desc: "Fresh milk and cream, not concentrated", cgst: 0, sgst: 0, igst: 0 },
  { code: "0406", desc: "Cheese and curd", cgst: 6, sgst: 6, igst: 12 },
  { code: "04059020", desc: "Pure cow ghee", cgst: 6, sgst: 6, igst: 12 },

  // === Chapter 07/08 — Vegetables & Fruits ===
  { code: "0701", desc: "Potatoes, fresh or chilled", cgst: 0, sgst: 0, igst: 0 },
  { code: "0703", desc: "Onions, shallots, garlic, leeks", cgst: 0, sgst: 0, igst: 0 },
  { code: "0709", desc: "Other vegetables, fresh or chilled", cgst: 0, sgst: 0, igst: 0 },
  { code: "0803", desc: "Bananas, including plantains", cgst: 0, sgst: 0, igst: 0 },
  { code: "0805", desc: "Citrus fruit, fresh or dried", cgst: 0, sgst: 0, igst: 0 },

  // === Chapter 10 — Cereals ===
  // Loose / unbranded grain = NIL. Pre-packaged & labelled retail packs ≤ 25 kg = 5%.
  { code: "1006", desc: "Rice — loose / unbranded (not pre-packaged)", cgst: 0, sgst: 0, igst: 0 },
  { code: "1006_PP", desc: "Rice — pre-packaged & labelled, pack ≤ 25 kg (branded retail)", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "10063020", desc: "Basmati rice — loose / unbranded, premium long grain", cgst: 0, sgst: 0, igst: 0 },
  { code: "10063020_PP", desc: "Basmati rice — pre-packaged & labelled ≤ 25 kg (branded)", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "1001", desc: "Wheat & meslin — loose / unbranded", cgst: 0, sgst: 0, igst: 0 },
  { code: "1001_PP", desc: "Wheat & meslin — pre-packaged & labelled ≤ 25 kg (branded)", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "1101", desc: "Wheat flour / atta — loose / unbranded", cgst: 0, sgst: 0, igst: 0 },
  { code: "1101_PP", desc: "Wheat flour / atta — pre-packaged & labelled ≤ 25 kg (branded)", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "1102", desc: "Cereal flours (maize, jowar, bajra) — loose / unbranded", cgst: 0, sgst: 0, igst: 0 },
  { code: "1102_PP", desc: "Cereal flours — pre-packaged & labelled ≤ 25 kg (branded)", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "0713", desc: "Pulses (dal, chana, moong, tur) — loose / unbranded", cgst: 0, sgst: 0, igst: 0 },
  { code: "0713_PP", desc: "Pulses — pre-packaged & labelled ≤ 25 kg (branded)", cgst: 2.5, sgst: 2.5, igst: 5 },

  // === Chapter 15 — Oils & Fats ===
  { code: "1507", desc: "Soya-bean oil and its fractions", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "1512", desc: "Sunflower / safflower / cotton-seed oil", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "1515", desc: "Other fixed vegetable fats and oils", cgst: 2.5, sgst: 2.5, igst: 5 },

  // === Chapter 17 — Sugars ===
  { code: "1701", desc: "Cane or beet sugar, refined", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "1704", desc: "Sugar confectionery (incl. white chocolate)", cgst: 9, sgst: 9, igst: 18 },

  // === Chapter 19/20 — Prepared foods ===
  { code: "1902", desc: "Pasta, noodles, couscous", cgst: 9, sgst: 9, igst: 18 },
  { code: "1905", desc: "Biscuits, bread, pastry, cakes", cgst: 9, sgst: 9, igst: 18 },
  { code: "2005", desc: "Other prepared / preserved vegetables", cgst: 6, sgst: 6, igst: 12 },

  // === Chapter 22 — Beverages ===
  { code: "2201", desc: "Mineral / aerated waters, unsweetened", cgst: 9, sgst: 9, igst: 18 },
  { code: "2202", desc: "Aerated / flavoured waters, soft drinks", cgst: 14, sgst: 14, igst: 28 },

  // === Chapter 30 — Pharmaceuticals ===
  { code: "3003", desc: "Medicaments (mixed), not in dosage form", cgst: 6, sgst: 6, igst: 12 },
  { code: "3004", desc: "Medicaments in measured doses / retail", cgst: 6, sgst: 6, igst: 12 },

  // === Chapter 33 — Cosmetics ===
  { code: "3304", desc: "Beauty / make-up & skin-care preparations", cgst: 9, sgst: 9, igst: 18 },
  { code: "3305", desc: "Hair preparations (shampoo, oil, dye)", cgst: 9, sgst: 9, igst: 18 },
  { code: "3401", desc: "Soap, organic surface-active products", cgst: 9, sgst: 9, igst: 18 },

  // === Chapter 39/40 — Plastics & Rubber ===
  { code: "3923", desc: "Plastic articles for packing of goods", cgst: 9, sgst: 9, igst: 18 },
  { code: "3926", desc: "Other articles of plastics", cgst: 9, sgst: 9, igst: 18 },
  { code: "4011", desc: "New pneumatic tyres of rubber", cgst: 14, sgst: 14, igst: 28 },

  // === Chapter 44 — Wood ===
  { code: "4418", desc: "Builders' joinery & carpentry of wood", cgst: 9, sgst: 9, igst: 18 },

  // === Chapter 48 — Paper & paperboard (Surat / stationery trade) ===
  { code: "4801", desc: "Newsprint, in rolls or sheets", cgst: 6, sgst: 6, igst: 12 },
  { code: "4802", desc: "Uncoated paper & paperboard for writing/printing (incl. A4, copier, bond)", cgst: 6, sgst: 6, igst: 12 },
  { code: "48025410", desc: "Uncoated paper 40-150 gsm (e.g. A4 70 GSM copier sheets)", cgst: 6, sgst: 6, igst: 12 },
  { code: "48025610", desc: "Uncoated paper in sheets ≥150 gsm (printing & writing)", cgst: 6, sgst: 6, igst: 12 },
  { code: "4803", desc: "Toilet / facial tissue, towel paper", cgst: 9, sgst: 9, igst: 18 },
  { code: "4804", desc: "Uncoated kraft paper & paperboard, in rolls", cgst: 6, sgst: 6, igst: 12 },
  { code: "4805", desc: "Other uncoated paper / paperboard", cgst: 6, sgst: 6, igst: 12 },
  { code: "4810", desc: "Paper / paperboard coated with kaolin", cgst: 6, sgst: 6, igst: 12 },
  { code: "4811", desc: "Paper / paperboard coated, impregnated", cgst: 9, sgst: 9, igst: 18 },
  { code: "4817", desc: "Envelopes, letter cards, postcards", cgst: 9, sgst: 9, igst: 18 },
  { code: "4819", desc: "Cartons, boxes, cases of paper / board", cgst: 6, sgst: 6, igst: 12 },
  { code: "4820", desc: "Registers, ledgers, notebooks, diaries", cgst: 9, sgst: 9, igst: 18 },
  { code: "4821", desc: "Paper / paperboard labels, printed or not", cgst: 9, sgst: 9, igst: 18 },
  { code: "4823", desc: "Other paper / paperboard, cut to size", cgst: 9, sgst: 9, igst: 18 },

  // === Chapter 49 — Printed matter ===
  { code: "4901", desc: "Printed books, brochures, leaflets", cgst: 0, sgst: 0, igst: 0 },
  { code: "4911", desc: "Other printed matter, pictures, photos", cgst: 6, sgst: 6, igst: 12 },

  // === Chapter 52/54 — Textile fabrics ===
  { code: "5208", desc: "Woven cotton fabrics ≥85% cotton, ≤200 gsm", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "5407", desc: "Woven fabrics of synthetic filament yarn", cgst: 2.5, sgst: 2.5, igst: 5 },

  // === Chapter 61/62/63 — Apparel & made-ups ===
  { code: "6109", desc: "T-shirts, singlets, vests, knitted", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "6203", desc: "Men's suits, jackets, trousers, shorts", cgst: 6, sgst: 6, igst: 12 },
  { code: "6204", desc: "Women's suits, dresses, skirts, trousers", cgst: 6, sgst: 6, igst: 12 },
  { code: "6205", desc: "Men's shirts", cgst: 6, sgst: 6, igst: 12 },
  { code: "6302", desc: "Bed linen, table linen, toilet & kitchen linen", cgst: 6, sgst: 6, igst: 12 },

  // === Chapter 64 — Footwear ===
  { code: "6403", desc: "Footwear, leather uppers", cgst: 9, sgst: 9, igst: 18 },
  { code: "6404", desc: "Footwear, textile uppers", cgst: 9, sgst: 9, igst: 18 },

  // === Chapter 69 — Ceramic ===
  { code: "6907", desc: "Ceramic flags & tiles, paving / hearth", cgst: 9, sgst: 9, igst: 18 },

  // === Chapter 72/73 — Iron & Steel ===
  { code: "7214", desc: "Bars & rods, hot-rolled, iron / non-alloy steel", cgst: 9, sgst: 9, igst: 18 },
  { code: "7308", desc: "Structures & parts (bridges, towers) of iron/steel", cgst: 9, sgst: 9, igst: 18 },
  { code: "7318", desc: "Screws, bolts, nuts, rivets of iron / steel", cgst: 9, sgst: 9, igst: 18 },

  // === Chapter 84/85 — Machinery, computers & electrical ===
  { code: "8413", desc: "Pumps for liquids; liquid elevators", cgst: 9, sgst: 9, igst: 18 },
  { code: "8471", desc: "Automatic data-processing machines (laptops, PCs)", cgst: 9, sgst: 9, igst: 18 },
  { code: "8473", desc: "Parts & accessories for machines of 8471", cgst: 9, sgst: 9, igst: 18 },
  { code: "8504", desc: "Electrical transformers, static converters, inductors", cgst: 9, sgst: 9, igst: 18 },
  { code: "8517", desc: "Telephone sets incl. smartphones; network apparatus", cgst: 9, sgst: 9, igst: 18 },
  { code: "8528", desc: "Monitors, projectors, television receivers", cgst: 9, sgst: 9, igst: 18 },
  { code: "8544", desc: "Insulated wire, cable, optical fibre cables", cgst: 9, sgst: 9, igst: 18 },

  // === Chapter 87/90/94/95 ===
  { code: "8703", desc: "Motor cars & vehicles for transport of persons", cgst: 14, sgst: 14, igst: 28 },
  { code: "9018", desc: "Medical, surgical, dental or veterinary instruments", cgst: 6, sgst: 6, igst: 12 },
  { code: "9403", desc: "Other furniture and parts thereof", cgst: 9, sgst: 9, igst: 18 },
  { code: "9503", desc: "Tricycles, scooters, dolls, toys, puzzles", cgst: 6, sgst: 6, igst: 12 },

  // === SAC — Services ===
  { code: "9954", desc: "Construction services", cgst: 9, sgst: 9, igst: 18 },
  { code: "9961", desc: "Wholesale trade services (commission / fee basis)", cgst: 9, sgst: 9, igst: 18 },
  { code: "9962", desc: "Retail trade services (commission / fee basis)", cgst: 9, sgst: 9, igst: 18 },
  { code: "9965", desc: "Goods transport services", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "99651100", desc: "Road transport services of goods (GTA)", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "9966", desc: "Rental services of transport vehicles", cgst: 9, sgst: 9, igst: 18 },
  { code: "9971", desc: "Financial and related services", cgst: 9, sgst: 9, igst: 18 },
  { code: "9972", desc: "Real estate services", cgst: 9, sgst: 9, igst: 18 },
  { code: "9973", desc: "Leasing or rental services (without operator)", cgst: 9, sgst: 9, igst: 18 },
  { code: "9983", desc: "Other professional, technical & business services", cgst: 9, sgst: 9, igst: 18 },
  { code: "99831", desc: "Management consulting & management services", cgst: 9, sgst: 9, igst: 18 },
  { code: "99831300", desc: "IT design & development services (custom software)", cgst: 9, sgst: 9, igst: 18 },
  { code: "9984", desc: "Telecommunications, broadcasting, information services", cgst: 9, sgst: 9, igst: 18 },
  { code: "9985", desc: "Support services", cgst: 9, sgst: 9, igst: 18 },
  { code: "9987", desc: "Maintenance, repair & installation services", cgst: 9, sgst: 9, igst: 18 },
  { code: "99871300", desc: "Maintenance & repair of computers and peripherals", cgst: 9, sgst: 9, igst: 18 },
  { code: "9988", desc: "Manufacturing services on physical inputs (job work)", cgst: 6, sgst: 6, igst: 12 },
  { code: "9991", desc: "Public administration services", cgst: 9, sgst: 9, igst: 18 },
  { code: "9992", desc: "Education services", cgst: 0, sgst: 0, igst: 0 },
  { code: "9993", desc: "Human health and social care services", cgst: 0, sgst: 0, igst: 0 },
];

export async function ensureHsnSeed(): Promise<void> {
  try {
    const check = await safeBrainSelect<{ count: number }>(
      "SELECT COUNT(*) as count FROM hsn_master"
    );
    const rowCount = check[0]?.count ?? 0;

    // Re-seed when empty OR when our dataset has grown beyond what's stored
    // (so users on an older sparse seed automatically pick up the expanded list).
    if (rowCount < HSN_MASTER_DATASET.length) {
      await safeBrainExec("BEGIN TRANSACTION;");
      for (const item of HSN_MASTER_DATASET) {
        await safeBrainExec(
          `INSERT OR REPLACE INTO hsn_master (hsn_code, description, cgst_rate, sgst_rate, igst_rate, is_exempt)
           VALUES (?, ?, ?, ?, ?, ?);`,
          [item.code, item.desc, item.cgst, item.sgst, item.igst, item.igst === 0 ? 1 : 0]
        );
      }
      await safeBrainExec("COMMIT;");
      console.log(`✅ HSN master seeded with ${HSN_MASTER_DATASET.length} codes.`);
    }
  } catch (error) {
    try { await safeBrainExec("ROLLBACK;"); } catch { /* ignore */ }
    console.error("HSN seeding failed:", error);
  }
}
