/**
 * guide.js — The illustrated guide, FAQ and intent flows.
 * =================================================================
 * Content lives here as data, not markup scattered through the app, so the
 * guide, the command palette and the tooltips can all be driven from one
 * description of what each thing does.
 *
 * Diagrams are inline SVG using theme tokens via `currentColor` and CSS
 * custom properties, so they read correctly in both themes without a second
 * set of assets.
 *
 * Namespace: window.ETABSGuide
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Diagrams                                                            */
  /* ------------------------------------------------------------------ */

  function svg(body, w, h, label) {
    return '<svg class="gfx" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' +
      label + '" xmlns="http://www.w3.org/2000/svg">' + body + '</svg>';
  }

  var DIAGRAMS = {

    /* Where each format can and cannot go. */
    formats: function () {
      var rows = [
        ['.e2k  .$et', 'ETABS text model', 'full', 'Geometry, sections, materials, grids, storeys'],
        ['.s2k  .$2k', 'SAP2000 text model', 'full', 'True 3-D joints, frames and areas'],
        ['.csv  .txt', 'ETABS table export', 'full', 'Needs Joint Coordinates + Connectivity + Assignments'],
        ['.xlsx', 'ETABS workbook export', 'full', 'Same tables, read from the sheets'],
        ['.edb  .ebk', 'Proprietary binary', 'none', 'Cannot be parsed — the app shows an export guide']
      ];
      var body = '';
      rows.forEach(function (r, i) {
        var y = 14 + i * 46;
        var ok = r[2] === 'full';
        body +=
          '<rect x="6" y="' + y + '" width="118" height="36" rx="6" fill="var(--surface-2)" stroke="var(--line)"/>' +
          '<text x="65" y="' + (y + 22) + '" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">' + r[0] + '</text>' +
          '<path d="M128 ' + (y + 18) + ' H176" stroke="' + (ok ? 'var(--ok)' : 'var(--crit)') + '" stroke-width="2" stroke-dasharray="' + (ok ? '0' : '5 4') + '"/>' +
          '<circle cx="180" cy="' + (y + 18) + '" r="5" fill="' + (ok ? 'var(--ok)' : 'var(--crit)') + '"/>' +
          '<text x="196" y="' + (y + 14) + '" font-size="12.5" font-weight="600" fill="var(--ink)">' + r[1] + '</text>' +
          '<text x="196" y="' + (y + 29) + '" font-size="11" fill="var(--ink-3)">' + r[3] + '</text>';
      });
      return svg(body, 640, 250, 'Which file formats open and which do not');
    },

    /* Annotated layout of the interface. */
    layout: function () {
      var body =
        '<rect x="4" y="4" width="632" height="248" rx="8" fill="var(--surface-2)" stroke="var(--line)"/>' +
        // top bar
        '<rect x="4" y="4" width="632" height="30" rx="8" fill="var(--surface-3)"/>' +
        '<rect x="4" y="26" width="632" height="8" fill="var(--surface-3)"/>' +
        '<circle cx="24" cy="19" r="7" fill="var(--accent)"/>' +
        '<text x="40" y="23" font-size="11" font-weight="600" fill="var(--ink-2)">Logo · app name · file · clock · theme</text>' +
        // rail
        '<rect x="12" y="42" width="140" height="170" rx="6" fill="var(--surface)" stroke="var(--accent)" stroke-width="1.5"/>' +
        '<text x="82" y="70" text-anchor="middle" font-size="12" font-weight="700" fill="var(--accent)">1 · CONTROL RAIL</text>' +
        '<text x="82" y="88" text-anchor="middle" font-size="10.5" fill="var(--ink-3)">Every setting,</text>' +
        '<text x="82" y="102" text-anchor="middle" font-size="10.5" fill="var(--ink-3)">grouped in panels</text>' +
        '<g stroke="var(--line)" stroke-width="1">' +
        '<path d="M24 118 H140"/><path d="M24 134 H140"/><path d="M24 150 H140"/><path d="M24 166 H140"/><path d="M24 182 H140"/>' +
        '</g>' +
        // grip 1
        '<rect x="154" y="100" width="4" height="54" rx="2" fill="var(--accent)"/>' +
        '<text x="156" y="170" text-anchor="middle" font-size="9.5" fill="var(--accent)">drag</text>' +
        // stage
        '<rect x="164" y="42" width="308" height="170" rx="6" fill="var(--surface)" stroke="var(--line)"/>' +
        '<rect x="252" y="52" width="132" height="22" rx="11" fill="var(--surface-3)"/>' +
        '<text x="318" y="67" text-anchor="middle" font-size="10" font-weight="600" fill="var(--ink-2)">3 · TOOLBAR</text>' +
        '<g fill="var(--accent)" opacity=".8">' +
        '<rect x="272" y="96" width="14" height="86" rx="2"/><rect x="316" y="96" width="14" height="86" rx="2"/>' +
        '<rect x="360" y="96" width="14" height="86" rx="2"/>' +
        '<rect x="266" y="112" width="114" height="7" rx="2"/><rect x="266" y="140" width="114" height="7" rx="2"/>' +
        '<rect x="266" y="168" width="114" height="7" rx="2"/>' +
        '</g>' +
        '<text x="318" y="200" text-anchor="middle" font-size="12" font-weight="700" fill="var(--ink-2)">2 · THE MODEL</text>' +
        '<rect x="174" y="96" width="42" height="86" rx="5" fill="var(--surface-2)" stroke="var(--line)"/>' +
        '<text x="195" y="128" text-anchor="middle" font-size="8.5" fill="var(--ink-3)">storey</text>' +
        '<text x="195" y="140" text-anchor="middle" font-size="8.5" fill="var(--ink-3)">ladder</text>' +
        // grip 2
        '<rect x="474" y="100" width="4" height="54" rx="2" fill="var(--accent)"/>' +
        '<text x="476" y="170" text-anchor="middle" font-size="9.5" fill="var(--accent)">drag</text>' +
        // drawer
        '<rect x="484" y="42" width="144" height="170" rx="6" fill="var(--surface)" stroke="var(--accent)" stroke-width="1.5"/>' +
        '<rect x="494" y="52" width="124" height="20" rx="5" fill="var(--surface-3)"/>' +
        '<text x="556" y="66" text-anchor="middle" font-size="9.5" fill="var(--ink-2)">▾ pick a panel</text>' +
        '<text x="556" y="96" text-anchor="middle" font-size="12" font-weight="700" fill="var(--accent)">4 · DATA</text>' +
        '<text x="556" y="112" text-anchor="middle" font-size="10.5" fill="var(--ink-3)">Properties, stats,</text>' +
        '<text x="556" y="126" text-anchor="middle" font-size="10.5" fill="var(--ink-3)">quantities, health,</text>' +
        '<text x="556" y="140" text-anchor="middle" font-size="10.5" fill="var(--ink-3)">code, compare</text>' +
        // status
        '<rect x="4" y="220" width="632" height="28" rx="8" fill="var(--surface-3)"/>' +
        '<rect x="4" y="220" width="632" height="10" fill="var(--surface-3)"/>' +
        '<text x="20" y="238" font-size="10.5" font-family="var(--font-mono)" fill="var(--ink-3)">5 · element counts · parse time · units · selection · fps</text>';
      return svg(body, 640, 256, 'The five regions of the interface');
    },

    /* Mouse and key map. */
    navigation: function () {
      var body =
        '<g transform="translate(40,26)">' +
        '<rect x="0" y="0" width="96" height="140" rx="42" fill="var(--surface-2)" stroke="var(--line)" stroke-width="1.5"/>' +
        '<path d="M48 0 V52" stroke="var(--line)" stroke-width="1.5"/>' +
        '<path d="M0 52 H96" stroke="var(--line)" stroke-width="1.5"/>' +
        '<path d="M0 42 A48 48 0 0 1 48 0 V52 H0 Z" fill="var(--accent)" opacity=".22"/>' +
        '<rect x="42" y="14" width="12" height="24" rx="6" fill="var(--ochre)" opacity=".55"/>' +
        '<path d="M48 0 A48 48 0 0 1 96 42 V52 H48 Z" fill="var(--ok)" opacity=".2"/>' +
        '</g>' +
        '<text x="150" y="44" font-size="12.5" font-weight="600" fill="var(--ink)">Left drag</text>' +
        '<text x="150" y="60" font-size="11.5" fill="var(--ink-3)">Orbit around the model</text>' +
        '<text x="150" y="86" font-size="12.5" font-weight="600" fill="var(--ink)">Right drag · or Shift + drag</text>' +
        '<text x="150" y="102" font-size="11.5" fill="var(--ink-3)">Pan the view sideways and up</text>' +
        '<text x="150" y="128" font-size="12.5" font-weight="600" fill="var(--ink)">Scroll wheel</text>' +
        '<text x="150" y="144" font-size="11.5" fill="var(--ink-3)">Zoom in and out</text>' +
        '<text x="150" y="170" font-size="12.5" font-weight="600" fill="var(--ink)">Alt + drag</text>' +
        '<text x="150" y="186" font-size="11.5" fill="var(--ink-3)">Rubber-band select everything in the box</text>' +
        '<text x="400" y="44" font-size="12.5" font-weight="600" fill="var(--ink)">Click</text>' +
        '<text x="400" y="60" font-size="11.5" fill="var(--ink-3)">Select · opens its properties</text>' +
        '<text x="400" y="86" font-size="12.5" font-weight="600" fill="var(--ink)">Double click</text>' +
        '<text x="400" y="102" font-size="11.5" fill="var(--ink-3)">Isolate that whole grid line</text>' +
        '<text x="400" y="128" font-size="12.5" font-weight="600" fill="var(--ink)">Right click</text>' +
        '<text x="400" y="144" font-size="11.5" fill="var(--ink-3)">Action menu for what you clicked</text>' +
        '<text x="400" y="170" font-size="12.5" font-weight="600" fill="var(--ink)">Two fingers</text>' +
        '<text x="400" y="186" font-size="11.5" fill="var(--ink-3)">Pan and pinch-zoom on a touchscreen</text>';
      return svg(body, 640, 210, 'Mouse and touch controls');
    },

    /* How a quantity is derived. */
    quantity: function () {
      var body =
        '<text x="10" y="20" font-size="12" font-weight="700" fill="var(--ink-2)">A CONCRETE VOLUME, END TO END</text>' +
        // section
        '<g transform="translate(20,44)">' +
        '<rect x="0" y="0" width="54" height="86" rx="3" fill="var(--accent)" opacity=".3" stroke="var(--accent)" stroke-width="1.5"/>' +
        '<path d="M0 -8 H54" stroke="var(--ink-3)" stroke-width="1"/>' +
        '<text x="27" y="-13" text-anchor="middle" font-size="10" font-family="var(--font-mono)" fill="var(--ink-3)">B</text>' +
        '<path d="M-10 0 V86" stroke="var(--ink-3)" stroke-width="1"/>' +
        '<text x="-18" y="46" text-anchor="middle" font-size="10" font-family="var(--font-mono)" fill="var(--ink-3)">D</text>' +
        '</g>' +
        '<text x="96" y="92" font-size="16" fill="var(--ink-3)">×</text>' +
        // length
        '<g transform="translate(120,72)">' +
        '<rect x="0" y="14" width="150" height="30" rx="3" fill="var(--accent)" opacity=".3" stroke="var(--accent)" stroke-width="1.5"/>' +
        '<path d="M0 58 H150" stroke="var(--ink-3)"/>' +
        '<path d="M0 54 V62 M150 54 V62" stroke="var(--ink-3)"/>' +
        '<text x="75" y="76" text-anchor="middle" font-size="10" font-family="var(--font-mono)" fill="var(--ink-3)">length from joint to joint</text>' +
        '</g>' +
        '<text x="286" y="92" font-size="16" fill="var(--ink-3)">=</text>' +
        '<rect x="310" y="66" width="120" height="48" rx="6" fill="var(--ok)" opacity=".16" stroke="var(--ok)"/>' +
        '<text x="370" y="88" text-anchor="middle" font-size="12" font-weight="700" fill="var(--ok)">Volume m³</text>' +
        '<text x="370" y="104" text-anchor="middle" font-size="10" fill="var(--ink-3)">measured, not estimated</text>' +
        '<path d="M436 90 H468" stroke="var(--ink-3)" stroke-dasharray="4 3"/>' +
        '<rect x="474" y="52" width="152" height="76" rx="6" fill="var(--ochre)" opacity=".14" stroke="var(--ochre)"/>' +
        '<text x="550" y="74" text-anchor="middle" font-size="12" font-weight="700" fill="var(--ochre)">× your rate</text>' +
        '<text x="550" y="92" text-anchor="middle" font-size="10.5" fill="var(--ink-3)">rebar kg/m³, cost per m³</text>' +
        '<text x="550" y="108" text-anchor="middle" font-size="10.5" fill="var(--ink-3)">→ ESTIMATED, from your</text>' +
        '<text x="550" y="121" text-anchor="middle" font-size="10.5" fill="var(--ink-3)">rate card, not the file</text>' +
        '<text x="10" y="178" font-size="11" fill="var(--ink-3)">Everything left of the dashed line is measured from your model.</text>' +
        '<text x="10" y="192" font-size="11" fill="var(--ink-3)">Everything right of it is an assumption you control.</text>';
      return svg(body, 640, 202, 'How a concrete quantity and its cost are derived');
    },

    /* Clipping. */
    slicing: function () {
      var body =
        '<g transform="translate(24,20)">' +
        '<text x="0" y="0" font-size="11.5" font-weight="700" fill="var(--ink-2)">CLIP PLANE</text>' +
        '<rect x="0" y="14" width="120" height="100" rx="4" fill="var(--accent)" opacity=".22" stroke="var(--accent)"/>' +
        '<path d="M74 6 V122" stroke="var(--crit)" stroke-width="2" stroke-dasharray="5 4"/>' +
        '<rect x="74" y="14" width="46" height="100" fill="var(--paper)" opacity=".85"/>' +
        '<text x="30" y="70" font-size="10" fill="var(--ink-2)">kept</text>' +
        '<text x="92" y="70" font-size="10" fill="var(--ink-3)">cut</text>' +
        '</g>' +
        '<g transform="translate(204,20)">' +
        '<text x="0" y="0" font-size="11.5" font-weight="700" fill="var(--ink-2)">GRID SECTION</text>' +
        '<rect x="0" y="14" width="120" height="100" rx="4" fill="var(--accent)" opacity=".14" stroke="var(--line)"/>' +
        '<rect x="44" y="14" width="30" height="100" fill="var(--accent)" opacity=".38" stroke="var(--accent)"/>' +
        '<circle cx="59" cy="6" r="8" fill="none" stroke="var(--accent)" stroke-width="1.5"/>' +
        '<text x="59" y="10" text-anchor="middle" font-size="9" fill="var(--accent)">B</text>' +
        '<text x="59" y="130" text-anchor="middle" font-size="10" fill="var(--ink-3)">a slice on one grid</text>' +
        '</g>' +
        '<g transform="translate(384,20)">' +
        '<text x="0" y="0" font-size="11.5" font-weight="700" fill="var(--ink-2)">BOX CLIP</text>' +
        '<rect x="0" y="14" width="120" height="100" rx="4" fill="var(--accent)" opacity=".12" stroke="var(--line)"/>' +
        '<rect x="30" y="38" width="58" height="52" fill="var(--accent)" opacity=".4" stroke="var(--accent)" stroke-dasharray="4 3"/>' +
        '<text x="59" y="130" text-anchor="middle" font-size="10" fill="var(--ink-3)">six sides at once</text>' +
        '</g>' +
        '<g transform="translate(524,20)">' +
        '<text x="0" y="0" font-size="11.5" font-weight="700" fill="var(--ink-2)">PLAN SLICE</text>' +
        '<rect x="0" y="14" width="96" height="100" rx="4" fill="var(--accent)" opacity=".12" stroke="var(--line)"/>' +
        '<rect x="0" y="52" width="96" height="24" fill="var(--accent)" opacity=".42" stroke="var(--accent)"/>' +
        '<text x="48" y="130" text-anchor="middle" font-size="10" fill="var(--ink-3)">one storey, from above</text>' +
        '</g>';
      return svg(body, 640, 160, 'The four ways to cut into a model');
    },

    /* Health check meanings. */
    health: function () {
      var items = [
        ['Duplicate members', 'Two beams on the same line', 'Doubles stiffness and self-weight, invisible in plan'],
        ['Discontinuous column', 'A column starting on a beam', 'Soft-storey and vertical-irregularity flag'],
        ['Orphan joint', 'A node attached to nothing', 'Adds free degrees of freedom — unstable analysis'],
        ['Zero-length member', 'Both ends on one point', 'The solver will refuse it'],
        ['Undefined section', 'A property the file never declares', 'Quantities for it cannot be trusted']
      ];
      var body = '';
      items.forEach(function (it, i) {
        var y = 16 + i * 40;
        body +=
          '<rect x="6" y="' + y + '" width="3" height="30" rx="1.5" fill="var(--crit)"/>' +
          '<text x="20" y="' + (y + 13) + '" font-size="12.5" font-weight="600" fill="var(--ink)">' + it[0] + '</text>' +
          '<text x="20" y="' + (y + 27) + '" font-size="11" fill="var(--ink-3)">' + it[1] + '</text>' +
          '<text x="300" y="' + (y + 20) + '" font-size="11.5" fill="var(--ink-2)">' + it[2] + '</text>';
      });
      return svg(body, 640, 210, 'What each model health check looks for');
    }
  };

  /* ------------------------------------------------------------------ */
  /* Guide sections                                                      */
  /* ------------------------------------------------------------------ */

  var SECTIONS = [
    {
      id: 'start',
      title: 'What this is',
      keywords: 'start begin intro what open upload drop file',
      html:
        '<p>Structura opens an ETABS or SAP2000 model in your browser and lets you look at it in 3-D, ' +
        'measure it, take quantities off it and check it for common modelling errors. It needs no ETABS ' +
        'licence and no installation, and it works on a laptop, an iPad or a phone.</p>' +
        '<p><b>Nothing you open is uploaded anywhere.</b> Parsing, quantities and exports all happen in ' +
        'this browser tab. Close the tab and the model is gone.</p>' +
        '<h4>What it can open</h4>' +
        DIAGRAMS.formats() +
        '<p class="cap">A <code>.$et</code> file is the autosave ETABS leaves beside your model — it is ' +
        'already text, so it can be dropped straight in.</p>'
    },
    {
      id: 'layout',
      title: 'The interface',
      keywords: 'layout panel rail drawer toolbar status resize drag',
      html:
        '<p>Five regions. The two dividers marked below can be dragged to resize, and double-clicked to ' +
        'snap back to their default width.</p>' +
        DIAGRAMS.layout() +
        '<ol class="numbered">' +
        '<li><b>Control rail</b> — every setting, grouped into panels. Filter the panels with the box at ' +
        'the top, and pin the ones you use to the top with the pin icon.</li>' +
        '<li><b>The model</b> — orbit, pan and zoom here. Floating instruments sit over it: the storey ' +
        'ladder on the left, the orientation cube top right, the plan locator and the audio player bottom right.</li>' +
        '<li><b>Toolbar</b> — the actions you reach for constantly. Hover any button to see what it does.</li>' +
        '<li><b>Data drawer</b> — properties of what you selected, plus statistics, quantities, health, ' +
        'code screening and revision comparison. Pick the panel from the dropdown at its top.</li>' +
        '<li><b>Status strip</b> — how many elements exist and how many are visible, how long parsing took, ' +
        'which units are shown, and live frame rate.</li>' +
        '</ol>'
    },
    {
      id: 'navigate',
      title: 'Moving around',
      keywords: 'navigate orbit pan zoom mouse touch keyboard walk spin rotate',
      html:
        DIAGRAMS.navigation() +
        '<h4>Getting back</h4>' +
        '<p>Lost? <b>Zoom extents</b> (the corners icon, or <code>F</code>) always brings the whole model ' +
        'back. <b>Undo</b> steps back through everything you changed, not just the camera. The <b>home</b> ' +
        'button returns to the opening isometric view.</p>' +
        '<h4>Spin, cinematic and walk</h4>' +
        '<p>The <b>360° spin</b> turns the model continuously — speed is set in View &amp; camera. ' +
        '<b>Cinematic</b> adds a slow rise and fall for recording. <b>Walk</b> puts you inside the ' +
        'building: WASD to move, Q and E for height, drag to look.</p>'
    },
    {
      id: 'select',
      title: 'Selecting and isolating',
      keywords: 'select isolate hide show invert pick filter search similar',
      html:
        '<p>Click any member, slab, wall or joint to select it and open its properties. Shift-click adds ' +
        'to the selection, Alt+drag rubber-bands a box, and double-click isolates the whole grid line ' +
        'through what you clicked.</p>' +
        '<h4>The four verbs</h4>' +
        '<ul>' +
        '<li><b>Isolate</b> (<code>I</code>) — show only the selection; everything else fades to a ghost ' +
        'so you keep your bearings.</li>' +
        '<li><b>Hide</b> (<code>H</code>) — remove the selection from view.</li>' +
        '<li><b>Invert</b> (<code>V</code>) — swap what is shown for what is hidden.</li>' +
        '<li><b>Show all</b> (<code>U</code>) — put everything back.</li>' +
        '</ul>' +
        '<h4>Finding things</h4>' +
        '<p>The search box in the rail matches names, sections, materials, storeys and types. It also ' +
        'understands <code>&gt; 6m</code> for long members and <code>storey 5</code> for a level. For ' +
        'anything more specific, the filter builder stacks conditions — type, storey range, section text, ' +
        'length — and turns the result into a selection you can isolate, colour or take off.</p>'
    },
    {
      id: 'colour',
      title: 'Colour and visibility',
      keywords: 'colour color legend palette grade section storey height length',
      html:
        '<p>Colour is how a model tells you things. Switching the colour mode re-paints every element ' +
        'instantly — nothing is rebuilt.</p>' +
        '<ul>' +
        '<li><b>By type</b> — columns, beams, braces, slabs, walls. The default.</li>' +
        '<li><b>By grade</b> — where the concrete or steel grade changes up the building.</li>' +
        '<li><b>By section</b> — every distinct profile gets a colour. The fastest way to spot a section ' +
        'that changes where it should not.</li>' +
        '<li><b>By storey, height or length</b> — a gradient, for spotting odd members.</li>' +
        '</ul>' +
        '<p>In the legend, click a swatch to recolour that group, or click the row to hide it. Your ' +
        'palette can be saved and reused on any model.</p>'
    },
    {
      id: 'loads',
      title: 'Load intensity',
      keywords: 'load loads intensity slab beam kN kN/m2 udl floor maximum heat map self weight combination case',
      html:
        '<p>An ETABS file carries the loads an engineer assigned: an area load on each slab panel, a line ' +
        'load on each beam, the patterns they belong to and the combinations built from them. Structura ' +
        'reads those and paints them.</p>' +
        '<ul>' +
        '<li><b>Colour by load</b> — every slab and beam is shaded from pale blue (light) through green and ' +
        'amber to red (heaviest). Columns and walls stay grey: they carry what the floors above hand them, ' +
        'not an assigned intensity.</li>' +
        '<li><b>Case or combination</b> — start on the service total of every gravity pattern, or pick one ' +
        'pattern (LIVE on its own, say) or any combination written in the file, factors included.</li>' +
        '<li><b>Self weight</b> — slab thickness × density and beam section area × density, added on top of ' +
        'the applied loads. It only counts when the chosen case contains a dead-load pattern, so LIVE alone ' +
        'never picks it up.</li>' +
        '<li><b>Scale</b> — one scale for the whole building so floors compare directly, or rescaled to the ' +
        'floors in view so variation inside one floor becomes visible.</li>' +
        '</ul>' +
        '<h4>Floor by floor</h4>' +
        '<p><b>Loads by floor</b> in the data panel gives the maximum and the average for every storey, the ' +
        'load each floor carries in kN, and the building totals. Slab averages are weighted by area and beam ' +
        'averages by length, so one small heavily-loaded panel cannot skew a floor. Click a row to fly to ' +
        'that floor&rsquo;s worst element.</p>' +
        '<h4>One element at a time</h4>' +
        '<p>Select a panel or a beam and Properties shows what makes up its number — each load case, the ' +
        'factor applied, and self weight — with a bar comparing it to its floor&rsquo;s maximum and the ' +
        'building&rsquo;s. <b>Same load</b> selects everything carrying the same intensity, which is how you ' +
        'find a panel that was missed when a load was assigned.</p>' +
        '<h4>Where the total goes</h4>' +
        '<ul>' +
        '<li><b>What makes up the load</b> — every pattern in the chosen case with its factor, its total in ' +
        'kN and its share, so you can see at a glance whether finishes or occupancy dominate.</li>' +
        '<li><b>Structure self weight</b> — columns, braces and walls, listed separately because they carry ' +
        'load rather than receive an intensity, plus the whole-structure total.</li>' +
        '<li><b>Seismic weight (IS 1893:2016)</b> — storey by storey: full dead load, the storey&rsquo;s share ' +
        'of column and wall weight, and the counted part of the imposed load (¼ up to 3 kN/m², ½ above, ' +
        'Table 8), with the roof imposed load excluded per Cl 7.3.2. It is arithmetic on the modelled loads, ' +
        'so it matches ETABS only when everything the building carries is in the model.</li>' +
        '<li><b>Point loads</b> on joints are counted in the floor totals and listed in their own column.</li>' +
        '</ul>' +
        '<h4>What it is not</h4>' +
        '<p>This is a reading of the file, not an analysis. Nothing is redistributed onto beams, no member ' +
        'force is derived, and deflection is not shown — that comes from ETABS results, which an .e2k does ' +
        'not contain.</p>'
    },
    {
      id: 'rebar',
      title: 'Reinforcement and steel',
      keywords: 'rebar reinforcement bars steel bbs bar bending schedule cage links stirrups mesh cover lap wastage kg quantity',
      html:
        '<p>An ETABS model is not a detailing model, but it is not empty either. Every concrete section in the ' +
        'file carries a reinforcement <i>definition</i> — the bar pattern, one bar&rsquo;s area, the cover and the ' +
        'tie spacing. Structura draws columns from exactly that, and draws beams, slabs and walls from ' +
        'assumptions you control and can see.</p>' +
        '<ul>' +
        '<li><b>Columns</b> — pattern (R-3-2 and the like), bar diameter, cover and tie spacing read straight ' +
        'from the file. The section drawing names the pattern it used.</li>' +
        '<li><b>Beams</b> — a percentage of the section area for top and bottom steel, turned into a practical ' +
        'bar count, with stirrups at your spacing.</li>' +
        '<li><b>Slabs</b> — a mesh at your diameter and spacing, one-way or two-way read from the section name ' +
        '(<code>…WAYONE</code> / <code>…WAYBOTH</code>), on one or both faces.</li>' +
        '<li><b>Walls</b> — vertical and horizontal mesh at your diameter and spacing.</li>' +
        '</ul>' +
        '<h4>Detailed the way it is built</h4>' +
        '<ul>' +
        '<li>Links wrap <i>around</i> the main bars: cover is to the link, and the bar centre sits a link ' +
        'diameter and half a bar diameter inside it.</li>' +
        '<li>135° hooks with 10 d legs (75 mm minimum), cross-ties where a face carries more than two bars, ' +
        'and closer links over the confining zone at each member end — IS 13920.</li>' +
        '<li>Beams: half the top steel runs through, the rest sits over the supports and stops a quarter span ' +
        'in; bars that cannot fit in one row go into a second layer; beams deeper than 750 mm get side-face ' +
        'steel.</li>' +
        '<li>Cutting lengths are schedule lengths — centreline plus hooks, less 2 d per 90° bend and 3 d per ' +
        '135° hook — and laps come from the IS 456 development length for your steel and concrete grades ' +
        '(48 d for Fe500 in M25), not a flat 50 d.</li>' +
        '</ul>' +
        '<h4>Looking at the cage</h4>' +
        '<ul>' +
        '<li><b>Cutaway</b> turns the concrete translucent so the bars read like a site photograph; ' +
        '<b>bars only</b> leaves the cage alone in space.</li>' +
        '<li><b>Inspect selected</b> flies to a member and draws its cage and its cross-section.</li>' +
        '<li><b>Section cut</b> slices the model across the member so you see the bars in section in 3-D.</li>' +
        '<li><b>Hover any bar</b> for its diameter, length and weight; <b>explode the cage</b> pulls main bars ' +
        'and links apart to show how it goes together.</li>' +
        '<li>The cross-section is drawn to scale with real bar diameters, the link, the cover and the ' +
        'dimensions — the same numbers that drive the weights.</li>' +
        '</ul>' +
        '<h4>Steel quantities</h4>' +
        '<p>Weight is bar length × d²/162, plus laps (your lap factor over the stock length), wastage, and an ' +
        'allowance for chairs, spacers and binding wire — each shown as its own line so nothing hides. You get ' +
        'the total by diameter, by member type with kg/m³, by floor, and per element with the outliers flagged ' +
        'against the usual bands. The bar bending schedule groups identical bars into marks with shape, ' +
        'cutting length, number and weight.</p>' +
        '<p>Where bars have been drawn, the BOQ stops using the assumed kg/m³ rate and prices the measured ' +
        'steel instead — each row says which it is.</p>' +
        '<h4>Detailing rules it follows</h4>' +
        '<ul>' +
        '<li><b>Cover</b> is clear cover to the link, as IS 456 states it and as the file\u2019s COVER value means. ' +
        'The link wraps the bars; the bars sit a link diameter further in.</li>' +
        '<li><b>Hooks</b> are 135° with a 10 × diameter leg, minimum 75 mm — IS 13920 ductile detailing.</li>' +
        '<li><b>Confining zones</b> put links at half spacing (capped at 100 mm) over 2d from each beam face and ' +
        'over the larger of the depth or 450 mm at each column end.</li>' +
        '<li><b>Cross-ties</b> appear wherever the pattern puts more than two bars on a face.</li>' +
        '<li><b>Cutting lengths</b> are schedule lengths: centreline plus hooks, less 2d per 90° bend and 3d per ' +
        '135° hook.</li>' +
        '<li><b>Laps and anchorage</b> use the IS 456 development length — Ld = 0.87 f<sub>y</sub> φ / (4 × 1.6 ' +
        'τ<sub>bd</sub>), which is 48 diameters for Fe500 in M25 — so changing the grades changes the steel.</li>' +
        '</ul>' +
        '<h4>Detailing checks</h4>' +
        '<p>The panel screens what it drew against IS 456 and IS 13920: column steel between 0.8% and 6%, beam ' +
        'steel above the 0.85bd/f<sub>y</sub> minimum and under 4%, tie spacing against the least dimension, ' +
        '16 × bar and 300 mm, stirrups against 0.75d, and the clear gap between bars against the 25 mm the ' +
        'concrete needs. These check the detailing, never the capacity.</p>' +
        '<h4>What it is not</h4>' +
        '<p>Indicative detailing for visualising and estimating. It does not check capacity, it does not curtail ' +
        'bars to a bending-moment diagram, and it is not a substitute for a detailer or for ETABS design output.</p>'
    },
    {
      id: 'slice',
      title: 'Cutting into the model',
      keywords: 'slice section clip cut plane grid storey plan box explode',
      html:
        DIAGRAMS.slicing() +
        '<p>A dense frame hides its own interior. Clipping lets you step inside it.</p>' +
        '<ul>' +
        '<li><b>X / Y / Z sliders</b> — one plane per axis, each reversible.</li>' +
        '<li><b>Grid section</b> — pick Grid B and the model cuts on that grid and turns to face it.</li>' +
        '<li><b>Box clip</b> — six planes at once: only what is inside the box stays. The X / Y / Z sliders ' +
        'move the box, <b>Box size</b> grows or shrinks it, and <b>Box around selection</b> wraps it round ' +
        'whatever you picked. Use it for a lift core, a stair well, one bay, a transfer girder or a joint.</li>' +
        '<li><b>Plan slice</b> — one storey, viewed from above, like an ETABS plan.</li>' +
        '</ul>' +
        '<h4>Explode</h4>' +
        '<p>The storey explode slider fans the floors apart vertically; the type slider separates columns ' +
        'from beams from slabs. Both run on the graphics card, so they stay smooth on large models — and ' +
        'the animated version is the single most effective thing to show a client.</p>'
    },
    {
      id: 'quantities',
      title: 'Where the numbers come from',
      keywords: 'quantities bom boq volume concrete steel formwork rebar cost rate methodology',
      html:
        '<p>This is the part worth reading before you send a number to anyone.</p>' +
        DIAGRAMS.quantity() +
        '<h4>Measured from the model</h4>' +
        '<ul>' +
        '<li><b>Concrete volume</b> — analytic section area × member length, plus slab and wall area × ' +
        'thickness. Section area comes from the declared dimensions using the correct formula for the ' +
        'profile, not from the drawn mesh.</li>' +
        '<li><b>Structural steel mass</b> — section area × length × the unit weight stated in the file. ' +
        'If the file states no density, the mass is reported as <b>zero</b> and the gap is named. It is ' +
        'never assumed.</li>' +
        '<li><b>Formwork</b> — section perimeter × length for members, less the top face of beams, which ' +
        'is cast against the slab. Slab soffit area and both wall faces.</li>' +
        '</ul>' +
        '<h4>Estimated from your rates</h4>' +
        '<ul>' +
        '<li><b>Reinforcement</b> — an ETABS model contains none. Tonnage is concrete volume × a rate in ' +
        'kg/m³ that you set per element type. The defaults are placeholders.</li>' +
        '<li><b>Cost</b> — your rate card applied to those quantities, plus wastage and contingency. No ' +
        'price data ships with this tool.</li>' +
        '</ul>' +
        '<h4>Scope</h4>' +
        '<p>Every total states what it counted — whole model, visible only, current selection or a storey ' +
        'range. If you hide half the building, the takeoff says so.</p>'
    },
    {
      id: 'health',
      title: 'Model health checks',
      keywords: 'health check error duplicate orphan discontinuous column section quality',
      html:
        '<p>Eight checks run automatically on every model. They look for the modelling errors that are ' +
        'hardest to see in a plan view and most expensive to find late.</p>' +
        DIAGRAMS.health() +
        '<p>Every finding can be selected or isolated in one click, so you go straight to the geometry ' +
        'rather than hunting for it. A clean result means these eight checks passed — not that the model ' +
        'is correct.</p>'
    },
    {
      id: 'code',
      title: 'IS 1893 screening',
      keywords: 'code is1893 seismic irregularity setback reentrant soft storey torsion',
      html:
        '<p>Four of the IS 1893:2016 Table 5 and 6 irregularities can be screened from geometry alone, ' +
        'and are: <b>vertical geometric (setback)</b>, <b>re-entrant corner</b>, <b>stiffness / soft ' +
        'storey</b> and <b>in-plane discontinuity</b> of the lateral system.</p>' +
        '<p>Each result states its <b>basis</b> — exactly what was measured — and its <b>limits</b>. The ' +
        'soft-storey check in particular uses vertical-element cross-sectional area as a stand-in for ' +
        'lateral stiffness. That is a proxy and is labelled as one; real storey stiffness depends on ' +
        'height cubed, end fixity and cracked-section properties.</p>' +
        '<p><b>Torsional irregularity, mass irregularity and weak-storey cannot be screened from ' +
        'geometry</b> — they need analysis results or design capacities. The app lists them as not ' +
        'checkable rather than producing a number that looks authoritative and is not.</p>' +
        '<p class="cap">Screening flags shapes worth a second look. It is not a code compliance check and ' +
        'does not replace an engineer.</p>'
    },
    {
      id: 'export',
      title: 'Getting work out',
      keywords: 'export png pdf csv excel xlsx obj report snapshot share print',
      html:
        '<ul>' +
        '<li><b>PNG snapshot</b> — the current view at up to 4K, optionally on a transparent background, ' +
        'stamped with your mark.</li>' +
        '<li><b>PDF report</b> — a branded document: cover with headline figures, three rendered views, ' +
        'storey and section tables, the bill of materials and every health finding.</li>' +
        '<li><b>Excel BOQ</b> — a real workbook with a Rate Card sheet wired to the BOQ by live formulas. ' +
        'Change a rate in Excel and the totals move.</li>' +
        '<li><b>CSV</b> — elements, quantities, statistics, health findings and revision changes.</li>' +
        '<li><b>3-D model</b> — OBJ with materials, zipped, for Blender or Twinmotion. Only what is ' +
        'visible at the moment you export.</li>' +
        '</ul>' +
        '<p>Every save asks you to confirm before a file is written.</p>'
    },
    {
      id: 'audio',
      title: 'The ambient audio',
      keywords: 'audio music sound track ambient generative',
      html:
        '<p>Fifteen tracks across four families — calm pads, lo-fi keys, cinematic swells and generated ' +
        'nature textures. None of them is a recording: every note is synthesised live in your browser ' +
        'from oscillators and filtered noise, through a reverb built from generated noise. That is why ' +
        'the library costs nothing to download and never loops identically.</p>' +
        '<p>The mood and tempo sliders steer the generator live. Music starts automatically with the 360° ' +
        'spin if you leave that setting on, and stops when the spin stops — or whenever you press stop.</p>' +
        '<p>You can also add your own audio file for the session. It stays on your device.</p>'
    }
  ];

  /* ------------------------------------------------------------------ */
  /* FAQ                                                                 */
  /* ------------------------------------------------------------------ */

  var FAQ = [
    {
      q: 'Can it show deflection or member forces?',
      a: 'No, and it should not pretend to. Deflection, drift, moments and shears are analysis <i>results</i>: ' +
         'ETABS computes them and keeps them in its own result files. An .e2k is the model — geometry, ' +
         'sections, materials and the loads you assigned — so that is what Structura reports. What it can ' +
         'show is every load the model carries: per panel, per beam, per floor and for the building.'
    },
    {
      q: 'Where do the load numbers come from?',
      a: 'From the file itself: the SHELL OBJECT LOADS block gives each slab panel its area load in kN/m², ' +
         'the FRAME OBJECT LOADS block gives each beam its line load in kN/m, and the load patterns and ' +
         'combinations give the factors. Self weight, when switched on, is slab thickness × material ' +
         'density or beam section area × density. Nothing is assumed and nothing is redistributed — if a ' +
         'beam shows zero, no load is assigned to it in the model, usually because the slab spans onto it ' +
         'and ETABS transfers the load during analysis.'
    },
    {
      q: 'Why do columns and walls stay grey in the load map?',
      a: 'Because they have no assigned intensity to show. A column carries what the floors above hand it, ' +
         'which is an analysis result, not something written in the file. Colouring them would invent a ' +
         'number. They stay grey as context so you can still read the building.'
    },
    {
      q: 'Why will it not open my .EDB file?',
      a: 'The .EDB is ETABS’s own binary database. Its layout is proprietary and undocumented, so no ' +
         'browser — and no tool outside ETABS — can reliably rebuild geometry from it. Open the model in ' +
         'ETABS and use File → Export → ETABS Text File to write a .e2k, which takes about fifteen ' +
         'seconds. A .ebk is just a backup copy of a .EDB, so the same applies.'
    },
    {
      q: 'My file opens but says no geometry could be built. What now?',
      a: 'Open File & model → “What is in this file?”. It lists every block and record the parser saw, how many ' +
         'points, connectivity records and assignments it read, and names the most likely cause — usually a ' +
         'missing assignment table, or a record layout this build does not read yet. The Copy button puts the ' +
         'whole report on your clipboard; send it to whoever maintains the viewer and the gap can be closed ' +
         'quickly, because the report contains a sample line of every record type.'
    },
    {
      q: 'Why did it used to warn about PREFERENCE, RLLF and GRIDSYSTEM?',
      a: 'That was a bug, fixed in 1.2.0. An .e2k carries far more than geometry — design preferences, rebar ' +
         'libraries, load combinations, named sets — and none of it should be drawn. The parser now only ' +
         'mentions a record when it sits inside a block that could have held geometry, and it never reports ' +
         'one as an error.'
    },
    {
      q: 'Is my model uploaded anywhere?',
      a: 'No. The file is read by JavaScript running in your browser tab. Nothing is sent to a server, ' +
         'to Claude, or to anyone else. Exports are generated in the tab too.'
    },
    {
      q: 'How accurate are the concrete quantities?',
      a: 'They are exact for what the model declares. Volume is analytic section area × length, and the ' +
         'section area uses the proper formula for each profile — an I-section is computed from flange ' +
         'and web dimensions, not from a bounding box. What they cannot include is anything absent from ' +
         'the model: cover, haunches, drops the modeller left out, or architectural elements.'
    },
    {
      q: 'Why is my steel tonnage zero?',
      a: 'The material in your file states no unit weight. Rather than assume 78.5 kN/m³ and hand you a ' +
         'number that looks right, the app reports zero and names the material. Set the density in ETABS ' +
         'and re-export, and the tonnage appears.'
    },
    {
      q: 'Where does the reinforcement figure come from?',
      a: 'From you. An ETABS model has no reinforcement in it. The app multiplies concrete volume by a ' +
         'rate in kg/m³ that you set per element type, and the defaults are placeholders, not ' +
         'recommendations. Change them in Quantities → Rate card; the figure and the Excel workbook both ' +
         'follow.'
    },
    {
      q: 'Can I trust the soft-storey check?',
      a: 'Treat it as a prompt, not a verdict. It compares the cross-sectional area of columns and walls ' +
         'storey to storey, which correlates with stiffness but is not stiffness. Use it to decide which ' +
         'storeys deserve a proper look at storey shear against drift.'
    },
    {
      q: 'The model looks slow. What can I do?',
      a: 'Switch the quality preset to Draft, or turn off shadows and the ground plane in Display style. ' +
         'Very large models start in wireframe automatically. Hiding storeys you are not looking at helps ' +
         'more than anything else.'
    },
    {
      q: 'Why are some elements a different colour from what I expect?',
      a: 'Check which colour mode is active in the Colour panel. By type is the default, but by section or ' +
         'by grade will paint the same model completely differently — that is the point of them.'
    },
    {
      q: 'Can I compare two revisions?',
      a: 'Yes. Load the base model, then Compare revisions → load the second file. Modified sections show ' +
         'amber, removed elements red, and the change list is clickable so you can fly to each one. ' +
         'Elements are matched on geometry, not on name, because ETABS reassigns names freely between runs.'
    },
    {
      q: 'What happens to my settings when I close the tab?',
      a: 'Panel widths, theme, saved views, saved palettes, filter sets and your rate card are kept in ' +
         'this browser only. They are not sent anywhere and they do not follow you to another device.'
    },
    {
      q: 'Can I share this with a client?',
      a: 'Yes — but the page is private until it is shared. Use the Share menu on the artifact page to ' +
         'give someone access. For a one-off, the PDF report or a 4K PNG is usually the better thing to ' +
         'send.'
    },
    {
      q: 'Does it do analysis?',
      a: 'No, and it should not pretend to. It reads geometry and reports what is there. Analysis belongs ' +
         'in ETABS.'
    }
  ];

  /* ------------------------------------------------------------------ */
  /* Intent flows — "what do you want to do?"                            */
  /* ------------------------------------------------------------------ */

  var INTENTS = [
    {
      id: 'review',
      label: 'Check this model for problems',
      note: 'Runs the health checks and IS 1893 screening, and opens the findings',
      icon: '✓'
    },
    {
      id: 'quantities',
      label: 'Get quantities and a cost',
      note: 'Opens the takeoff, with the rate card ready to edit',
      icon: '∑'
    },
    {
      id: 'explore',
      label: 'Look around the model',
      note: 'Fits the view and turns on grids and storey markers',
      icon: '◱'
    },
    {
      id: 'present',
      label: 'Present it to someone',
      note: 'Hides the panels, starts the cinematic orbit and the music',
      icon: '▶'
    },
    {
      id: 'compare',
      label: 'Compare two revisions',
      note: 'Asks for the second file and shows what changed',
      icon: '⇄'
    },
    {
      id: 'export',
      label: 'Export something',
      note: 'Snapshot, PDF report, Excel BOQ, CSV or a 3-D model',
      icon: '↧'
    }
  ];

  /* ------------------------------------------------------------------ */
  /* Release notes                                                       */
  /* ------------------------------------------------------------------ */

  var RELEASES = [
    {
      version: '1.8.1',
      date: '2 October 2026',
      added: [
        'Slab and wall mesh steps up with the thickness — 8 mm in a 125 mm slab, 12 in 250, 20 over 400 — so a thick slab is no longer meshed like a thin one',
        'The panel says what was left out of the cage, so the tonnage is never read as covering more than it does'
      ],
      fixed: [
        'Steel members were being given a reinforcement cage: an ISMB beam or a UC column now carries none, which took 50 t of imaginary steel out of the braced-tower sample',
        'Beam bars picked up a development length at every interior joint, counting the anchorage twice over — on a 3.6 m span that was 43% too much steel. Anchorage is now added only where the beam actually stops',
        'Top steel over a shared support was counted by both beams; it is now counted once',
        'Links in the confining zone were placed at half the span spacing. IS 13920 asks for the lesser of d/4 and 8 bar diameters in a beam, and the least of a quarter of the column side, 6 diameters and 100 mm in a column',
        'A slab framed by beams is two-way, so its top steel is counted over the supports rather than as a full mat across the bay',
        'Slab bars were given a full lap at each support instead of the Ld/3 end allowance IS 456 Cl 26.2.3.3 asks for',
        'Concrete that was not detailed — steel members, or a type switched off in the panel — dropped out of the reinforcement cost instead of falling back to the assumed rate',
        'Three sample buildings removed on request: walls and openings, the staircase and the footings'
      ]
    },
    {
      version: '1.8.0',
      date: '2 October 2026',
      added: [
        'Detailing follows IS 456 and IS 13920: 135° hooks with 10d legs, cross-ties for inner bars, closer links in the confining zones at member ends',
        'Bar bending deductions — 2d per 90° bend and 3d per 135° hook — so cutting lengths are schedule lengths',
        'Laps and anchorage from the IS 456 development length for the steel and concrete grades, instead of a flat 50 × diameter',
        'Detailing checks against IS 456 / IS 13920: steel percentages, link spacing and bar congestion, per section',
        'Separate side cover for beams, and a concrete grade setting that drives the bond length',
        'Points that carry their own elevation are read, so sloping slabs, stair flights and sunshades come through',
        'Four more sample buildings: a G+20 flat-slab tower on a core, a stilt + 7 residential block, a 48 × 24 m industrial shed with pitched steel portals, and a hospital with a 600 mm transfer slab under an offset ward grid — seven in all',
        'Beam detailing the way it is built: half the top steel runs through and the rest sits over the supports, curtailed a quarter span in',
        'Side-face bars on beams deeper than 750 mm (IS 456 Cl 26.5.1.3)',
        'Bars that will not fit in one row go into a second layer with the clear gap the code asks for, instead of overlapping',
        'The bar schedule now draws each shape, with the code beside it'
      ],
      fixed: [
        'Links and stirrups were drawn on the same line as the main bars; they now wrap around them, as a cage does',
        'Slab mesh was offset from the storey plane, which is the slab top, so the top layer floated above the concrete',
        'Beam side cover used the top cover, pushing the outer bars too far in',
        'Circular columns fell back to a rectangular bar pattern; they now get a circular cage',
        'Beam top steel was counted at the support percentage along the whole span, which inflated the tonnage',
        'Slab mesh defaulted to 10 mm at 150 on both faces — heavier than normal practice; the default is now 8 mm',
        'Identical-looking bars with different roles (through bars and support bars) were merged into one schedule row'
      ]
    },
    {
      version: '1.7.0',
      date: '2 October 2026',
      added: [
        'Reinforcement: 3-D bar cages drawn from the file\u2019s own column bar patterns, and from editable percentages and spacings for beams, slabs and walls',
        'Cutaway, bars-only and thin display styles, bar thickness and an explode-the-cage slider',
        'Inspect selected — fly to a member with its cage, plus a to-scale cross-section drawing with bars, link, cover and dimensions',
        'Section cut across any member, and hover any bar for its diameter, length and weight',
        'Steel quantities: by diameter, by member type with kg/m\u00b3, by floor and per element, with ratio outliers flagged',
        'Bar bending schedule with marks, shapes, cutting lengths and weights — on screen, as CSV and as an Excel sheet',
        'Laps, wastage and chairs/spacers as separate, editable lines; steel grade from Fe415 to Fe550',
        'Measured steel replaces the assumed kg/m\u00b3 in the BOQ, with every row labelled measured or assumed',
        'A reinforcement page in the PDF report, and sample buildings that now carry real bar patterns'
      ],
      fixed: []
    },
    {
      version: '1.6.0',
      date: '24 September 2026',
      added: [
        'Seismic weight per storey to IS 1893:2016 Cl 7.3 — dead load, the storey share of column and wall weight, and the counted part of the imposed load',
        'Load pattern take-off: every pattern with its factor, total in kN and share of the building load',
        'Structure self weight for columns, braces and walls, listed beside the floor loads',
        'Point loads on joints are read and counted',
        'A third colour scale, Spread, that stretches the ramp between the lightest and heaviest member',
        '“Select unloaded” and a health check for floor panels carrying no assigned load',
        'Filter and search by load intensity, e.g. load > 10'
      ],
      fixed: [
        'The load map button now turns the map off again and restores the previous colouring'
      ]
    },
    {
      version: '1.5.0',
      date: '24 September 2026',
      added: [
        'Load intensity: colour every slab and beam by the load it carries, for any pattern or combination in the file',
        'Self weight from thickness/section and material density, switchable',
        'Loads by floor panel — maxima, area- and length-weighted averages, load per floor in kN and building totals',
        'Per-element breakdown by load case, with bars against the floor and building maxima, and “Same load” selection',
        'Each storey&rsquo;s maximum printed beside the model, a colour scale baked into PNG exports, a load page in the PDF report, two load sheets in the Excel workbook and load CSVs'
      ],
      fixed: []
    },
    {
      version: '1.4.1',
      date: '21 September 2026',
      added: [
        'The explode button is now a toggle — press it again to fold the storeys back together'
      ],
      fixed: [
        'Slab, beam and column tops flickered where they meet at the storey level (z-fighting); every shared face now has a clear winner',
        'Reset explode (E) now animates back smoothly and resets the radial and by-type spread too',
        'Dragging an explode slider during an animation no longer fights the animation'
      ]
    },
    {
      version: '1.4.0',
      date: '21 September 2026',
      added: [
        'Insertion-point offsets (OFFSETXI / YI / ZI …) — columns sit flush with beam and wall faces exactly as in ETABS',
        'Curved and multilinear beams from LINE CURVE DATA are drawn along their curve, and their length and volume follow it'
      ],
      fixed: [
        'Columns drawn twice: ETABS writes the section and the offsets as two records for the same member; they are now read as one',
        'Model health no longer reports offset columns as discontinuous — connectivity uses the analytical nodes'
      ]
    },
    {
      version: '1.3.0',
      date: '21 September 2026',
      added: [
        'Beams honour the ETABS insertion (cardinal) point; by default the beam top sits on the storey line',
        'New health check: overlapping columns — two columns in one storey that clash without being exact copies'
      ],
      fixed: [
        'Slabs were drawn centred on the storey, so they sat half-way down the beams; slab top now equals beam top',
        'A label assigned twice to the same storey drew two members; the later record now wins, as in ETABS',
        'Clearing any clipping with shadows on could blank the 3-D view'
      ]
    },
    {
      version: '1.2.1',
      date: '21 September 2026',
      added: [
        'Box clip controls: Box size, Box around selection and Recentre box',
        'Slider drags (clip, box, explode) can now be undone — one step per drag'
      ],
      fixed: [
        'Box clip opened on the far top corner of the model; it now starts centred and half the model in size',
        'Undo and redo restored the clipping settings but not the cut itself; the picture now always matches',
        'Grid sections and plan slices are now remembered by undo and by the reload warning',
        'A plan slice of the lowest storey showed nothing; it now shows a 1 m band',
        'Choosing “— pick a storey —” left the view in plan mode; it now leaves the slice properly',
        'Section assignments written before their connectivity could land on the wrong element type',
        'The top bar overflowed the screen on phones'
      ]
    },
    {
      version: '1.2.0',
      date: '21 September 2026',
      added: [
        'A reload button that re-reads the file and discards every change, after asking you to confirm',
        'Support for the newer ETABS record layout — SECTION, SHELL, FRAME and JOINT records, and t3/t2 section dimensions',
        '“What is in this file?” — a diagnostic listing every block and record found, why anything was skipped, and a copy button'
      ],
      fixed: [
        'Metadata records (preferences, rebar libraries, load combinations, grid systems) are no longer reported as errors',
        'A file that produces no geometry now explains why, instead of showing a red banner naming record types',
        'Grids and storey markers no longer vanish when a second model is opened'
      ]
    },
    {
      version: '1.1.0',
      date: '21 September 2026',
      added: [
        'Resizable panels with drag handles, live 3-D re-measure and remembered widths',
        'Undo and redo across camera, visibility, isolation, colour, clipping and explode',
        'Toolbar controls for isolate, hide, show all, invert, home, fullscreen and presentation mode',
        'Tooltips on every control saying what it does, with its shortcut',
        'Right-click action menu on any element, and a "what next?" prompt',
        'This illustrated guide and FAQ',
        'Element search, a multi-criteria filter builder and saved filter sets',
        'Reinforcement estimation, an editable rate card, wastage, contingency and cost per m²',
        'Excel BOQ workbook with live formulas wired to a Rate Card sheet',
        'IS 1893:2016 geometry screening — setback, re-entrant corner, soft storey, in-plane discontinuity',
        'Quality presets and a live performance readout',
        'Sample .e2k files can be downloaded'
      ],
      fixed: [
        'The 3-D view no longer leaves a dead band when a panel opens',
        'Storey and grid labels hold a constant screen size instead of growing on zoom, and thin out when crowded',
        'The data drawer no longer hides tabs off the left edge'
      ]
    },
    {
      version: '1.0.0',
      date: '21 September 2026',
      added: [
        'ETABS .e2k / .$et, SAP2000 .s2k, CSV and XLSX parsing, with a guided export path for .EDB',
        '3-D viewer with true extruded sections, wireframe, x-ray and technical styles',
        'Colour by type, grade, section, storey, height or length',
        'Clipping, explode, measurement, grids, dimensions and local axes',
        'Quantities, statistics, seven model health checks and revision comparison',
        'PNG, PDF, CSV and OBJ export; fifteen generated ambient tracks'
      ],
      fixed: []
    }
  ];

  function search(term) {
    var q = String(term || '').toLowerCase().trim();
    if (!q) return { sections: SECTIONS, faq: FAQ };
    return {
      sections: SECTIONS.filter(function (s) {
        return (s.title + ' ' + s.keywords + ' ' + s.html).toLowerCase().indexOf(q) >= 0;
      }),
      faq: FAQ.filter(function (f) {
        return (f.q + ' ' + f.a).toLowerCase().indexOf(q) >= 0;
      })
    };
  }

  global.ETABSGuide = {
    SECTIONS: SECTIONS,
    FAQ: FAQ,
    INTENTS: INTENTS,
    RELEASES: RELEASES,
    DIAGRAMS: DIAGRAMS,
    search: search
  };
})(window);
