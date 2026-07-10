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

  // === Additional common trade HSN codes ===
  // Dairy / bakery / edible products
  { code: "0402", desc: "Milk and cream, concentrated / sweetened", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "0403", desc: "Yoghurt, buttermilk, curdled milk (not pre-packaged)", cgst: 0, sgst: 0, igst: 0 },
  { code: "0404", desc: "Whey and products of natural milk constituents", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "0407", desc: "Birds' eggs, in shell, fresh / preserved", cgst: 0, sgst: 0, igst: 0 },
  { code: "0409", desc: "Natural honey", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "0902", desc: "Tea, whether or not flavoured", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "0901", desc: "Coffee, whether or not roasted", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "0904", desc: "Pepper, dried or crushed", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "0908", desc: "Nutmeg, mace, cardamom", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "0910", desc: "Ginger, saffron, turmeric, thyme, bay leaves", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "1101", desc: "Wheat or meslin flour", cgst: 0, sgst: 0, igst: 0 },
  { code: "1509", desc: "Olive oil and its fractions", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "1511", desc: "Palm oil and its fractions", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "1517", desc: "Margarine, edible mixtures / preparations", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "1702", desc: "Other sugars incl. glucose, fructose, lactose", cgst: 9, sgst: 9, igst: 18 },
  { code: "1801", desc: "Cocoa beans, whole or broken", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "1806", desc: "Chocolate and food preparations containing cocoa", cgst: 9, sgst: 9, igst: 18 },
  { code: "1904", desc: "Prepared cereals (cornflakes, muesli, puffed rice)", cgst: 9, sgst: 9, igst: 18 },
  { code: "1901", desc: "Malt extract; food preparations of flour/starch", cgst: 9, sgst: 9, igst: 18 },
  { code: "2103", desc: "Sauces, ketchup, mixed condiments", cgst: 6, sgst: 6, igst: 12 },
  { code: "2104", desc: "Soups & broths, homogenised composite foods", cgst: 9, sgst: 9, igst: 18 },
  { code: "2106", desc: "Food preparations not elsewhere specified (namkeen, mixes)", cgst: 9, sgst: 9, igst: 18 },
  { code: "2203", desc: "Beer made from malt", cgst: 14, sgst: 14, igst: 28 },
  { code: "2402", desc: "Cigars, cheroots, cigarettes of tobacco", cgst: 14, sgst: 14, igst: 28 },
  { code: "2403", desc: "Manufactured tobacco, chewing tobacco", cgst: 14, sgst: 14, igst: 28 },

  // Chemicals & petroleum
  { code: "2523", desc: "Portland cement, aluminous cement, slag cement", cgst: 14, sgst: 14, igst: 28 },
  { code: "2710", desc: "Petroleum oils (other than crude), motor spirit, diesel", cgst: 0, sgst: 0, igst: 0 },
  { code: "2711", desc: "Petroleum gases (LPG, natural gas)", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "2803", desc: "Carbon (carbon blacks and other forms)", cgst: 9, sgst: 9, igst: 18 },
  { code: "2811", desc: "Other inorganic acids & oxides", cgst: 9, sgst: 9, igst: 18 },
  { code: "2833", desc: "Sulphates; alums; peroxosulphates", cgst: 9, sgst: 9, igst: 18 },
  { code: "2836", desc: "Carbonates; peroxocarbonates (incl. baking soda)", cgst: 9, sgst: 9, igst: 18 },
  { code: "2917", desc: "Polycarboxylic acids, their derivatives", cgst: 9, sgst: 9, igst: 18 },
  { code: "2933", desc: "Heterocyclic compounds with nitrogen hetero-atoms", cgst: 9, sgst: 9, igst: 18 },
  { code: "3105", desc: "Mineral or chemical fertilisers, packaged", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "3208", desc: "Paints & varnishes based on synthetic polymers", cgst: 9, sgst: 9, igst: 18 },
  { code: "3209", desc: "Paints & varnishes in aqueous medium", cgst: 9, sgst: 9, igst: 18 },
  { code: "3210", desc: "Other paints, varnishes; distempers", cgst: 9, sgst: 9, igst: 18 },
  { code: "3213", desc: "Artists', students' or signboard painters' colours", cgst: 6, sgst: 6, igst: 12 },
  { code: "3306", desc: "Preparations for oral or dental hygiene (toothpaste)", cgst: 9, sgst: 9, igst: 18 },
  { code: "3307", desc: "Shaving preparations, deodorants, bath preparations", cgst: 9, sgst: 9, igst: 18 },
  { code: "3402", desc: "Organic surface-active agents, detergents", cgst: 9, sgst: 9, igst: 18 },
  { code: "3406", desc: "Candles, tapers and the like", cgst: 6, sgst: 6, igst: 12 },
  { code: "3506", desc: "Prepared glues & adhesives, retail packs ≤1 kg", cgst: 9, sgst: 9, igst: 18 },
  { code: "3808", desc: "Insecticides, fungicides, herbicides, disinfectants", cgst: 9, sgst: 9, igst: 18 },
  { code: "3822", desc: "Diagnostic or laboratory reagents", cgst: 6, sgst: 6, igst: 12 },
  { code: "3824", desc: "Prepared binders for foundry moulds; chemical products n.e.s.", cgst: 9, sgst: 9, igst: 18 },

  // Plastics
  { code: "3901", desc: "Polymers of ethylene, in primary forms", cgst: 9, sgst: 9, igst: 18 },
  { code: "3902", desc: "Polymers of propylene / other olefins, primary forms", cgst: 9, sgst: 9, igst: 18 },
  { code: "3904", desc: "Polymers of vinyl chloride (PVC), primary forms", cgst: 9, sgst: 9, igst: 18 },
  { code: "3907", desc: "Polyacetals, polyesters, epoxide resins", cgst: 9, sgst: 9, igst: 18 },
  { code: "3917", desc: "Tubes, pipes & hoses of plastics", cgst: 9, sgst: 9, igst: 18 },
  { code: "3918", desc: "Floor coverings of plastics; wall / ceiling coverings", cgst: 9, sgst: 9, igst: 18 },
  { code: "3919", desc: "Self-adhesive plates, sheets, film of plastics", cgst: 9, sgst: 9, igst: 18 },
  { code: "3920", desc: "Plates, sheets, film of plastics, non-cellular", cgst: 9, sgst: 9, igst: 18 },
  { code: "3921", desc: "Other plates, sheets, film of plastics", cgst: 9, sgst: 9, igst: 18 },
  { code: "3922", desc: "Baths, wash-basins, WC seats & covers of plastics", cgst: 9, sgst: 9, igst: 18 },
  { code: "3924", desc: "Tableware, kitchenware, household articles of plastic", cgst: 9, sgst: 9, igst: 18 },
  { code: "3925", desc: "Builders' ware of plastics (tanks, doors, windows)", cgst: 9, sgst: 9, igst: 18 },

  // Rubber / leather
  { code: "4012", desc: "Retreaded or used pneumatic rubber tyres", cgst: 14, sgst: 14, igst: 28 },
  { code: "4013", desc: "Inner tubes of rubber", cgst: 9, sgst: 9, igst: 18 },
  { code: "4016", desc: "Other articles of vulcanised rubber", cgst: 9, sgst: 9, igst: 18 },
  { code: "4202", desc: "Trunks, suitcases, hand-bags, wallets", cgst: 9, sgst: 9, igst: 18 },
  { code: "4203", desc: "Articles of apparel & clothing accessories of leather", cgst: 9, sgst: 9, igst: 18 },

  // Wood / paper
  { code: "4407", desc: "Wood sawn or chipped lengthwise, >6 mm thick", cgst: 9, sgst: 9, igst: 18 },
  { code: "4410", desc: "Particle board, oriented strand board (OSB)", cgst: 9, sgst: 9, igst: 18 },
  { code: "4411", desc: "Fibreboard of wood (MDF, HDF)", cgst: 9, sgst: 9, igst: 18 },
  { code: "4412", desc: "Plywood, veneered panels, similar laminated wood", cgst: 9, sgst: 9, igst: 18 },
  { code: "4802", desc: "Uncoated paper / paperboard, writing / printing", cgst: 6, sgst: 6, igst: 12 },
  { code: "4818", desc: "Toilet paper, tissues, napkins, sanitary towels", cgst: 9, sgst: 9, igst: 18 },
  { code: "4909", desc: "Printed / illustrated postcards, greeting cards", cgst: 6, sgst: 6, igst: 12 },
  { code: "4910", desc: "Calendars of any kind, printed", cgst: 6, sgst: 6, igst: 12 },

  // Textiles / apparel
  { code: "5205", desc: "Cotton yarn (≥85% cotton), not put up for retail", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "5206", desc: "Cotton yarn (other than sewing thread)", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "5209", desc: "Woven cotton fabrics ≥85% cotton, >200 gsm", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "5210", desc: "Woven cotton fabrics <85% cotton, mixed synthetic", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "5402", desc: "Synthetic filament yarn (nylon, polyester)", cgst: 6, sgst: 6, igst: 12 },
  { code: "5408", desc: "Woven fabrics of artificial filament yarn", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "5509", desc: "Yarn of synthetic staple fibres, not retail", cgst: 6, sgst: 6, igst: 12 },
  { code: "5513", desc: "Woven fabrics of synthetic staple fibres <170 gsm", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "5514", desc: "Woven fabrics of synthetic staple fibres >170 gsm", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "5804", desc: "Tulles & other net fabrics; lace in the piece", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "5903", desc: "Textile fabrics impregnated / coated with plastics", cgst: 6, sgst: 6, igst: 12 },
  { code: "6006", desc: "Other knitted or crocheted fabrics", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "6110", desc: "Jerseys, pullovers, cardigans, waistcoats, knitted", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "6115", desc: "Panty hose, tights, stockings, socks, knitted", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "6206", desc: "Women's blouses, shirts and shirt-blouses", cgst: 6, sgst: 6, igst: 12 },
  { code: "6210", desc: "Garments made up of fabrics of headings 5602/5903", cgst: 6, sgst: 6, igst: 12 },
  { code: "6217", desc: "Other made-up clothing accessories", cgst: 6, sgst: 6, igst: 12 },
  { code: "6304", desc: "Other furnishing articles (curtains, cushion covers)", cgst: 6, sgst: 6, igst: 12 },
  { code: "6305", desc: "Sacks & bags of textile materials for packing", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "6307", desc: "Other made-up textile articles (masks, floor cloths)", cgst: 2.5, sgst: 2.5, igst: 5 },

  // Ceramics / glass / stone
  { code: "6802", desc: "Worked monumental / building stone (granite, marble)", cgst: 9, sgst: 9, igst: 18 },
  { code: "6810", desc: "Articles of cement, concrete, artificial stone", cgst: 9, sgst: 9, igst: 18 },
  { code: "6910", desc: "Ceramic sinks, wash-basins, WC pans, urinals", cgst: 9, sgst: 9, igst: 18 },
  { code: "7003", desc: "Cast glass & rolled glass, in sheets", cgst: 9, sgst: 9, igst: 18 },
  { code: "7005", desc: "Float glass & polished glass, in sheets", cgst: 9, sgst: 9, igst: 18 },
  { code: "7013", desc: "Glassware for table, kitchen, toilet, office", cgst: 9, sgst: 9, igst: 18 },

  // Iron & steel, metals
  { code: "7204", desc: "Ferrous waste and scrap; remelting ingots", cgst: 9, sgst: 9, igst: 18 },
  { code: "7208", desc: "Flat-rolled iron/steel ≥600 mm wide, hot-rolled", cgst: 9, sgst: 9, igst: 18 },
  { code: "7209", desc: "Flat-rolled iron/steel ≥600 mm wide, cold-rolled", cgst: 9, sgst: 9, igst: 18 },
  { code: "7210", desc: "Flat-rolled iron/steel, clad, plated or coated", cgst: 9, sgst: 9, igst: 18 },
  { code: "7213", desc: "Bars & rods of iron/steel, hot-rolled in coils", cgst: 9, sgst: 9, igst: 18 },
  { code: "7215", desc: "Other bars & rods of iron/non-alloy steel", cgst: 9, sgst: 9, igst: 18 },
  { code: "7217", desc: "Wire of iron / non-alloy steel", cgst: 9, sgst: 9, igst: 18 },
  { code: "7304", desc: "Tubes, pipes, hollow profiles, seamless, iron/steel", cgst: 9, sgst: 9, igst: 18 },
  { code: "7305", desc: "Other tubes and pipes (welded, dia >406.4 mm)", cgst: 9, sgst: 9, igst: 18 },
  { code: "7306", desc: "Other tubes, pipes & hollow profiles of iron/steel", cgst: 9, sgst: 9, igst: 18 },
  { code: "7307", desc: "Tube or pipe fittings of iron/steel", cgst: 9, sgst: 9, igst: 18 },
  { code: "7310", desc: "Tanks, casks, drums, cans, boxes of iron/steel", cgst: 9, sgst: 9, igst: 18 },
  { code: "7315", desc: "Chain and parts thereof, of iron/steel", cgst: 9, sgst: 9, igst: 18 },
  { code: "7320", desc: "Springs & leaves for springs, of iron/steel", cgst: 9, sgst: 9, igst: 18 },
  { code: "7321", desc: "Stoves, ranges, grates, cookers, barbecues", cgst: 9, sgst: 9, igst: 18 },
  { code: "7323", desc: "Table, kitchen or household articles of iron/steel", cgst: 9, sgst: 9, igst: 18 },
  { code: "7325", desc: "Other cast articles of iron / steel", cgst: 9, sgst: 9, igst: 18 },
  { code: "7326", desc: "Other articles of iron or steel", cgst: 9, sgst: 9, igst: 18 },
  { code: "7407", desc: "Copper bars, rods & profiles", cgst: 9, sgst: 9, igst: 18 },
  { code: "7408", desc: "Copper wire", cgst: 9, sgst: 9, igst: 18 },
  { code: "7604", desc: "Aluminium bars, rods and profiles", cgst: 9, sgst: 9, igst: 18 },
  { code: "7606", desc: "Aluminium plates, sheets & strip, >0.2 mm", cgst: 9, sgst: 9, igst: 18 },
  { code: "7610", desc: "Aluminium structures & parts (doors, windows)", cgst: 9, sgst: 9, igst: 18 },

  // Machinery, electrical, electronics
  { code: "8407", desc: "Spark-ignition reciprocating internal combustion engines", cgst: 14, sgst: 14, igst: 28 },
  { code: "8408", desc: "Compression-ignition internal combustion (diesel) engines", cgst: 14, sgst: 14, igst: 28 },
  { code: "8409", desc: "Parts for engines of headings 8407/8408", cgst: 14, sgst: 14, igst: 28 },
  { code: "8414", desc: "Air / vacuum pumps; compressors; fans; hoods", cgst: 9, sgst: 9, igst: 18 },
  { code: "8415", desc: "Air conditioning machines, motor-driven", cgst: 14, sgst: 14, igst: 28 },
  { code: "8418", desc: "Refrigerators, freezers, heat pumps", cgst: 14, sgst: 14, igst: 28 },
  { code: "8419", desc: "Machinery for heat treatment of materials", cgst: 9, sgst: 9, igst: 18 },
  { code: "8421", desc: "Centrifuges; filtering / purifying machinery", cgst: 9, sgst: 9, igst: 18 },
  { code: "8422", desc: "Dish washing machines; packaging machinery", cgst: 9, sgst: 9, igst: 18 },
  { code: "8423", desc: "Weighing machinery (excl. sensitive to 5 cg or better)", cgst: 9, sgst: 9, igst: 18 },
  { code: "8424", desc: "Mechanical appliances for projecting / spraying liquids", cgst: 9, sgst: 9, igst: 18 },
  { code: "8425", desc: "Pulley tackle, hoists, winches, capstans", cgst: 9, sgst: 9, igst: 18 },
  { code: "8428", desc: "Other lifting, handling, loading machinery", cgst: 9, sgst: 9, igst: 18 },
  { code: "8443", desc: "Printing machinery; ink-jet printers; parts", cgst: 9, sgst: 9, igst: 18 },
  { code: "8450", desc: "Household or laundry-type washing machines", cgst: 9, sgst: 9, igst: 18 },
  { code: "8452", desc: "Sewing machines; furniture, bases & covers", cgst: 6, sgst: 6, igst: 12 },
  { code: "8481", desc: "Taps, cocks, valves & similar appliances", cgst: 9, sgst: 9, igst: 18 },
  { code: "8482", desc: "Ball or roller bearings", cgst: 9, sgst: 9, igst: 18 },
  { code: "8483", desc: "Transmission shafts, gears, gearing, ball screws", cgst: 9, sgst: 9, igst: 18 },
  { code: "8501", desc: "Electric motors and generators", cgst: 9, sgst: 9, igst: 18 },
  { code: "8506", desc: "Primary cells and primary batteries", cgst: 9, sgst: 9, igst: 18 },
  { code: "8507", desc: "Electric accumulators, incl. lead-acid, Li-ion", cgst: 14, sgst: 14, igst: 28 },
  { code: "8508", desc: "Vacuum cleaners", cgst: 9, sgst: 9, igst: 18 },
  { code: "8509", desc: "Electro-mechanical domestic appliances", cgst: 9, sgst: 9, igst: 18 },
  { code: "8513", desc: "Portable electric lamps with self-contained energy", cgst: 9, sgst: 9, igst: 18 },
  { code: "8516", desc: "Electric heaters, hair dryers, irons, microwave ovens", cgst: 9, sgst: 9, igst: 18 },
  { code: "8518", desc: "Microphones, loudspeakers, headphones, amplifiers", cgst: 9, sgst: 9, igst: 18 },
  { code: "8521", desc: "Video recording / reproducing apparatus", cgst: 9, sgst: 9, igst: 18 },
  { code: "8523", desc: "Discs, tapes, solid-state storage devices, SSDs", cgst: 9, sgst: 9, igst: 18 },
  { code: "8525", desc: "Transmission apparatus; television cameras; DVR", cgst: 9, sgst: 9, igst: 18 },
  { code: "8536", desc: "Electrical apparatus for switching / protecting (switches)", cgst: 9, sgst: 9, igst: 18 },
  { code: "8537", desc: "Boards, panels, consoles for electric control", cgst: 9, sgst: 9, igst: 18 },
  { code: "8538", desc: "Parts for apparatus of 8535, 8536, 8537", cgst: 9, sgst: 9, igst: 18 },
  { code: "8539", desc: "Electric filament / discharge lamps, LEDs, tubes", cgst: 9, sgst: 9, igst: 18 },
  { code: "8541", desc: "Semiconductor devices, LEDs, mounted piezo crystals", cgst: 9, sgst: 9, igst: 18 },
  { code: "8542", desc: "Electronic integrated circuits", cgst: 9, sgst: 9, igst: 18 },
  { code: "8543", desc: "Electrical machines & apparatus, individual functions", cgst: 9, sgst: 9, igst: 18 },

  // Vehicles / instruments / furniture
  { code: "8702", desc: "Motor vehicles for transport of ≥10 persons (buses)", cgst: 14, sgst: 14, igst: 28 },
  { code: "8704", desc: "Motor vehicles for transport of goods (trucks)", cgst: 14, sgst: 14, igst: 28 },
  { code: "8708", desc: "Parts & accessories of motor vehicles", cgst: 14, sgst: 14, igst: 28 },
  { code: "8711", desc: "Motorcycles and cycles with auxiliary motor", cgst: 14, sgst: 14, igst: 28 },
  { code: "8712", desc: "Bicycles and other cycles, not motorised", cgst: 6, sgst: 6, igst: 12 },
  { code: "8714", desc: "Parts & accessories of cycles and motorcycles", cgst: 9, sgst: 9, igst: 18 },
  { code: "9004", desc: "Spectacles, goggles and the like", cgst: 9, sgst: 9, igst: 18 },
  { code: "9021", desc: "Orthopaedic appliances, hearing aids, pacemakers", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "9025", desc: "Hydrometers, thermometers, barometers", cgst: 9, sgst: 9, igst: 18 },
  { code: "9028", desc: "Gas / liquid / electricity supply / production meters", cgst: 9, sgst: 9, igst: 18 },
  { code: "9401", desc: "Seats (other than of 9402), whether or not convertible", cgst: 9, sgst: 9, igst: 18 },
  { code: "9404", desc: "Mattress supports; mattresses, quilts, pillows", cgst: 9, sgst: 9, igst: 18 },
  { code: "9405", desc: "Lamps and lighting fittings, LED luminaires", cgst: 9, sgst: 9, igst: 18 },
  { code: "9506", desc: "Articles & equipment for general physical exercise", cgst: 9, sgst: 9, igst: 18 },
  { code: "9603", desc: "Brooms, brushes, mops, feather dusters", cgst: 9, sgst: 9, igst: 18 },
  { code: "9608", desc: "Ball point pens; felt tipped pens, markers", cgst: 9, sgst: 9, igst: 18 },
  { code: "9609", desc: "Pencils, crayons, pastels, chalks", cgst: 6, sgst: 6, igst: 12 },
  { code: "9611", desc: "Date, sealing, or numbering stamps", cgst: 9, sgst: 9, igst: 18 },

  // Additional SAC — professional services
  { code: "99721", desc: "Real estate services on own property", cgst: 9, sgst: 9, igst: 18 },
  { code: "99722", desc: "Real estate services on a fee / commission basis", cgst: 9, sgst: 9, igst: 18 },
  { code: "998311", desc: "Management consulting services", cgst: 9, sgst: 9, igst: 18 },
  { code: "998312", desc: "Business consulting services", cgst: 9, sgst: 9, igst: 18 },
  { code: "998313", desc: "IT consulting services", cgst: 9, sgst: 9, igst: 18 },
  { code: "998314", desc: "IT design & development services", cgst: 9, sgst: 9, igst: 18 },
  { code: "998315", desc: "Hosting & IT infrastructure provisioning", cgst: 9, sgst: 9, igst: 18 },
  { code: "998316", desc: "IT infrastructure & network management services", cgst: 9, sgst: 9, igst: 18 },
  { code: "998319", desc: "Other IT services n.e.c.", cgst: 9, sgst: 9, igst: 18 },
  { code: "998399", desc: "Other professional / technical / business services", cgst: 9, sgst: 9, igst: 18 },
  { code: "998596", desc: "Events, exhibitions, conferences & trade shows", cgst: 9, sgst: 9, igst: 18 },
  { code: "998713", desc: "Repair services of consumer electronics", cgst: 9, sgst: 9, igst: 18 },
  { code: "999293", desc: "Commercial training & coaching services", cgst: 9, sgst: 9, igst: 18 },
  { code: "996511", desc: "Road transport services of goods (GTA — RCM 5%)", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "996812", desc: "Courier services", cgst: 9, sgst: 9, igst: 18 },
  { code: "997212", desc: "Rental / leasing of non-residential property", cgst: 9, sgst: 9, igst: 18 },
  { code: "997221", desc: "Rental services of residential property (exempt if for residence)", cgst: 0, sgst: 0, igst: 0 },
  { code: "997331", desc: "Licensing services for computer software (SaaS)", cgst: 9, sgst: 9, igst: 18 },
  { code: "998821", desc: "Textile manufacturing services (job work)", cgst: 2.5, sgst: 2.5, igst: 5 },
  { code: "998873", desc: "Job work related to manufacturing of goods", cgst: 6, sgst: 6, igst: 12 },
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
