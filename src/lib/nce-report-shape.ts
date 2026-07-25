// Shared helper used by BS / P&L / Trading / R&P reports to know which
// disclosure sections to render, based on the active company's NCE level.

import { classifyNceLevel, getNceDisclosureFlags, type NceLevel } from "./nce-classification";
import type { EntityStatus } from "./entity-status";

export interface NceReportShape {
  level: NceLevel;
  isCorporate: boolean;
  reason: string;
  flags: ReturnType<typeof getNceDisclosureFlags>;
  showReceiptsPayments: boolean;   // Trust / Individual / HUF / RF benefit from R&P
}

export function computeNceReportShape(input: {
  entity: EntityStatus;
  turnoverPaise: number;
  borrowingsPaise: number;
  levelOverride?: NceLevel | null;
}): NceReportShape {
  const c = classifyNceLevel({
    entity: input.entity,
    turnoverPaise: input.turnoverPaise,
    borrowingsPaise: input.borrowingsPaise,
  });
  const level = (input.levelOverride ?? c.level) as NceLevel;
  const flags = getNceDisclosureFlags(level, c.isCorporate);
  const showReceiptsPayments =
    input.entity === "trust" ||
    input.entity === "individual" ||
    input.entity === "huf" ||
    input.entity === "registered_firm" ||
    input.entity === "aop";
  return {
    level,
    isCorporate: c.isCorporate,
    reason: c.reason,
    flags,
    showReceiptsPayments,
  };
}
