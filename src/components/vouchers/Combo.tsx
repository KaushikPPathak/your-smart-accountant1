import * as React from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export interface ComboOption {
  value: string;
  label: string;
  hint?: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  emptyText?: string;
  className?: string;
  /** Called when user presses Alt+C or clicks "Create new" */
  onCreate?: (typed: string) => void;
  createLabel?: string;
  disabled?: boolean;
}

/**
 * Tally/Busy-style typeahead picker.
 *  - Opens on focus / typing.
 *  - Arrow keys to navigate, Enter to select.
 *  - Alt+C to create new inline.
 *  - Once selected, Enter on the trigger advances to next field (handled by useEnterAsTab).
 */
export function Combo({
  value,
  onChange,
  options,
  placeholder = "Select…",
  emptyText = "No matches.",
  className,
  onCreate,
  createLabel = "Create new",
  disabled,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  const selected = React.useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  );

  const handleSelect = (val: string) => {
    onChange(val);
    setOpen(false);
    setQuery("");
    // Return focus to trigger so Enter-as-Tab can advance
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          onKeyDown={(e) => {
            // Alt+C creates new from anywhere on the trigger
            if (e.altKey && e.key.toLowerCase() === "c" && onCreate) {
              e.preventDefault();
              e.stopPropagation();
              onCreate(query);
              return;
            }
            // Letter / digit opens & seeds search
            if (!open && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
              setQuery(e.key);
              setOpen(true);
              e.preventDefault();
            }
          }}
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className={cn("truncate text-left", !selected && "text-muted-foreground")}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) min-w-[260px] p-0"
        align="start"
        onOpenAutoFocus={(e) => {
          // Let CommandInput inside auto-focus naturally
          void e;
        }}
      >
        <Command
          shouldFilter={true}
          onKeyDown={(e) => {
            if (e.altKey && e.key.toLowerCase() === "c" && onCreate) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              onCreate(query);
            }
          }}
        >
          <CommandInput
            placeholder="Type to search…"
            value={query}
            onValueChange={setQuery}
            autoFocus
          />
          <CommandList>
            <CommandEmpty>
              <div className="space-y-2 py-2 text-center text-sm">
                <div className="text-muted-foreground">{emptyText}</div>
                {onCreate && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent"
                    onClick={() => {
                      setOpen(false);
                      onCreate(query);
                    }}
                  >
                    <Plus className="h-3 w-3" /> {createLabel} <kbd className="ml-1 rounded border px-1 text-[10px]">Alt+C</kbd>
                  </button>
                )}
              </div>
            </CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.hint ?? ""}`}
                  onSelect={() => handleSelect(o.value)}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === o.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.hint && (
                    <span className="ml-2 text-[10px] text-muted-foreground">{o.hint}</span>
                  )}
                </CommandItem>
              ))}
              {onCreate && options.length > 0 && (
                <CommandItem
                  value="__create__"
                  onSelect={() => {
                    setOpen(false);
                    onCreate(query);
                  }}
                  className="text-primary"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  <span className="flex-1">{createLabel}{query ? `: "${query}"` : ""}</span>
                  <kbd className="rounded border px-1 text-[10px]">Alt+C</kbd>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}