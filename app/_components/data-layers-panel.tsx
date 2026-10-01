"use client";

import type { ReactNode } from "react";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { DATA_LAYERS, type DataLayerKey } from "@/lib/city/data-layers";
import type { LookValues } from "@/lib/city/look-controls";

/**
 * The data layers' switches (lib/city/data-layers.ts): one per layer, its
 * line of explanation, and — while it is on — its credit and whatever the
 * layer has to say in words (`detail`; the scene itself carries no text).
 */
export function DataLayersPanel({
  detail,
  look,
  onLook,
}: {
  detail?: Partial<Record<DataLayerKey, ReactNode>>;
  look: LookValues;
  onLook: (patch: Partial<LookValues>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {DATA_LAYERS.map((def) => (
        <div className="flex flex-col gap-1" key={def.key}>
          <Field orientation="horizontal">
            <FieldLabel className="font-medium text-xs" htmlFor={def.id}>
              {def.label}
            </FieldLabel>
            <Switch
              checked={look[def.key]}
              id={def.id}
              onCheckedChange={(checked) => {
                const patch: Partial<LookValues> = {};
                patch[def.key] = checked;
                onLook(patch);
              }}
              size="sm"
            />
          </Field>
          <FieldDescription className="text-[11px] leading-snug">
            {def.description}
          </FieldDescription>
          {look[def.key] && (
            <>
              {detail?.[def.key]}
              <span className="text-[10px] text-muted-foreground">
                {def.source}
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
