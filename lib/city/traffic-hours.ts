/**
 * The counted traffic through the day: the city publishes vehicles per
 * DAY (pipeline/bake/traffic.py), the scene has a clock — so the flows
 * follow a typical daily curve (a "Tagesganglinie"), scaled to each
 * street's own count. The curve is the same for every street (the counts
 * carry no hours of their own): a measured shape, not a measured street.
 * Public holidays count as working days (the calendar is not known here).
 * No THREE, no DOM.
 */
import { dayKindOf, secondsOfDay, type TramDayKind } from "./tram-timetable";

export type TrafficDayKind = TramDayKind;

/**
 * The share of a day's vehicles in each hour (0–1 h … 23–24 h, local
 * time), per kind of day, normalised to 1 below. Measured: Hamburg's
 * infrared counters on 38 inner-city main roads (the Urban Data
 * Platform's SensorThings service, `HH_STA_Verkehrsdaten_Kfz_
 * Infrarotdetektoren`, hourly; Freie und Hansestadt Hamburg,
 * dl-de/by-2-0), September 2026 — each station's days with 24 good hours
 * normalised and averaged, then the stations. Dresden publishes counts per
 * day only; the shape of a German city's main roads stands in for its
 * hours. On a working day: a morning peak at 7–9 h, the broader evening
 * one at 15–18 h, the night near a third of a percent; Saturday rises to a
 * midday plateau; Sunday stays low into the morning, peaks in the
 * afternoon.
 */
const RAW_HOURS: Record<TrafficDayKind, readonly number[]> = {
  weekday: [
    0.0061, 0.0037, 0.0031, 0.0035, 0.0073, 0.0224, 0.0422, 0.0632, 0.0658,
    0.0559, 0.0539, 0.0554, 0.0591, 0.0628, 0.0698, 0.0751, 0.0762, 0.0726,
    0.0631, 0.0456, 0.0332, 0.0254, 0.0211, 0.0134,
  ],
  saturday: [
    0.0161, 0.0108, 0.0078, 0.0067, 0.008, 0.0116, 0.0145, 0.0212, 0.0345,
    0.0502, 0.064, 0.0704, 0.075, 0.0772, 0.0769, 0.0723, 0.0686, 0.068, 0.0637,
    0.0527, 0.0413, 0.0328, 0.0299, 0.0258,
  ],
  sunday: [
    0.0231, 0.0163, 0.0116, 0.0087, 0.0083, 0.0103, 0.0107, 0.0146, 0.0247,
    0.0411, 0.0553, 0.0645, 0.0732, 0.0779, 0.0787, 0.0757, 0.0728, 0.0756,
    0.0714, 0.0615, 0.0478, 0.0346, 0.0259, 0.016,
  ],
};

function normalised(hours: readonly number[]): number[] {
  const sum = hours.reduce((a, b) => a + b, 0);
  return hours.map((h) => h / sum);
}

/** The share of the day's vehicles in each hour, per kind of day (sums
 *  to 1). */
export const TRAFFIC_HOURS: Record<TrafficDayKind, readonly number[]> = {
  weekday: normalised(RAW_HOURS.weekday),
  saturday: normalised(RAW_HOURS.saturday),
  sunday: normalised(RAW_HOURS.sunday),
};

/**
 * How busy the streets are at `seconds` into a day of this kind, as a
 * multiple of the day's average hour (1 = a 24th of the day's vehicles
 * per hour). Each hour's share sits at the hour's middle, linear between
 * them, so the curve never jumps; across midnight it runs into the next
 * hour of the same kind of day.
 */
export function trafficFactorAt(kind: TrafficDayKind, seconds: number): number {
  const hours = TRAFFIC_HOURS[kind];
  const h = (((seconds / 3600 - 0.5) % 24) + 24) % 24;
  const i = Math.floor(h);
  const t = h - i;
  const a = hours[i];
  const b = hours[(i + 1) % 24];
  return (a + (b - a) * t) * 24;
}

/** `trafficFactorAt` for an instant (its local day kind and time). */
export function trafficFactor(date: Date): number {
  return trafficFactorAt(dayKindOf(date), secondsOfDay(date));
}

/** The speed (m/s) the light runs at with this much traffic: ~40 km/h
 *  through the day, slowing to about half at the evening peak — the comets
 *  bunch where the street is full. */
export function trafficSpeed(factor: number): number {
  const free = 11;
  return free / (1 + Math.max(factor - 1, 0) * 1.6);
}

/** What the HUD says about the hour: the day kind and how busy, as a
 *  percentage of the day's average hour. */
export interface TrafficHourStatus {
  kind: TrafficDayKind;
  /** 1 = the day's average hour */
  factor: number;
  /** "HH:MM", the scene's time */
  time: string;
}

export function trafficHourStatus(date: Date): TrafficHourStatus {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return {
    kind: dayKindOf(date),
    factor: trafficFactor(date),
    time: `${hh}:${mm}`,
  };
}
