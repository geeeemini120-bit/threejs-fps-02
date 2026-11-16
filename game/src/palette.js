// DUSTLINE's look plan, in one place. A desert outpost at dusk: warm sand and rust
// against cool slate, one amber accent, and two team colours that read at a glance.
// The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#1a1410',
  surface: '#2b211a',
  hairline: '#3d2f24',
  sand: '#c8a06a',
  rust: '#b4552d',
  slate: '#3a4148',
  concrete: '#6e675c',
  ink: '#f2ead9',
  muted: '#a89a83',
  accent: '#ffb020',
  team: '#4d9de0',
  enemy: '#e5484d',
  site: '#37d67a',
};

export function shade(name) {
  return PALETTE[name];
}
