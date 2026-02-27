import { useEffect, useMemo, useRef, useState } from "react";
import { CircleMinus, GripVertical, Plus, Save, Trash2, Undo2 } from "lucide-react";
import { buildTypeFromSpec, defaultTypeSpec, GENERIC_TYPE_OPTIONS, parseTypeToSpec } from "../../lib/type-spec";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Separator } from "../ui/separator";

export function StructureEditorPanel({
  schemaDraft,
  columns,
  schemaMap,
  selectedTable,
  onUpdateSchemaDraft,
  pkOrderOf,
  onSetPkOrderForColumn,
  onMoveColumnTo,
  onRemoveColumn,
  onOpenColumnModal,
  onAddIndex,
  onUpdateIndex,
  onRemoveIndex,
  indexColumnOrderOf,
  onSetIndexColumnOrder,
  onAddForeignKey,
  onUpdateForeignKey,
  buildFkPairs,
  onUpdateFkPair,
  onRemoveFkPair,
  onAddFkPair,
  onRemoveForeignKey,
  onSaveSchema,
  hasSchemaUnsavedChanges,
  onRevertSchema
}) {
  const [dragFromIdx, setDragFromIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [colWidths, setColWidths] = useState({
    name: 180,
    type: 220,
    default: 132,
    pk: 72,
    nullable: 64
  });
  const resizingRef = useRef(null);

  useEffect(() => {
    const onMove = (e) => {
      const s = resizingRef.current;
      if (!s) return;
      const minMap = { name: 120, type: 160, default: 90, pk: 56, nullable: 64 };
      const next = Math.max(minMap[s.key] || 80, s.startWidth + (e.clientX - s.startX));
      setColWidths((prev) => ({ ...prev, [s.key]: next }));
    };
    const onUp = () => {
      resizingRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);
  const columnsMinWidth = useMemo(() => 34 + colWidths.name + colWidths.type + colWidths.default + colWidths.pk + colWidths.nullable + 46, [colWidths]);

  const startResize = (key, e) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { key, startX: e.clientX, startWidth: colWidths[key] };
  };

  const composeTypeLiteral = (baseType, spec) => {
    if (baseType === "STRING" || baseType === "BINARY") return `${baseType}(${spec.length ?? ""})`;
    if (baseType === "DECIMAL") return `DECIMAL(${spec.precision ?? ""},${spec.scale ?? ""})`;
    return baseType;
  };

  return (
    <Card className="m-2 ml-1 h-full min-h-0 min-w-0 overflow-hidden flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle>Info</CardTitle>
      </CardHeader>
      <CardContent className="min-h-0 min-w-0 flex-1 overflow-hidden flex flex-col p-0">
        <div className="min-h-0 flex-1 w-full overflow-y-auto overflow-x-hidden p-4 pr-2 pb-3">
          {schemaDraft ? (
            <div className="space-y-4 w-full min-w-0">
              <Card className="bg-muted/20 w-full min-w-0 overflow-hidden">
                <CardHeader className="pb-2">
                  <CardTitle>Columns</CardTitle>
                </CardHeader>
                <CardContent className="w-full min-w-0 min-h-0 overflow-hidden flex flex-col">
                  <div className="max-h-[290px] w-full max-w-full overflow-x-auto overflow-y-auto rounded border bg-background [scrollbar-gutter:stable]">
                    <table className="table-fixed text-sm" style={{ width: "100%", minWidth: columnsMinWidth }}>
                      <colgroup>
                        <col style={{ width: 34, minWidth: 34 }} />
                        <col style={{ width: colWidths.name, minWidth: colWidths.name }} />
                        <col style={{ width: colWidths.type, minWidth: colWidths.type }} />
                        <col style={{ width: colWidths.default, minWidth: colWidths.default }} />
                        <col style={{ width: colWidths.pk, minWidth: colWidths.pk }} />
                        <col style={{ width: colWidths.nullable, minWidth: colWidths.nullable }} />
                        <col />
                        <col style={{ width: 46, minWidth: 46 }} />
                      </colgroup>
                      <thead className="sticky top-0 z-10 bg-muted">
                        <tr className="border-b text-xs font-semibold">
                          <th className="px-2 py-2"></th>
                          <th className="relative px-2 py-2 text-left">
                            Name
                            <span className="absolute right-0 top-0 h-full w-1 cursor-col-resize" onMouseDown={(e) => startResize("name", e)} />
                          </th>
                          <th className="relative px-2 py-2 text-left">
                            Type
                            <span className="absolute right-0 top-0 h-full w-1 cursor-col-resize" onMouseDown={(e) => startResize("type", e)} />
                          </th>
                          <th className="relative px-2 py-2 text-left">
                            Default
                            <span className="absolute right-0 top-0 h-full w-1 cursor-col-resize" onMouseDown={(e) => startResize("default", e)} />
                          </th>
                          <th className="relative px-2 py-2 text-left">
                            PK
                            <span className="absolute right-0 top-0 h-full w-1 cursor-col-resize" onMouseDown={(e) => startResize("pk", e)} />
                          </th>
                          <th className="relative px-2 py-2 text-center">
                            Nullable
                            <span className="absolute right-0 top-0 h-full w-1 cursor-col-resize" onMouseDown={(e) => startResize("nullable", e)} />
                          </th>
                          <th className="px-0 py-0"></th>
                          <th className="sticky right-0 z-20 bg-muted px-2 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {schemaDraft.columns.map((col, idx) => (
                          <tr
                            key={`col-row-${idx}`}
                            className={`border-b ${dragOverIdx === idx ? "bg-muted/40" : ""}`}
                            onDragOver={(e) => {
                              e.preventDefault();
                              if (dragOverIdx !== idx) setDragOverIdx(idx);
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (dragFromIdx === null || dragFromIdx === idx) return;
                              onMoveColumnTo(dragFromIdx, idx);
                              setDragFromIdx(null);
                              setDragOverIdx(null);
                            }}
                            onDragEnd={() => {
                              setDragFromIdx(null);
                              setDragOverIdx(null);
                            }}
                          >
                            <td className="px-2 py-2 align-middle">
                              <div
                                className="flex cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing"
                                draggable
                                onDragStart={() => {
                                  setDragFromIdx(idx);
                                  setDragOverIdx(idx);
                                }}
                                onDragEnd={() => {
                                  setDragFromIdx(null);
                                  setDragOverIdx(null);
                                }}
                              >
                                <GripVertical className="h-4 w-4" />
                              </div>
                            </td>
                            <td className="px-2 py-2 align-middle">
                              <Input
                                value={col.name}
                                onChange={(e) =>
                                  onUpdateSchemaDraft((s) => {
                                    s.columns[idx].name = e.target.value;
                                    return s;
                                  })
                                }
                              />
                            </td>
                            <td className="px-2 py-2 align-middle">
                              <div className="grid min-w-0 grid-cols-[100px_minmax(0,1fr)] gap-2">
                                {(() => {
                                  const spec = parseTypeToSpec(col.type || "");
                                  const baseType = spec.baseType || "STRING";
                                  return (
                                    <>
                                      <select
                                        className="h-9 rounded-md border bg-background px-2 text-sm"
                                        value={baseType}
                                        draggable={false}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onDragStart={(e) => e.stopPropagation()}
                                        onChange={(e) =>
                                          onUpdateSchemaDraft((s) => {
                                            const nextSpec = { ...defaultTypeSpec(e.target.value) };
                                            s.columns[idx].type = buildTypeFromSpec(nextSpec);
                                            return s;
                                          })
                                        }
                                      >
                                        {GENERIC_TYPE_OPTIONS.map((opt) => (
                                          <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                          </option>
                                        ))}
                                      </select>
                                      <div className="min-w-0">
                                        {baseType === "STRING" || baseType === "BINARY" ? (
                                          <Input
                                            className="w-full min-w-0"
                                            value={spec.length || ""}
                                            placeholder="length"
                                            draggable={false}
                                            onMouseDown={(e) => e.stopPropagation()}
                                            onDragStart={(e) => e.stopPropagation()}
                                            onChange={(e) =>
                                              onUpdateSchemaDraft((s) => {
                                                const current = parseTypeToSpec(s.columns[idx].type || "");
                                                s.columns[idx].type = composeTypeLiteral(baseType, { ...current, length: e.target.value });
                                                return s;
                                              })
                                            }
                                          />
                                        ) : null}
                                        {baseType === "DECIMAL" ? (
                                          <div className="grid min-w-0 grid-cols-2 gap-2">
                                            <Input
                                              className="w-full min-w-0"
                                              value={spec.precision || ""}
                                              placeholder="precision"
                                              draggable={false}
                                              onMouseDown={(e) => e.stopPropagation()}
                                              onDragStart={(e) => e.stopPropagation()}
                                              onChange={(e) =>
                                                onUpdateSchemaDraft((s) => {
                                                  const current = parseTypeToSpec(s.columns[idx].type || "");
                                                  s.columns[idx].type = composeTypeLiteral(baseType, { ...current, precision: e.target.value });
                                                  return s;
                                                })
                                              }
                                            />
                                            <Input
                                              className="w-full min-w-0"
                                              value={spec.scale || ""}
                                              placeholder="scale"
                                              draggable={false}
                                              onMouseDown={(e) => e.stopPropagation()}
                                              onDragStart={(e) => e.stopPropagation()}
                                              onChange={(e) =>
                                                onUpdateSchemaDraft((s) => {
                                                  const current = parseTypeToSpec(s.columns[idx].type || "");
                                                  s.columns[idx].type = composeTypeLiteral(baseType, { ...current, scale: e.target.value });
                                                  return s;
                                                })
                                              }
                                            />
                                          </div>
                                        ) : null}
                                      </div>
                                    </>
                                  );
                                })()}
                              </div>
                            </td>
                            <td className="px-2 py-2 align-middle">
                              <Input
                                value={col.defaultValue || ""}
                                onChange={(e) =>
                                  onUpdateSchemaDraft((s) => {
                                    s.columns[idx].defaultValue = e.target.value;
                                    return s;
                                  })
                                }
                              />
                            </td>
                            <td className="px-2 py-2 align-middle">
                              <Input
                                value={pkOrderOf(col.name)}
                                onChange={(e) => {
                                  const nextOrder = e.target.value;
                                  onSetPkOrderForColumn(col.name, nextOrder);
                                  if (String(nextOrder || "").trim() !== "") {
                                    onUpdateSchemaDraft((s) => {
                                      if (s.columns[idx]) s.columns[idx].nullable = false;
                                      return s;
                                    });
                                  }
                                }}
                                placeholder="#"
                              />
                            </td>
                            <td className="px-2 py-2 align-middle text-center">
                              <div className="flex items-center justify-center">
                                {(() => {
                                  const isPkColumn = String(pkOrderOf(col.name) || "").trim() !== "";
                                  return (
                                <Checkbox
                                  checked={isPkColumn ? false : !!col.nullable}
                                  disabled={isPkColumn}
                                  onCheckedChange={(v) =>
                                    onUpdateSchemaDraft((s) => {
                                      s.columns[idx].nullable = !!v;
                                      return s;
                                    })
                                  }
                                />
                                  );
                                })()}
                              </div>
                            </td>
                            <td className="px-0 py-0"></td>
                            <td className="sticky right-0 bg-background px-2 py-2 align-middle">
                              <div className="flex justify-center">
                                <Button size="icon" variant="ghost" onClick={() => onRemoveColumn(idx)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-2 shrink-0">
                    <Button onClick={onOpenColumnModal}>
                      <Plus className="mr-1 h-4 w-4" />
                      Add Column
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Separator />

              <Card className="bg-muted/10 w-full min-w-0">
                <CardHeader className="pb-2">
                  <CardTitle>Primary Key</CardTitle>
                </CardHeader>
                <CardContent>
                  <Input
                    value={schemaDraft.primaryKeyName || ""}
                    onChange={(e) =>
                      onUpdateSchemaDraft((s) => {
                        s.primaryKeyName = e.target.value;
                        return s;
                      })
                    }
                    placeholder="PK constraint name"
                  />
                </CardContent>
              </Card>

              <Separator />

              <Card className="bg-muted/10 w-full min-w-0">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle>Indexes</CardTitle>
                    <Button variant="secondary" size="sm" onClick={onAddIndex}>
                      <Plus className="mr-1 h-4 w-4" />
                      Add Index
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(schemaDraft.indexes || []).map((idx, i) => (
                    <div key={`idx-${i}`} className="rounded border bg-background p-3">
                      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                        <Input value={idx.name || ""} onChange={(e) => onUpdateIndex(i, { name: e.target.value })} placeholder="index name" />
                        <Label className="flex items-center gap-2">
                          <Checkbox checked={!!idx.unique} onCheckedChange={(v) => onUpdateIndex(i, { unique: !!v })} />
                          Unique
                        </Label>
                        <Button size="icon" variant="ghost" onClick={() => onRemoveIndex(i)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="mt-2 rounded border">
                        <div className="grid grid-cols-[1fr_88px] border-b bg-muted/50 px-2 py-1 text-xs font-semibold">
                          <span>Column</span>
                          <span>Order</span>
                        </div>
                        <div className="max-h-36 overflow-auto">
                          {columns.map((colName) => (
                            <div key={`${idx.name || i}-${colName}`} className="grid grid-cols-[1fr_88px] items-center gap-2 border-b px-2 py-1 last:border-b-0">
                              <span className="truncate text-sm">{colName}</span>
                              <Input value={indexColumnOrderOf(idx, colName)} onChange={(e) => onSetIndexColumnOrder(i, colName, e.target.value)} placeholder="#" />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Separator />

              <Card className="bg-muted/10 w-full min-w-0">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle>Foreign Keys</CardTitle>
                    <Button variant="secondary" size="sm" onClick={onAddForeignKey}>
                      <Plus className="mr-1 h-4 w-4" />
                      Add FK
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(schemaDraft.foreignKeys || []).map((fk, fkIdx) => {
                    const parentColumns = (schemaMap[fk.parentTable]?.columns || []).map((c) => c.name);
                    const pairs = buildFkPairs(fk);
                    return (
                      <div key={`fk-${fkIdx}`} className="rounded border bg-background p-3">
                        <div className="grid grid-cols-[minmax(0,1fr)_170px_40px] items-center gap-2">
                          <Input value={fk.name || ""} onChange={(e) => onUpdateForeignKey(fkIdx, { name: e.target.value })} placeholder="fk name" />
                          <select
                            className="h-9 rounded-md border bg-background px-2 text-sm"
                            value={fk.parentTable || ""}
                            onChange={(e) =>
                              onUpdateForeignKey(fkIdx, { parentTable: e.target.value, childTable: selectedTable, childColumns: [""], parentColumns: [""] })
                            }
                          >
                            {Object.keys(schemaMap)
                              .filter((t) => t !== selectedTable)
                              .map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                          </select>
                          <Button size="icon" variant="ghost" onClick={() => onRemoveForeignKey(fkIdx)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">child table: {selectedTable}</p>
                        <div className="mt-2 space-y-2">
                          {pairs.map((pair, pairIdx) => (
                            <div key={`pair-${pairIdx}`} className="grid grid-cols-[1fr_30px_1fr_40px] items-center gap-2">
                              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={pair.child} onChange={(e) => onUpdateFkPair(fkIdx, pairIdx, "child", e.target.value)}>
                                <option value="">child column</option>
                                {columns.map((c) => (
                                  <option key={`${fkIdx}-c-${c}`} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                              <span className="text-center">=</span>
                              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={pair.parent} onChange={(e) => onUpdateFkPair(fkIdx, pairIdx, "parent", e.target.value)}>
                                <option value="">parent column</option>
                                {parentColumns.map((c) => (
                                  <option key={`${fkIdx}-p-${c}`} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                              <Button size="icon" variant="ghost" onClick={() => onRemoveFkPair(fkIdx, pairIdx)}>
                                <CircleMinus className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                        <div className="mt-2">
                          <Button variant="outline" size="sm" onClick={() => onAddFkPair(fkIdx)}>
                            <Plus className="mr-1 h-4 w-4" />
                            Add Mapping
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          ) : (
            <></>
            // <p className="text-sm text-muted-foreground">테이블을 선택하세요.</p>
          )}
        </div>
        <div className="sticky bottom-0 z-20 shrink-0 border-t bg-background p-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onRevertSchema} disabled={!hasSchemaUnsavedChanges}>
              <Undo2 className="mr-1 h-4 w-4" />
              Revert
            </Button>
            <Button onClick={onSaveSchema} disabled={!hasSchemaUnsavedChanges}>
              <Save className="mr-1 h-4 w-4" />
              Save Table Info
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
