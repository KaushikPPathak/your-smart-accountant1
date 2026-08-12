import * as React from "react";
import { Combo, type ComboOption } from "@/components/vouchers/Combo";
import {
  getAllLedgers, getAllItems, getLedger, getItem,
  searchLedgers, searchItems, useMastersVersion,
  type CachedLedger, type CachedItem,
} from "@/lib/masters-cache";

interface BaseProps {
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
  onCreate?: (typed: string) => void;
  createLabel?: string;
  disabled?: boolean;
}

interface LedgerPickerProps extends BaseProps {
  filter?: (l: CachedLedger) => boolean;
}

/** Synchronous, in-memory ledger picker. Subscribes only to masters version. */
export const LedgerPicker = React.memo(function LedgerPicker({
  value, onChange, filter, placeholder = "Select ledger", className, onCreate, createLabel = "New ledger", disabled,
}: LedgerPickerProps) {
  // Re-render only when masters change (insert/update/delete in this company).
  useMastersVersion();
  const options: ComboOption[] = React.useMemo(() => {
    const list = filter ? getAllLedgers().filter(filter) : getAllLedgers();
    return list.map((l) => ({ value: l.id, label: l.name, hint: l.type }));
  }, [filter]);
  void searchLedgers; // search is handled inside cmdk via shouldFilter; cache supplies list
  void getLedger;
  return (
    <Combo
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      emptyText="No ledgers — Alt+C to create"
      className={className}
      onCreate={onCreate}
      createLabel={createLabel}
      disabled={disabled}
    />
  );
});

interface ItemPickerProps extends BaseProps {
  filter?: (i: CachedItem) => boolean;
}

export const ItemPicker = React.memo(function ItemPicker({
  value, onChange, filter, placeholder = "Select item", className, onCreate, createLabel = "New item", disabled,
}: ItemPickerProps) {
  useMastersVersion();
  const options: ComboOption[] = React.useMemo(() => {
    const list = filter ? getAllItems().filter(filter) : getAllItems();
    return list.map((i) => ({ value: i.id, label: i.name, hint: i.unit }));
  }, [filter]);
  void searchItems;
  void getItem;
  return (
    <Combo
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      emptyText="No items — Alt+C to create"
      className={className}
      onCreate={onCreate}
      createLabel={createLabel}
      disabled={disabled}
    />
  );
});
