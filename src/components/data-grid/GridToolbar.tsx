import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Columns3,
  Group,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Star,
  X,
  Keyboard,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { DGColumn, GridState, SavedView } from "./types";

interface Props<T> {
  columns: DGColumn<T>[];
  state: GridState;
  setState: (s: GridState | ((prev: GridState) => GridState)) => void;
  reset: () => void;
  views: SavedView[];
  saveView: (name: string) => void;
  applyView: (name: string) => void;
  deleteView: (name: string) => void;
  setDefaultView: (name: string | null) => void;
  filteredCount: number;
  totalCount: number;
  searchInputRef?: React.RefObject<HTMLInputElement>;
}

export function GridToolbar<T>({
  columns,
  state,
  setState,
  reset,
  views,
  saveView,
  applyView,
  deleteView,
  setDefaultView,
  filteredCount,
  totalCount,
  searchInputRef,
}: Props<T>) {
  const [savingName, setSavingName] = useState("");
  const colsById = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);
  const groupable = columns.filter((c) => c.groupable !== false);

  const removeFilter = (id: string) =>
    setState((s) => ({ ...s, filters: s.filters.filter((f) => f.id !== id) }));
  const removeSort = (id: string) =>
    setState((s) => ({ ...s, sort: s.sort.filter((r) => r.id !== id) }));
  const removeGroup = (id: string) =>
    setState((s) => ({ ...s, groupBy: s.groupBy.filter((g) => g !== id) }));
  const addGroup = (id: string) =>
    setState((s) => ({ ...s, groupBy: s.groupBy.includes(id) ? s.groupBy : [...s.groupBy, id].slice(0, 3) }));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            value={state.search}
            onChange={(e) => setState((s) => ({ ...s, search: e.target.value }))}
            placeholder="Search…  (press /)"
            className="h-8 w-56 pl-7"
          />
        </div>

        {/* Group by */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8">
              <Group className="mr-1 h-3.5 w-3.5" /> Group
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="text-xs">Group by (max 3)</DropdownMenuLabel>
            {groupable.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.id}
                checked={state.groupBy.includes(c.id)}
                onCheckedChange={(checked) => (checked ? addGroup(c.id) : removeGroup(c.id))}
              >
                {String(c.header)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Columns */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8">
              <Columns3 className="mr-1 h-3.5 w-3.5" /> Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 max-h-80 overflow-auto">
            {columns.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.id}
                checked={!state.hiddenCols.includes(c.id)}
                onCheckedChange={(checked) =>
                  setState((s) => ({
                    ...s,
                    hiddenCols: checked
                      ? s.hiddenCols.filter((x) => x !== c.id)
                      : [...s.hiddenCols, c.id],
                  }))
                }
              >
                {String(c.header)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Density / saved views */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8">
              <SlidersHorizontal className="mr-1 h-3.5 w-3.5" /> Views
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-xs">Density</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={state.density === "comfortable"}
              onCheckedChange={() => setState((s) => ({ ...s, density: "comfortable" }))}
            >Comfortable</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={state.density === "compact"}
              onCheckedChange={() => setState((s) => ({ ...s, density: "compact" }))}
            >Compact</DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs">Saved views</DropdownMenuLabel>
            {views.length === 0 && (
              <div className="px-2 py-1 text-xs text-muted-foreground">None saved</div>
            )}
            {views.map((v) => (
              <div key={v.name} className="flex items-center justify-between gap-1 px-1">
                <DropdownMenuItem className="flex-1" onClick={() => applyView(v.name)}>
                  {v.name}
                  {v.isDefault && <span className="ml-1 text-[10px] text-muted-foreground">(default)</span>}
                </DropdownMenuItem>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDefaultView(v.isDefault ? null : v.name); }}
                  title={v.isDefault ? "Unset default" : "Set as default"}
                >
                  <Star className={`h-3 w-3 ${v.isDefault ? "fill-current text-amber-500" : ""}`} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteView(v.name); }}
                  title="Delete view"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <DropdownMenuSeparator />
            <div className="flex items-center gap-1 px-2 py-1">
              <Input
                value={savingName}
                onChange={(e) => setSavingName(e.target.value)}
                placeholder="View name"
                className="h-7"
              />
              <Button
                size="sm"
                className="h-7"
                onClick={() => {
                  if (savingName.trim()) { saveView(savingName.trim()); setSavingName(""); }
                }}
              ><Save className="h-3.5 w-3.5" /></Button>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="ghost" size="sm" className="h-8" onClick={reset} title="Reset filters/sort/group">
          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset
        </Button>

        <div className="ml-auto text-xs text-muted-foreground">
          {filteredCount.toLocaleString()} of {totalCount.toLocaleString()} rows
        </div>
      </div>

      {/* Active chips */}
      {(state.filters.length > 0 || state.sort.length > 0 || state.groupBy.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {state.groupBy.map((id) => (
            <Badge key={`g-${id}`} variant="secondary" className="gap-1">
              Group: {String(colsById.get(id)?.header ?? id)}
              <X className="h-3 w-3 cursor-pointer" onClick={() => removeGroup(id)} />
            </Badge>
          ))}
          {state.sort.map((s) => (
            <Badge key={`s-${s.id}`} variant="outline" className="gap-1">
              Sort: {String(colsById.get(s.id)?.header ?? s.id)} {s.dir === "asc" ? "↑" : "↓"}
              <X className="h-3 w-3 cursor-pointer" onClick={() => removeSort(s.id)} />
            </Badge>
          ))}
          {state.filters.map((f) => (
            <Badge key={`f-${f.id}`} variant="outline" className="gap-1">
              {String(colsById.get(f.id)?.header ?? f.id)}: {f.op}{" "}
              {Array.isArray(f.value)
                ? (f.value as unknown[]).slice(0, 3).join(", ")
                : f.value != null ? String(f.value) : ""}
              <X className="h-3 w-3 cursor-pointer" onClick={() => removeFilter(f.id)} />
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
