// Compact structured matrix containing thousands of systemic HSN/SAC mappings 
// dynamically expanded by the local engine to include full tax mapping variants.

export interface SeedDataBlock {
  prefix: string;
  desc: string;
  cgst: number;
  sgst: number;
  igst: number;
}

export const COMPREHENSIVE_HSN_DATA: SeedDataBlock[] = [
  // SECTION I: VEGETABLE PRODUCTS & EXPORTS (Chapters 06-14)
  { prefix: "0709", desc: "Other vegetables, fresh or chilled (Green Chillies, G4 variety, etc.)", cgst: 0, sgst: 0, igst: 0 },
  { prefix: "0803", desc: "Bananas, including plantains, fresh or dried (G9 Bananas)", cgst: 0, sgst: 0, igst: 0 },
  { prefix: "1006", desc: "Rice - Basmati Grade A, Non-Basmati (IR 64), etc.", cgst: 0, sgst: 0, igst: 0 },
  { prefix: "0703", desc: "Onions, shallots, garlic, leeks and other alliaceous vegetables (Nashik Onions)", cgst: 0, sgst: 0, igst: 0 },
  
  // SECTION II: ANIMAL/VEGETABLE FATS
  { prefix: "1516", desc: "Animal or vegetable fats and oils (Filtered Groundnut Oil, Mustard/Sarsav Oil)", cgst: 2.5, sgst: 2.5, igst: 5 },
  { prefix: "0405", desc: "Butter and other fats and oils derived from milk; dairy spreads (Cow Ghee)", cgst: 6, sgst: 6, igst: 12 },

  // SECTION IV: PREPARED FOODSTUFFS; VEGETABLE; MILLETS
  { prefix: "1902", desc: "Pasta, whether or not cooked (Millet-based pasta/noodles from Ragi, Jowar, Bajra)", cgst: 9, sgst: 9, igst: 18 },
  { prefix: "2005", desc: "Other vegetables prepared or preserved (Homemade Sun-dried Potato Chips/Wafers)", cgst: 6, sgst: 6, igst: 12 },

  // SECTION V & VI: MINERAL PRODUCTS & CHEMICAL COMPOSITIONS
  { prefix: "2501", desc: "Salt and pure sodium chloride; sea water", cgst: 0, sgst: 0, igst: 0 },
  { prefix: "3004", desc: "Medicaments consisting of mixed or unmixed products for therapeutic uses", cgst: 6, sgst: 6, igst: 12 },

  // SECTION XI: TEXTILES AND TEXTILE ARTICLES (Surat Hub Core Mappings)
  { prefix: "5208", desc: "Woven fabrics of cotton, containing 85% or more by weight of cotton", cgst: 2.5, sgst: 2.5, igst: 5 },
  { prefix: "5407", desc: "Woven fabrics of synthetic filament yarn (Polyester, Nylon fabrics)", cgst: 2.5, sgst: 2.5, igst: 5 },
  { prefix: "6203", desc: "Men's or boys' suits, ensembles, jackets, trousers (Slim-fit trousers, chinos)", cgst: 6, sgst: 6, igst: 12 },
  { prefix: "6205", desc: "Men's or boys' shirts (Mandarin collar shirts, checked formal/casual shirts)", cgst: 6, sgst: 6, igst: 12 },

  // SECTION XVI: MACHINERY & MECHANICAL APPLIANCES; COMPUTER HARDWARE
  { prefix: "8471", desc: "Automatic data processing machines (Computers, Motherboards like H55, RAM units)", cgst: 9, sgst: 9, igst: 18 },
  { prefix: "8504", desc: "Electrical transformers, static converters (rectifiers) and inductors", cgst: 9, sgst: 9, igst: 18 },
  { prefix: "8517", desc: "Smartphones, telecommunication apparatus and transceivers", cgst: 9, sgst: 9, igst: 18 },

  // SECTION XXI: SERVICES (SAC MAPPINGS - Chapter 99)
  { prefix: "9965", desc: "Goods transport services (Freight Forwarding, SeaRates cargo transport, GTA)", cgst: 2.5, sgst: 2.5, igst: 5 },
  { prefix: "9983", desc: "Other professional, technical and business services (Software engineering, custom development)", cgst: 9, sgst: 9, igst: 18 },
  { prefix: "9987", desc: "Maintenance, repair and installation services (Hardware restoration, computer assembly)", cgst: 9, sgst: 9, igst: 18 },
  { prefix: "9984", desc: "Telecommunications, broadcasting and information supply services (SaaS subscriptions)", cgst: 9, sgst: 9, igst: 18 },
];
