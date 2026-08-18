
type CachedLedger = {
  id: string;
  name: string;
  _folded_name?: string;
  type: string;
  is_active: boolean;
  [key: string]: any;
};

type CachedItem = {
  id: string;
  name: string;
  _folded_name?: string;
  is_active: boolean;
  [key: string]: any;
};

let ledgersSorted: CachedLedger[] = [];
let itemsSorted: CachedItem[] = [];

function fold(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^\w\s]/g, "");
}

function search<T extends { name: string; _folded_name?: string }>(
  src: T[],
  query: string,
  limit: number
): T[] {
  const q = fold(query.trim());
  if (!q) return src.slice(0, limit);

  const prefix: T[] = [];
  const contains: T[] = [];

  for (const item of src) {
    if (!item._folded_name) item._folded_name = fold(item.name);
    const n = item._folded_name;
    if (n.startsWith(q)) {
      prefix.push(item);
    } else if (n.includes(q)) {
      contains.push(item);
    }
    if (prefix.length >= limit) break;
  }

  return [...prefix, ...contains].slice(0, limit);
}

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  switch (type) {
    case "SET_DATA":
      ledgersSorted = payload.ledgers;
      itemsSorted = payload.items;
      break;

    case "SEARCH_LEDGERS": {
      const { query, limit, requestId } = payload;
      const results = search(ledgersSorted, query, limit);
      self.postMessage({ type: "SEARCH_RESULTS", payload: { results, requestId, masterType: "ledgers" } });
      break;
    }

    case "SEARCH_ITEMS": {
      const { query, limit, requestId } = payload;
      const results = search(itemsSorted, query, limit);
      self.postMessage({ type: "SEARCH_RESULTS", payload: { results, requestId, masterType: "items" } });
      break;
    }
  }
};
