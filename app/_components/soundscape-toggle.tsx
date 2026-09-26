"use client";

import { Volume1Icon } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { PlayerPose } from "@/lib/city/pose";
import { audible } from "@/lib/city/sound-entry";
import type { CityWalkHandle } from "./create-app";
import { isTextEntry } from "./keyboard-controls";
import type { Soundscape } from "./soundscape/engine";

/**
 * The hidden soundscape's switch (plan 035). Off at every load, and no
 * AudioContext exists until the visitor asks for sound — with the L key
 * (*lauschen*, listed nowhere) or the quiet switch at the bottom of the
 * Erweitert tab. The context is created inside that gesture (iOS Safari
 * unlocks audio only there); the engine arrives by dynamic import, so the
 * page nobody listens to carries none of it. Hidden tab: faded out and
 * suspended. The speaker glyph shows while it plays; a click turns it off.
 */

interface WebAudioWindow {
  AudioContext?: typeof AudioContext;
}

/**
 * The AudioContext the engine can play on, or null: the voices pan with
 * StereoPanner and drive their levels from a ConstantSource, which the
 * prefixed `webkitAudioContext` of old Safari lacks — there the switch does
 * not turn on at all, rather than on and silent.
 */
export function playableAudioContext(
  w: WebAudioWindow
): typeof AudioContext | null {
  const Ctor = w.AudioContext;
  const proto = Ctor?.prototype as Partial<BaseAudioContext> | undefined;
  return Ctor &&
    typeof proto?.createStereoPanner === "function" &&
    typeof proto.createConstantSource === "function"
    ? Ctor
    : null;
}

/** Safari 16.4+: an ambient session mixes with the visitor's own audio and
 *  keeps to the ring/silent switch, as ambience should. */
function preferAmbientSession() {
  const session = (navigator as { audioSession?: { type: string } })
    .audioSession;
  if (session) {
    session.type = "ambient";
  }
}

export interface SoundscapeControl {
  on: boolean;
  toggle: () => void;
}

export function useSoundscape({
  date,
  handleRef,
  nightFactor,
  ready,
  subscribePose,
}: {
  date: Date;
  handleRef: RefObject<CityWalkHandle | null>;
  nightFactor: number;
  /** the scene is running and the loading screen gone */
  ready: boolean;
  subscribePose: (cb: (pose: PlayerPose) => void) => () => void;
}): SoundscapeControl {
  const [on, setOn] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const engineRef = useRef<Soundscape | null>(null);
  // Bumped on every toggle: an engine that loads after a later "off" is
  // dropped, not started.
  const generation = useRef(0);
  const clockRef = useRef({ date, nightFactor });
  const readyRef = useRef(ready);
  const onRef = useRef(false);

  // Never behind the loading screen, also while playing: a scene that
  // reloads closes the master until it is back.
  useEffect(() => {
    readyRef.current = ready;
    engineRef.current?.setAudible(
      audible({
        enabled: onRef.current,
        hidden: document.hidden,
        loading: !ready,
      })
    );
  }, [ready]);

  useEffect(() => {
    clockRef.current = { date, nightFactor };
    engineRef.current?.setClock(date, nightFactor);
  }, [date, nightFactor]);

  const turnOff = useCallback(() => {
    generation.current++;
    onRef.current = false;
    setOn(false);
    const engine = engineRef.current;
    engineRef.current = null;
    if (!engine) {
      // Off before the engine arrived: nothing to fade, the context stops now.
      void ctxRef.current?.suspend();
      return;
    }
    void engine.dispose().then(() => {
      if (!onRef.current) {
        void ctxRef.current?.suspend();
      }
    });
  }, []);

  const turnOn = useCallback(() => {
    const handle = handleRef.current;
    const Ctor = playableAudioContext(window);
    if (!(handle && Ctor)) {
      return;
    }
    preferAmbientSession();
    // Created (or resumed) here, in the gesture — never before.
    const ctx = ctxRef.current ?? new Ctor({ latencyHint: "playback" });
    ctxRef.current = ctx;
    void ctx.resume();
    const mine = ++generation.current;
    onRef.current = true;
    setOn(true);
    const source = {
      listen: (r: number) => handleRef.current?.listen(r) ?? null,
      offset: handle.offset,
      soundTiles: handle.soundTiles,
    };
    import("./soundscape/engine")
      .then(({ startSoundscape }) => {
        if (mine !== generation.current) {
          return;
        }
        const engine = startSoundscape(ctx, source);
        engine.setClock(clockRef.current.date, clockRef.current.nightFactor);
        engine.setAudible(
          audible({
            enabled: true,
            hidden: document.hidden,
            loading: !readyRef.current,
          })
        );
        engineRef.current = engine;
      })
      .catch(() => {
        // The chunk did not load or the engine threw: off again (glyph
        // gone, context suspended), not on and silent.
        if (mine === generation.current) {
          turnOff();
        }
      });
  }, [handleRef, turnOff]);

  const toggle = useCallback(() => {
    if (onRef.current) {
      turnOff();
    } else if (readyRef.current) {
      turnOn();
    }
  }, [turnOff, turnOn]);

  // L — lauschen. Not in the control hints, on purpose.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.code !== "KeyL" ||
        e.repeat ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        isTextEntry(e.target)
      ) {
        return;
      }
      toggle();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggle]);

  // The environment at the pose rate (10 Hz), never in the render loop.
  useEffect(
    () => subscribePose((pose) => engineRef.current?.sample(pose)),
    [subscribePose]
  );

  // A hidden tab is silent (and its context suspended); back, it fades in.
  useEffect(() => {
    let suspendTimer: ReturnType<typeof setTimeout> | undefined;
    const onVisibility = () => {
      const ctx = ctxRef.current;
      if (!(ctx && onRef.current)) {
        return;
      }
      const hear = audible({
        enabled: onRef.current,
        hidden: document.hidden,
        loading: !readyRef.current,
      });
      clearTimeout(suspendTimer);
      engineRef.current?.setAudible(hear);
      if (hear) {
        void ctx.resume();
      } else {
        suspendTimer = setTimeout(() => void ctx.suspend(), 500);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(suspendTimer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Leaving the viewer closes the context.
  useEffect(
    () => () => {
      generation.current++;
      void engineRef.current?.dispose();
      engineRef.current = null;
      void ctxRef.current?.close();
      ctxRef.current = null;
    },
    []
  );

  return { on, toggle };
}

/** The speaker glyph in the HUD corner while the soundscape plays. */
export function SoundGlyph({ onClick }: { onClick: () => void }) {
  return (
    <button
      aria-label="Klang ausschalten"
      className="absolute top-4 left-4 z-20 flex size-8 items-center justify-center rounded-full bg-hud/70 text-hud-foreground/80 shadow-sm backdrop-blur-lg transition-colors hover:bg-hud/90 hover:text-hud-foreground"
      data-testid="sound-glyph"
      onClick={onClick}
      title="Klang ausschalten (L)"
      type="button"
    >
      <Volume1Icon aria-hidden className="size-4" />
    </button>
  );
}
