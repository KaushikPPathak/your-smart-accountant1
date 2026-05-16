import { DataGrid, type DGColumn } from "@/components/data-grid/DataGrid";
import type { GroupBucket } from "@/lib/report-grouping";
import { formatINR } from "@/lib/money";

export interface BucketedSide {
  /** Label shown in the "Side" column, e.g. "Liabilities", "Assets", "Dr", "Cr". */
  side: string;
  buckets: GroupBucket[];
  /** Optional extra rows (e.g. Net Profit balancing entry, Opening/Closing Stock). */
  extras?: { group: string; name: string; valuePaise: number }[];
}

interface FlatRow {
  id: string;
  side: string;
  group: string;
  ledger: string;
  amountPaise: number;
}

export function BucketedGrid({
  reportId,
  sides,
  onLedgerClick,
  height = 540,
}: {
  reportId: string;
  sides: BucketedSide[];
  onLedgerClick?: (ledgerId: string) => void;
  height?: number;
}) {
  const rows: FlatRow[] = [];
  for (const s of sides) {
    for (const b of s.buckets) {
      for (const r of b.rows) {
        rows.push({
          id: `${s.side}::${b.group.code}::${r.id}`,
          side: s.side,
          group: b.group.label,
          ledger: r.name,
          amountPaise: r.valuePaise,
        });
      }
    }
    for (const e of s.extras ?? []) {
      rows.push({
        id: `${s.side}::${e.group}::${e.name}`,
        side: s.side,
        group: e.group,
        ledger: e.name,
        amountPaise: e.valuePaise,
      });
    }
  }

  const columns: DGColumn<FlatRow>[] = [
    { id: "side", header: "Side", type: "enum", width: 160, accessor: (r) => r.side, groupable: true },
    { id: "group", header: "Group", type: "enum", width: 220, accessor: (r) => r.group, groupable: true },
    { id: "ledger", header: "Ledger", type: "text", width: 280, accessor: (r) => r.ledger },
    {
      id: "amount",
      header: "Amount (₹)",
      type: "number",
      width: 160,
      align: "right",
      accessor: (r) => r.amountPaise / 100,
      cell: (r) => formatINR(r.amountPaise),
      aggregator: "sum",
      formatAggregate: (v) => formatINR(Math.round(v * 100)),
      formatGroupValue: (v) => formatINR(Math.round(v * 100)),
    },
  ];

  return (
    <DataGrid<FlatRow>
      reportId={reportId}
      rows={rows}
      columns={columns}
      onRowClick={onLedgerClick ? (r) => {
        const ledgerId = r.id.split("::")[2];
        if (ledgerId && !ledgerId.startsWith("__")) onLedgerClick(ledgerId);
      } : undefined}
      globalSearch={(r) => `${r.side} ${r.group} ${r.ledger}`}
      height={height}
    />
  );
}
