/**
 * Rhino's model unit (openNURBS `ON::LengthUnitSystem`) in metres: a
 * .3dm's coordinates are in it (design-formats.ts). Unknown, none and
 * custom units are taken as metres. No THREE, no DOM.
 */

const METRES: Readonly<Record<number, number>> = {
  1: 1e-6, // microns
  2: 1e-3, // millimetres
  3: 1e-2, // centimetres
  4: 1, // metres
  5: 1e3, // kilometres
  6: 2.54e-8, // microinches
  7: 2.54e-5, // mils
  8: 0.0254, // inches
  9: 0.3048, // feet
  10: 1609.344, // miles
  12: 1e-10, // ångströms
  13: 1e-9, // nanometres
  14: 0.1, // decimetres
  15: 10, // dekametres
  16: 100, // hectometres
  17: 1e6, // megametres
  18: 1e9, // gigametres
  19: 0.9144, // yards
  20: 3.527_777_8e-4, // printer's points (1/72 in)
  21: 4.233_333e-3, // printer's picas
  22: 1852, // nautical miles
  23: 1.495_978_707e11, // astronomical units
  24: 9.460_730_472_580_8e15, // light years
  25: 3.085_677_581_49e16, // parsecs
};

/** The unit's length in metres (1 where unknown). */
export function rhinoUnitMetres(unit: number | null): number {
  return unit === null ? 1 : (METRES[unit] ?? 1);
}
