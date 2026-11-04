"use client";

import { CloudIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "cn";
import type { Speech } from "./ask-voice";

/** What the picker says of the voice reading now. */
function pickerTitle(voice: string | null, online: boolean): string {
  if (voice === null) {
    return "Dieses Gerät hat keine eigene deutsche Stimme: eine Online-Stimme wählen, um vorzulesen";
  }
  return online
    ? "Online-Stimme: der vorgelesene Text geht an ihren Anbieter"
    : "Stimme dieses Geräts: nichts verlässt das Gerät";
}

/**
 * Which voice reads aloud (ADR 0057): the device's German voices, the
 * best-sounding first. An online one (Google's, Microsoft's) is marked:
 * picked, the text it reads goes to that service. Nothing is shown with
 * a single voice of the device's own; a device with only online voices
 * reads nothing until one is picked.
 */
export const VoicePicker = ({
  className,
  speech,
}: {
  className?: string;
  speech: Speech;
}) => {
  const { voice, voices } = speech;
  if (voices.length === 0 || (voices.length === 1 && voice)) {
    return null;
  }
  const online = voices.find((v) => v.name === voice)?.online;
  return (
    <Select
      items={voices.map((v) => ({ value: v.name, label: v.name }))}
      onValueChange={(v) => {
        if (typeof v === "string") {
          speech.setVoice(v);
        }
      }}
      value={voice}
    >
      <SelectTrigger
        aria-label="Stimme"
        className={cn("max-w-56 font-sans", className)}
        data-testid="voice-picker"
        size="sm"
        title={pickerTitle(voice, online === true)}
      >
        <SelectValue placeholder="Online-Stimme wählen" />
      </SelectTrigger>
      <SelectContent>
        {voices.map((v) => (
          <SelectItem key={v.name} value={v.name}>
            <span className="flex items-center gap-1.5">
              {v.name}
              {v.online && (
                <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                  <CloudIcon aria-hidden className="size-3" />
                  online
                </span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
