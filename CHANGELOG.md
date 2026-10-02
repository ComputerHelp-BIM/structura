# Changelog
All notable changes follow [Semantic Versioning](https://semver.org).

## 1.8.1 — 2026-10-02
- Steel members (ISMB, UC, SHS, angles) no longer get a reinforcement cage.
- Beam anchorage is counted only where the beam stops, not at every interior joint (a 3.6 m span was 43% over).
- Confining-zone link spacing follows IS 13920 rather than half the span spacing.
- Slab and wall mesh steps up with thickness; two-way slabs get top steel over the supports; slab end allowance per IS 456 Cl 26.2.3.3.
- Undetailed concrete falls back to the assumed kg/m³ in costing instead of dropping out.
- Samples: walls/openings, staircase and footings removed — seven remain.

## 1.8.0 — 2026-10-02
- Fixed: links/stirrups now wrap around the main bars instead of sharing their line; slab mesh sits inside the slab; beam side cover separated; circular columns get a circular cage.
- IS 456 / IS 13920 detailing: 135° hooks with 10d legs, cross-ties, confining zones at member ends, bar bending deductions, development-length laps and anchorage.
- Detailing checks: steel percentages, link spacing and bar congestion per section.
- Three more sample buildings: walls with doors/windows/lintels/chajjas, staircase with landings and lift core, footings with pedestals and plinth beams.

## 1.7.0 — 2026-10-02
- Reinforcement: 3-D bar cages (columns from the file's own bar pattern; beams, slabs and walls from editable rules), cutaway/bars-only display, explode, bar hover, section cut and a to-scale cross-section drawing.
- Steel quantities by diameter, member type (kg/m³), floor and element, with ratio outliers flagged.
- Bar bending schedule on screen, as CSV, as an Excel sheet and a reinforcement page in the PDF report.
- Measured steel replaces the assumed kg/m³ in the BOQ, every row labelled.

## 1.6.0 — 2026-09-24
- Seismic weight per storey to IS 1893:2016 Cl 7.3; load pattern take-off; structure self weight; point loads counted.
- Spread colour scale, "Select unloaded", health check for unloaded floor panels, filter by load intensity.
- Fixed: the load map button now toggles off and restores the previous colouring.

## 1.5.0 — 2026-09-24
- Load intensity map: colour slabs (kN/m²) and beams (kN/m) by any load pattern or combination in the file, with optional self weight.
- Loads by floor panel: maxima, weighted averages, load per floor in kN, building totals; per-element breakdown and "Same load" selection.
- Storey maxima beside the model, legend baked into PNG exports, load page in the PDF report, two load sheets in the Excel workbook, load CSVs.
- Sample buildings now carry realistic loading.

## 1.4.1 — 2026-09-21
- Fixed flicker (z-fighting) where slab, beam and column tops meet; logarithmic depth buffer.
- Explode button toggles: a second press folds the storeys back; Reset (E) animates and clears all spreads.

## 1.4.0 — 2026-09-21
- Insertion-point offsets (OFFSETXI/YI/ZI…) applied; split LINEASSIGN records merged (fixes columns drawn twice).
- Curved/multilinear beams from LINE CURVE DATA.
- Standalone Vercel package: self-hosted libraries, security headers, pre-deploy check.

## 1.3.0 — Beam cardinal points; slab top = beam top; overlapping-columns health check.
## 1.2.1 — Box-clip controls, undoable slider drags, clipping/undo fixes, phone layout.
## 1.2.0 — Newer ETABS record layouts, “What is in this file?” diagnostic, reload button.
## 1.1.0 — Resizable panels, undo/redo, action pop-ups, illustrated guide & FAQ, tooltips.
## 1.0.0 — First release.
