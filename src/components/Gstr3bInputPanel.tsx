function Gstr3bInputPanel({
  financialYear,
  companyId,
  existing,
  onClose,
  onSaved,
}: {
  financialYear: string;
  companyId: string;
  existing: Gstr9InputRecord | undefined;
  onClose: () => void;
  onSaved: (record: Gstr9InputRecord) => void;
}) {
  const existingGstr3b = existing?.gstr3b;
  const [tab, setTab] = useState<"MANUAL" | "IMPORT">("MANUAL");
  const [periods, setPeriods] = useState<Gstr9Gstr3bPeriod[]>(() => {
    const defaults = gstr3bPeriodsForFinancialYear(financialYear);
    if (existingGstr3b?.periods?.length) {
      return defaults.map((period, index) =>
        existingGstr3b.periods[index]
          ? cloneGstr3bPeriod(existingGstr3b.periods[index])
          : emptyGstr3bPeriod(period),
      );
    }
    return defaults.map(emptyGstr3bPeriod);
  });
  const [sourceName, setSourceName] = useState(existingGstr3b?.metadata.sourceName ?? "Filed GSTR-3B");
  const [sourceReference, setSourceReference] = useState(existingGstr3b?.metadata.sourceReference ?? "");
  const [notes, setNotes] = useState(existingGstr3b?.metadata.notes ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [excelWarnings, setExcelWarnings] = useState<string[]>([]);
  const [excelSummary, setExcelSummary] = useState<string | null>(null);

  const updatePeriod = (index: number, updater: (current: Gstr9Gstr3bPeriod) => Gstr9Gstr3bPeriod) => {
    setPeriods((current) => current.map((period, periodIndex) =>
      periodIndex === index ? updater(period) : period,
    ));
  };

  const save = async (source: Gstr9InputSource) => {
    setSaving(true);
    setMessage(null);
    try {
      const now = new Date().toISOString();
      const metadata: Gstr9InputMetadata = {
        source,
        enteredAt: existingGstr3b?.metadata.enteredAt ?? now,
        updatedAt: now,
        sourceName: sourceName.trim() || undefined,
        sourceReference: sourceReference.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      const record: Gstr9InputRecord = {
        ...(existing ?? {
          id: `${companyId}:${financialYear}`,
          companyId,
          financialYear,
        }),
        gstr3b: { periods, metadata },
      };
      await saveGstr9InputRecord(record);
      onSaved(record);
      setMessage(`${source === "IMPORT" ? "Imported" : "Manual entry"} saved successfully.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save GSTR-3B input.");
    } finally {
      setSaving(false);
    }
  };

  const importJson = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const imported = normaliseGstr3bImport(parsed, financialYear);
      setPeriods(imported.periods);
      if (imported.sourceName) setSourceName(imported.sourceName);
      if (imported.sourceReference) setSourceReference(imported.sourceReference);
      if (imported.notes) setNotes(imported.notes);
      setTab("IMPORT");
      setMessage("JSON loaded. Review the values, then click Save imported GSTR-3B.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to read the JSON file.");
    }
  };

  const importExcel = async (files: FileList) => {
    setMessage(null);
    setExcelWarnings([]);
    setExcelSummary(null);

    const selectedFiles = Array.from(files);
    if (selectedFiles.length === 0) return;

    const nextPeriods = periods.map(cloneGstr3bPeriod);
    const warnings: string[] = [];
    const importedMonths: string[] = [];
    const importedFileNames: string[] = [];
    const seenPeriods = new Set<string>();

    for (const file of selectedFiles) {
      try {
        const analysis = analyseGstr3bExcelBuffer(await file.arrayBuffer(), {
          fileName: file.name,
          expectedFinancialYear: financialYear,
        });

        const fyMismatch = analysis.warnings.find((warning) =>
          warning.includes("does not match selected FY") &&
          warning.includes("Nothing should be saved"),
        );

        if (fyMismatch) {
          warnings.push(`${file.name}: ${fyMismatch}`);
          continue;
        }

        const periodIndex = nextPeriods.findIndex(
          (period) => period.period === analysis.period.period,
        );

        if (periodIndex < 0) {
          warnings.push(
            `${file.name}: ${analysis.period.period} is outside the selected FY ${financialYear}. Nothing was imported from this file.`,
          );
          continue;
        }

        if (seenPeriods.has(analysis.period.period)) {
          warnings.push(
            `${file.name}: duplicate ${analysis.period.period} workbook selected. The later file replaces the earlier file for that month.`,
          );
        }
        seenPeriods.add(analysis.period.period);

        nextPeriods[periodIndex] = cloneGstr3bPeriod(analysis.period);
        importedMonths.push(analysis.period.period);
        importedFileNames.push(file.name);

        for (const warning of analysis.warnings) {
          warnings.push(`${file.name}: ${warning}`);
        }
      } catch (error) {
        warnings.push(
          `${file.name}: ${error instanceof Error ? error.message : "Unable to read the GSTR-3B Excel file."}`,
        );
      }
    }

    if (importedMonths.length === 0) {
      setExcelWarnings(warnings);
      setExcelSummary("No GSTR-3B workbook was imported.");
      setTab("EXCEL");
      setMessage("No valid GSTR-3B Excel file was imported. Review the warnings below.");
      return;
    }

    setPeriods(nextPeriods);
    setSourceName("Filed GSTR-3B Excel");
    setSourceReference(importedFileNames.join(", "));
    setNotes(
      warnings.length > 0
        ? `Imported from GSTN GSTR-3B Excel. Warnings: ${warnings.join(" | ")}`
        : "Imported from GSTN GSTR-3B Excel.",
    );
    setExcelWarnings(warnings);
    setExcelSummary(
      `Imported ${importedMonths.length} month${importedMonths.length === 1 ? "" : "s"}: ${importedMonths.join(", ")}. Review the values before saving.`,
    );
    setTab("EXCEL");
    setMessage(
      `GSTR-3B Excel loaded for ${importedMonths.length} month${importedMonths.length === 1 ? "" : "s"}. Review the values, then click Save imported GSTR-3B.`,
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-3 pt-3 pb-20">
      <Card className="flex h-[calc(100vh-92px)] max-h-[calc(100vh-92px)] w-full max-w-7xl flex-col overflow-hidden shadow-xl">
        <CardHeader className="flex flex-none flex-row items-center justify-between border-b pb-3">
          <div>
            <CardTitle className="text-base">Filed GSTR-3B Input — FY {financialYear}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Enter or import monthly GSTR-3B figures. Manual entry and import use the same local GSTR-9 input store.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-4 flex flex-wrap gap-2 border-b pb-3">
            <Button size="sm" variant={tab === "MANUAL" ? "default" : "outline"} onClick={() => setTab("MANUAL")}>
              Manual Entry
            </Button>
            <Button size="sm" variant={tab === "EXCEL" ? "default" : "outline"} onClick={() => setTab("EXCEL")}>
              <Upload className="mr-1 h-4 w-4" /> Import Excel
            </Button>
            <Button size="sm" variant={tab === "IMPORT" ? "default" : "outline"} onClick={() => setTab("IMPORT")}>
              <Upload className="mr-1 h-4 w-4" /> Import JSON
            </Button>
          </div>

          {tab === "EXCEL" && (
            <div className="mb-4 rounded-md border border-dashed p-4">
              <div className="text-sm font-medium">Import GSTN GSTR-3B Excel</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Select one or more monthly GSTN GSTR-3B Offline Utility workbooks (.xls, .xlsx or .xlsm). Each workbook is matched to its Year and Month and placed into the corresponding April-to-March period. Nothing is saved until you click Save imported GSTR-3B.
              </p>
              <input
                type="file"
                multiple
                accept=".xls,.xlsx,.xlsm,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="mt-3 block text-sm"
                onChange={(event) => {
                  const files = event.target.files;
                  if (files?.length) void importExcel(files);
                  event.currentTarget.value = "";
                }}
              />
              {excelSummary && (
                <div className="mt-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                  {excelSummary}
                </div>
              )}
              {excelWarnings.length > 0 && (
                <div className="mt-3 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  <div className="font-semibold">Excel import warnings</div>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    {excelWarnings.map((warning, index) => (
                      <li key={`${warning}-${index}`}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {tab === "IMPORT" && (
            <div className="mb-4 rounded-md border border-dashed p-4">
              <div className="text-sm font-medium">Import GSTR-3B structured JSON</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Import a JSON containing a <code>periods</code> array, or a wrapper containing <code>gstr3b.periods</code>. Periods are matched April-to-March.
              </p>
              <input
                type="file"
                accept=".json,application/json"
                className="mt-3 block text-sm"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importJson(file);
                  event.currentTarget.value = "";
                }}
              />
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1">
              <span className="text-xs font-medium">Source name</span>
              <input value={sourceName} onChange={(event) => setSourceName(event.target.value)} className="h-9 w-full rounded-md border bg-background px-3 text-sm" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium">Source reference</span>
              <input value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} placeholder="e.g. ARN / file name" className="h-9 w-full rounded-md border bg-background px-3 text-sm" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium">Notes</span>
              <input value={notes} onChange={(event) => setNotes(event.target.value)} className="h-9 w-full rounded-md border bg-background px-3 text-sm" />
            </label>
          </div>

          <div className="mt-4 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <strong>Tax payment:</strong> IGST, CGST, SGST and Cess are stored as GST tax paid. Interest, late fee, penalty and other payments are captured separately and are not included in GST tax-paid totals.
          </div>

          <div className="mt-5 space-y-3">
            {periods.map((period, index) => (
              <details key={`${period.period}-${index}`} open={index === 0} className="rounded-md border">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">{period.period}</summary>
                <div className="space-y-5 border-t p-4">
                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Outward supplies / tax liability</h3>
                    <TaxAmountFields
                      value={period.outwardTax}
                      onChange={(value) => updatePeriod(index, (current) => ({ ...current, outwardTax: value }))}
                    />
                  </section>

                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">ITC availed — Table 4(A)</h3>
                    <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-5">
                      {GSTR3B_ITC_FIELDS.map(([field, label]) => (
                        <label key={field} className="space-y-1">
                          <span className="text-[11px] text-muted-foreground">{label}</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={period.itc[field]}
                            onChange={(event) => updatePeriod(index, (current) => {
                              const itc = { ...current.itc, [field]: numberValue(event.target.value) };
                              itc.totalItcAvailed =
                                itc.table4A1ImportOfGoods + itc.table4A2ImportOfServices + itc.table4A3Rcm + itc.table4A4Isd + itc.table4A5Other;
                              return { ...current, itc };
                            })}
                            className="h-8 w-full rounded-md border bg-background px-2 text-right text-xs"
                          />
                        </label>
                      ))}
                    </div>
                    <div className="mt-2 text-right text-xs font-semibold">Total ITC availed: {money(period.itc.totalItcAvailed)}</div>
                  </section>

                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">ITC reversals</h3>
                    <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-5">
                      {GSTR3B_REVERSAL_FIELDS.map(([field, label]) => (
                        <label key={field} className="space-y-1">
                          <span className="text-[11px] text-muted-foreground">{label}</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={period.itcReversal[field]}
                            onChange={(event) => updatePeriod(index, (current) => {
                              const itcReversal = { ...current.itcReversal, [field]: numberValue(event.target.value) };
                              itcReversal.total = itcReversal.rule38 + itcReversal.rule42 + itcReversal.rule43 + itcReversal.section17_5 + itcReversal.other;
                              return { ...current, itcReversal };
                            })}
                            className="h-8 w-full rounded-md border bg-background px-2 text-right text-xs"
                          />
                        </label>
                      ))}
                    </div>
                    <div className="mt-2 text-right text-xs font-semibold">Total ITC reversal: {money(period.itcReversal.total)}</div>
                  </section>

                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tax paid</h3>

                    <div className="space-y-3">
                      {GSTR3B_TAX_PAID_TAX_FIELDS.map(([field, label]) => (
                        <div key={field} className="rounded-md border p-3">
                          <div className="mb-2 text-xs font-semibold">{label}</div>
                          <div className="grid gap-2 md:grid-cols-3">
                            {([
                              ["taxPayable", "Tax payable"],
                              ["paidThroughCash", "Paid through cash"],
                              ["paidThroughItc", "Paid through ITC"],
                            ] as Array<[Gstr9TaxPaidRowField, string]>).map(([rowField, rowLabel]) => (
                              <label key={rowField} className="space-y-1">
                                <span className="text-[11px] text-muted-foreground">{rowLabel}</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={period.taxPaid[field][rowField]}
                                  onChange={(event) => updatePeriod(index, (current) => ({
                                    ...current,
                                    taxPaid: {
                                      ...current.taxPaid,
                                      [field]: {
                                        ...current.taxPaid[field],
                                        [rowField]: numberValue(event.target.value),
                                      },
                                    },
                                  }))}
                                  className="h-8 w-full rounded-md border bg-background px-2 text-right text-xs"
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}

                      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
                        {GSTR3B_TAX_PAID_OTHER_FIELDS.map(([field, label]) => (
                          <label key={field} className="space-y-1">
                            <span className="text-[11px] text-muted-foreground">{label}</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={period.taxPaid[field]}
                              onChange={(event) => updatePeriod(index, (current) => ({
                                ...current,
                                taxPaid: { ...current.taxPaid, [field]: numberValue(event.target.value) },
                              }))}
                              className="h-8 w-full rounded-md border bg-background px-2 text-right text-xs"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  </section>
                </div>
              </details>
            ))}
          </div>

          <Gstr3bReviewSummary periods={periods} />
        </CardContent>

        <div className="flex-none border-t bg-background px-4 py-3">
          {message && <div className="mb-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">{message}</div>}
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              Review the totals above, then save. The saved record can be reopened from the GSTR-3B card.
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={() => void save(tab === "IMPORT" ? "IMPORT" : "MANUAL")} disabled={saving}>
                <Save className="mr-1 h-4 w-4" />
                {saving ? "Saving…" : tab === "IMPORT" ? "Save imported GSTR-3B" : "Save manual GSTR-3B"}
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

