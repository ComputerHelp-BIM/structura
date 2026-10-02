/**
 * viewer.js — WebGL structural model viewer.
 * =================================================================
 * Architecture notes (the decisions that matter):
 *
 * 1. ONE merged geometry per chunk, not one mesh per element. A 200 000
 *    member model cannot survive 200 000 draw calls, so members are welded
 *    into chunks of ~25 000 and each vertex carries the element id it came
 *    from in an `aIndex` attribute.
 *
 * 2. A lookup texture drives appearance. Element colour and state live in
 *    an RGBA DataTexture indexed by `aIndex`. Recolouring the whole model,
 *    hiding a storey, isolating the core or selecting a member is a texture
 *    write — no geometry is rebuilt, so every control is instant.
 *
 * 3. Explode runs in the vertex shader. Storey, radial and per-type offsets
 *    are uniforms, so the explode slider animates at frame rate on models
 *    where a CPU rebuild would stall for seconds.
 *
 * 4. Picking is a GPU pass. A one-pixel render with ids encoded as colour
 *    picks the surface the user actually sees — correct under clipping,
 *    explode and section extrusion alike.
 *
 * 5. Built-in materials are patched with onBeforeCompile rather than
 *    replaced, so lighting, fog, shadows and clipping planes keep working.
 *
 * Namespace: window.ETABSViewer
 */
(function (global) {
  'use strict';

  var THREE = global.THREE;

  /* Element appearance states, encoded in the lookup texture's alpha. */
  var ST = { HIDDEN: 0, GHOST: 64, VISIBLE: 128, SELECTED: 191, HOVER: 255 };

  /* Ordered so the type index can drive per-type explode offsets. */
  var TYPE_ORDER = ['Column', 'Beam', 'Brace', 'Slab', 'Wall', 'Ramp', 'Joint', 'Other'];

  var CHUNK_SIZE = 25000;          // elements welded into one geometry
  var SIMPLIFY_ABOVE = 30000;      // members: box proxies past this count
  var LINES_ONLY_ABOVE = 140000;   // auto performance mode threshold

  function typeIndex(t) {
    var i = TYPE_ORDER.indexOf(t);
    if (i >= 0) return i;
    if (t === 'Fixed' || t === 'Pinned' || t === 'Roller') return 6;
    return 7;
  }

  /* ================================================================== */
  /* Shader injection                                                    */
  /* ================================================================== */

  var EXPLODE_UNIFORMS = [
    'uniform sampler2D uLut;',
    'uniform vec2 uLutSize;',
    'uniform float uExplodeStorey;',
    'uniform float uExplodeRadial;',
    'uniform vec3 uTypeOffset[8];',
    'uniform vec3 uModelCenter;',
    'attribute float aIndex;',
    'attribute float aStorey;',
    'attribute float aType;',
    'attribute vec3 aCentroid;',
    'varying float vIndex;',
    'varying vec3 vLutColor;',
    'varying float vState;'
  ].join('\n');

  /*
   * Draw-order nudge. Slab tops, beam tops and column tops all sit exactly on
   * the storey plane, so the depth buffer cannot decide which face is in
   * front and they flicker ("z-fighting") as the camera moves. Lift slabs
   * and ramps 3 mm and beams 1.5 mm — invisible at any zoom, but enough to
   * give every shared face a clear winner (slab over beam over column).
   * Display only: geometry, quantities and measurements are untouched.
   */
  var LAYER_NUDGE =
    'transformed.z += ((aType > 2.5 && aType < 3.5) || (aType > 4.5 && aType < 5.5)) ? 0.003 ' +
    ': ((aType > 0.5 && aType < 2.5) ? 0.0015 : 0.0);';

  var EXPLODE_BODY = [
    'vIndex = aIndex;',
    'vec2 lutUv = (vec2(mod(aIndex, uLutSize.x), floor(aIndex / uLutSize.x)) + 0.5) / uLutSize;',
    'vec4 lutTexel = texture2D(uLut, lutUv);',
    'vLutColor = lutTexel.rgb;',
    'vState = lutTexel.a;',
    'vec3 radial = aCentroid - uModelCenter; radial.z = 0.0;',
    'transformed += vec3(0.0, 0.0, aStorey * uExplodeStorey);',
    'transformed += radial * uExplodeRadial;',
    'transformed += uTypeOffset[int(aType)];',
    LAYER_NUDGE
  ].join('\n');

  var FRAG_UNIFORMS = [
    'uniform float uPass;',
    'uniform float uGhostOpacity;',
    'uniform vec3 uSelectColor;',
    'uniform vec3 uHoverColor;',
    'uniform float uTint;',
    'varying float vIndex;',
    'varying vec3 vLutColor;',
    'varying float vState;'
  ].join('\n');

  var FRAG_BODY = [
    'if (vState < 0.12) discard;',
    'if (uPass < 0.5 && vState < 0.37) discard;',
    'if (uPass > 0.5 && uPass < 1.5 && vState >= 0.37) discard;',
    'vec3 lutRgb = vLutColor;',
    'float outAlpha = 1.0;',
    'if (vState < 0.37) { outAlpha = uGhostOpacity; }',
    'else if (uPass > 1.5) { outAlpha = uGhostOpacity; }',
    'if (vState > 0.62 && vState < 0.87) { lutRgb = mix(lutRgb, uSelectColor, 0.8); outAlpha = 1.0; }',
    'else if (vState >= 0.87) { lutRgb = mix(lutRgb, uHoverColor, 0.6); outAlpha = 1.0; }',
    // The lookup texture holds authored sRGB values; the renderer encodes to
    // sRGB on output, so decode here or every colour comes out washed out.
    'lutRgb = pow(lutRgb, vec3(2.2));',
    'diffuseColor.rgb *= mix(vec3(1.0), lutRgb, uTint);',
    'diffuseColor.a *= outAlpha;'
  ].join('\n');

  /** Shared uniform bag — one object, referenced by every patched material. */
  function makeUniforms(lut, lutSize, center) {
    return {
      uLut: { value: lut },
      uLutSize: { value: new THREE.Vector2(lutSize[0], lutSize[1]) },
      uExplodeStorey: { value: 0 },
      uExplodeRadial: { value: 0 },
      uTypeOffset: { value: makeTypeOffsets() },
      uModelCenter: { value: new THREE.Vector3(center[0], center[1], center[2]) },
      uPass: { value: 0 },
      uGhostOpacity: { value: 0.12 },
      uSelectColor: { value: new THREE.Color(0xffc247) },
      uHoverColor: { value: new THREE.Color(0xffffff) },
      uTint: { value: 1 }
    };
  }

  function makeTypeOffsets() {
    var arr = [];
    for (var i = 0; i < 8; i++) arr.push(new THREE.Vector3());
    return arr;
  }

  function patchMaterial(material, uniforms, isLine) {
    material.onBeforeCompile = function (shader) {
      Object.keys(uniforms).forEach(function (k) { shader.uniforms[k] = uniforms[k]; });
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', EXPLODE_UNIFORMS + '\nvoid main() {')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + EXPLODE_BODY);
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', FRAG_UNIFORMS + '\nvoid main() {')
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_BODY);
      if (isLine) {
        // Line materials have no <color_fragment> chunk in every build.
        if (shader.fragmentShader.indexOf('vLutColor') < 0) {
          shader.fragmentShader = shader.fragmentShader
            .replace('void main() {', FRAG_UNIFORMS + '\nvoid main() {')
            .replace('#include <logdepthbuf_fragment>', '#include <logdepthbuf_fragment>\n' + FRAG_BODY);
        }
      }
      material.userData.shader = shader;
    };
    material.customProgramCacheKey = function () { return 'etabs-lut-' + (isLine ? 'line' : 'mesh'); };
    return material;
  }

  var PICK_VERT = [
    '#include <common>',
    '#include <clipping_planes_pars_vertex>',
    'uniform sampler2D uLut;',
    'uniform vec2 uLutSize;',
    'uniform float uExplodeStorey;',
    'uniform float uExplodeRadial;',
    'uniform vec3 uTypeOffset[8];',
    'uniform vec3 uModelCenter;',
    'attribute float aIndex;',
    'attribute float aStorey;',
    'attribute float aType;',
    'attribute vec3 aCentroid;',
    'varying float vIndex;',
    'varying float vState;',
    'void main() {',
    '  vIndex = aIndex;',
    '  vec2 lutUv = (vec2(mod(aIndex, uLutSize.x), floor(aIndex / uLutSize.x)) + 0.5) / uLutSize;',
    '  vState = texture2D(uLut, lutUv).a;',
    '  vec3 transformed = position;',
    '  vec3 radial = aCentroid - uModelCenter; radial.z = 0.0;',
    '  transformed += vec3(0.0, 0.0, aStorey * uExplodeStorey);',
    '  transformed += radial * uExplodeRadial;',
    '  transformed += uTypeOffset[int(aType)];',
    '  ' + LAYER_NUDGE,
    '  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);',
    '  gl_Position = projectionMatrix * mvPosition;',
    '  #include <clipping_planes_vertex>',
    '}'
  ].join('\n');

  var PICK_FRAG = [
    '#include <common>',
    '#include <clipping_planes_pars_fragment>',
    'varying float vIndex;',
    'varying float vState;',
    'void main() {',
    '  #include <clipping_planes_fragment>',
    '  if (vState < 0.37) discard;',
    '  float id = vIndex + 1.0;',
    '  float r = mod(id, 256.0);',
    '  float g = mod(floor(id / 256.0), 256.0);',
    '  float b = mod(floor(id / 65536.0), 256.0);',
    '  gl_FragColor = vec4(r / 255.0, g / 255.0, b / 255.0, 1.0);',
    '}'
  ].join('\n');

  /* ================================================================== */
  /* Geometry construction                                               */
  /* ================================================================== */

  /**
   * Accumulates vertices for one chunk, then hands back a BufferGeometry.
   * Plain arrays then a single typed-array copy beats growing typed arrays.
   */
  function ChunkBuilder() {
    this.pos = []; this.nrm = []; this.idx = [];
    this.aIndex = []; this.aStorey = []; this.aType = []; this.aCentroid = [];
    this.count = 0;
  }

  ChunkBuilder.prototype.vertex = function (x, y, z, nx, ny, nz, id, storey, type, cx, cy, cz) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.aIndex.push(id);
    this.aStorey.push(storey);
    this.aType.push(type);
    this.aCentroid.push(cx, cy, cz);
    return this.count++;
  };

  ChunkBuilder.prototype.tri = function (a, b, c) { this.idx.push(a, b, c); };

  ChunkBuilder.prototype.geometry = function () {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aIndex', new THREE.Float32BufferAttribute(this.aIndex, 1));
    g.setAttribute('aStorey', new THREE.Float32BufferAttribute(this.aStorey, 1));
    g.setAttribute('aType', new THREE.Float32BufferAttribute(this.aType, 1));
    g.setAttribute('aCentroid', new THREE.Float32BufferAttribute(this.aCentroid, 3));
    g.setIndex(this.count > 65535
      ? new THREE.Uint32BufferAttribute(this.idx, 1)
      : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  };

  function LineBuilder() {
    this.pos = []; this.aIndex = []; this.aStorey = []; this.aType = []; this.aCentroid = [];
  }
  LineBuilder.prototype.segment = function (a, b, id, storey, type, c) {
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    this.aIndex.push(id, id);
    this.aStorey.push(storey, storey);
    this.aType.push(type, type);
    this.aCentroid.push(c[0], c[1], c[2], c[0], c[1], c[2]);
  };
  LineBuilder.prototype.geometry = function () {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aIndex', new THREE.Float32BufferAttribute(this.aIndex, 1));
    g.setAttribute('aStorey', new THREE.Float32BufferAttribute(this.aStorey, 1));
    g.setAttribute('aType', new THREE.Float32BufferAttribute(this.aType, 1));
    g.setAttribute('aCentroid', new THREE.Float32BufferAttribute(this.aCentroid, 3));
    g.computeBoundingSphere();
    return g;
  };

  /** Orthonormal frame for a member, following the CSI local-axis rules. */
  function localAxes(a, b, angDeg) {
    var dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    var e1 = [dx / len, dy / len, dz / len];
    var e2, e3;
    var horiz = Math.sqrt(e1[0] * e1[0] + e1[1] * e1[1]);

    if (horiz < 1e-6) {
      // Vertical member: local 2 along global +X, local 3 along global +Y.
      e2 = [1, 0, 0];
      e3 = [0, 1, 0];
      if (e1[2] < 0) { e3 = [0, -1, 0]; }
    } else {
      // Local 2 is the upward direction in the vertical plane of the member.
      var up = [0, 0, 1];
      var d = e1[2];
      e2 = [up[0] - d * e1[0], up[1] - d * e1[1], up[2] - d * e1[2]];
      var n2 = Math.sqrt(e2[0] * e2[0] + e2[1] * e2[1] + e2[2] * e2[2]) || 1;
      e2 = [e2[0] / n2, e2[1] / n2, e2[2] / n2];
      e3 = cross(e1, e2);
    }

    if (angDeg) {
      var r = angDeg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
      var n2b = [e2[0] * c + e3[0] * s, e2[1] * c + e3[1] * s, e2[2] * c + e3[2] * s];
      var n3b = [-e2[0] * s + e3[0] * c, -e2[1] * s + e3[1] * c, -e2[2] * s + e3[2] * c];
      e2 = n2b; e3 = n3b;
    }
    return { e1: e1, e2: e2, e3: e3, len: len };
  }

  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function normalize(v) {
    var n = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
    return [v[0] / n, v[1] / n, v[2] / n];
  }

  /**
   * Sweep a closed profile along a member.
   * Profile coordinates: u → local 3 (width), v → local 2 (depth).
   */
  /**
   * CSI cardinal (insertion) point → how far to slide the profile so that
   * point lies on the analytical line. Profile u runs along local 3, v along
   * local 2 (up for beams). 1–3 bottom, 4–6 middle, 7–9 top; left/centre/right
   * across local 3; 10 centroid, 11 shear centre (treated as centroid).
   */
  var DEFAULT_CARDINAL = { Beam: 8 };   // ETABS draws beams top-of-concrete at the storey
  function cardinalShift(outline, cardinal) {
    var cp = cardinal || 10;
    if (cp < 1 || cp > 9) return [0, 0];
    var uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (var i = 0; i < outline.length; i++) {
      var p = outline[i];
      if (p[0] < uMin) uMin = p[0]; if (p[0] > uMax) uMax = p[0];
      if (p[1] < vMin) vMin = p[1]; if (p[1] > vMax) vMax = p[1];
    }
    var col = (cp - 1) % 3, row = Math.floor((cp - 1) / 3);    // 0 left/bottom … 2 right/top
    var uRef = col === 0 ? uMin : col === 1 ? (uMin + uMax) / 2 : uMax;
    var vRef = row === 0 ? vMin : row === 1 ? (vMin + vMax) / 2 : vMax;
    return [-uRef, -vRef];
  }

  function extrudeFrame(cb, el, outline, caps) {
    var ax = localAxes(el.a, el.b, el.ang);
    var e2 = ax.e2, e3 = ax.e3, e1 = ax.e1;
    var cardinal = el.cardinal || DEFAULT_CARDINAL[el.type] || 10;
    var sh = cardinalShift(outline, cardinal);
    if (sh[0] || sh[1]) {
      outline = outline.map(function (p) { return [p[0] + sh[0], p[1] + sh[1]]; });
    }
    var id = el.id, st = el.storeyF, ty = el.typeF;
    var cx = (el.a[0] + el.b[0]) / 2, cy = (el.a[1] + el.b[1]) / 2, cz = (el.a[2] + el.b[2]) / 2;
    var n = outline.length, i;

    function at(end, u, v) {
      var o = end ? el.b : el.a;
      return [
        o[0] + e3[0] * u + e2[0] * v,
        o[1] + e3[1] * u + e2[1] * v,
        o[2] + e3[2] * u + e2[2] * v
      ];
    }

    // Side walls, flat-shaded (each quad owns its vertices and normal).
    for (i = 0; i < n; i++) {
      var p0 = outline[i], p1 = outline[(i + 1) % n];
      var A = at(false, p0[0], p0[1]);
      var B = at(false, p1[0], p1[1]);
      var C = at(true, p1[0], p1[1]);
      var D = at(true, p0[0], p0[1]);
      var edge = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
      var nrm = normalize(cross(edge, e1));
      var v0 = cb.vertex(A[0], A[1], A[2], nrm[0], nrm[1], nrm[2], id, st, ty, cx, cy, cz);
      var v1 = cb.vertex(B[0], B[1], B[2], nrm[0], nrm[1], nrm[2], id, st, ty, cx, cy, cz);
      var v2 = cb.vertex(C[0], C[1], C[2], nrm[0], nrm[1], nrm[2], id, st, ty, cx, cy, cz);
      var v3 = cb.vertex(D[0], D[1], D[2], nrm[0], nrm[1], nrm[2], id, st, ty, cx, cy, cz);
      cb.tri(v0, v1, v2); cb.tri(v0, v2, v3);
    }

    if (!caps) return;
    var tris = global.ETABSSections.triangulate(outline);
    if (!tris.length) return;
    [false, true].forEach(function (end) {
      var sign = end ? 1 : -1;
      var nrm = [e1[0] * sign, e1[1] * sign, e1[2] * sign];
      var base = [];
      for (var k = 0; k < n; k++) {
        var P = at(end, outline[k][0], outline[k][1]);
        base.push(cb.vertex(P[0], P[1], P[2], nrm[0], nrm[1], nrm[2], id, st, ty, cx, cy, cz));
      }
      for (var t = 0; t < tris.length; t += 3) {
        if (end) cb.tri(base[tris[t]], base[tris[t + 1]], base[tris[t + 2]]);
        else cb.tri(base[tris[t + 2]], base[tris[t + 1]], base[tris[t]]);
      }
    });
  }

  /** Build a slab/wall panel as a solid plate of its real thickness. */
  function extrudeArea(cb, el) {
    var pts = el.pts, n = pts.length;
    if (n < 3) return;
    var id = el.id, st = el.storeyF, ty = el.typeF;
    var nrm = planeNormal(pts);
    var t = Math.max(el.thickness || 0.1, 0.02);
    // Floor-like plates (slabs, decks, ramps) hang below the storey plane so
    // slab top = beam top = storey level, as ETABS draws them. Walls and other
    // steep panels stay centred on their plane.
    var floorLike = el.type !== 'Wall' && Math.abs(nrm[2]) > 0.7;
    var above = floorLike ? (nrm[2] > 0 ? 0 : t) : t / 2;   // extent along +nrm
    var below = t - above;                                 // extent along −nrm
    var cx = 0, cy = 0, cz = 0, i;
    for (i = 0; i < n; i++) { cx += pts[i][0]; cy += pts[i][1]; cz += pts[i][2]; }
    cx /= n; cy /= n; cz /= n;

    var top = [], bot = [];
    for (i = 0; i < n; i++) {
      top.push([pts[i][0] + nrm[0] * above, pts[i][1] + nrm[1] * above, pts[i][2] + nrm[2] * above]);
      bot.push([pts[i][0] - nrm[0] * below, pts[i][1] - nrm[1] * below, pts[i][2] - nrm[2] * below]);
    }

    var flat = projectToPlane(pts, nrm);
    var tris = global.ETABSSections.triangulate(flat);
    if (!tris.length) {
      tris = [];
      for (i = 1; i < n - 1; i++) tris.push(0, i, i + 1);
    }

    function face(ring, normal, flip) {
      var base = [];
      for (var k = 0; k < n; k++) {
        base.push(cb.vertex(ring[k][0], ring[k][1], ring[k][2],
          normal[0], normal[1], normal[2], id, st, ty, cx, cy, cz));
      }
      for (var q = 0; q < tris.length; q += 3) {
        if (flip) cb.tri(base[tris[q + 2]], base[tris[q + 1]], base[tris[q]]);
        else cb.tri(base[tris[q]], base[tris[q + 1]], base[tris[q + 2]]);
      }
    }
    face(top, nrm, false);
    face(bot, [-nrm[0], -nrm[1], -nrm[2]], true);

    for (i = 0; i < n; i++) {
      var j = (i + 1) % n;
      var A = top[i], B = top[j], C = bot[j], D = bot[i];
      var edge = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
      var sn = normalize(cross(edge, nrm));
      var v0 = cb.vertex(A[0], A[1], A[2], sn[0], sn[1], sn[2], id, st, ty, cx, cy, cz);
      var v1 = cb.vertex(B[0], B[1], B[2], sn[0], sn[1], sn[2], id, st, ty, cx, cy, cz);
      var v2 = cb.vertex(C[0], C[1], C[2], sn[0], sn[1], sn[2], id, st, ty, cx, cy, cz);
      var v3 = cb.vertex(D[0], D[1], D[2], sn[0], sn[1], sn[2], id, st, ty, cx, cy, cz);
      cb.tri(v0, v1, v2); cb.tri(v0, v2, v3);
    }
  }

  function planeNormal(pts) {
    var nx = 0, ny = 0, nz = 0, n = pts.length;
    for (var i = 0; i < n; i++) {
      var a = pts[i], b = pts[(i + 1) % n];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-9) return [0, 0, 1];
    return [nx / len, ny / len, nz / len];
  }

  function projectToPlane(pts, nrm) {
    var ref = Math.abs(nrm[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    var u = normalize(cross(ref, nrm));
    var v = cross(nrm, u);
    return pts.map(function (p) {
      return [p[0] * u[0] + p[1] * u[1] + p[2] * u[2], p[0] * v[0] + p[1] * v[1] + p[2] * v[2]];
    });
  }

  /** Small polyhedra used for joints and supports. */
  function addGlyph(cb, el, kind, size) {
    var p = el.p, id = el.id, st = el.storeyF, ty = el.typeF;
    var s = size;
    var verts, faces;
    if (kind === 'Fixed') {
      verts = [
        [-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s],
        [-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s]
      ];
      faces = [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1],
               [1, 5, 6], [1, 6, 2], [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0]];
    } else if (kind === 'Pinned' || kind === 'Roller') {
      verts = [[0, 0, s], [-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s]];
      faces = [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1], [1, 3, 2], [1, 4, 3]];
    } else {
      verts = [[s, 0, 0], [-s, 0, 0], [0, s, 0], [0, -s, 0], [0, 0, s], [0, 0, -s]];
      faces = [[4, 0, 2], [4, 2, 1], [4, 1, 3], [4, 3, 0],
               [5, 2, 0], [5, 1, 2], [5, 3, 1], [5, 0, 3]];
    }
    faces.forEach(function (fc) {
      var A = verts[fc[0]], B = verts[fc[1]], C = verts[fc[2]];
      var nrm = normalize(cross(
        [B[0] - A[0], B[1] - A[1], B[2] - A[2]],
        [C[0] - A[0], C[1] - A[1], C[2] - A[2]]
      ));
      var ids = [A, B, C].map(function (V) {
        return cb.vertex(p[0] + V[0], p[1] + V[1], p[2] + V[2],
          nrm[0], nrm[1], nrm[2], id, st, ty, p[0], p[1], p[2]);
      });
      cb.tri(ids[0], ids[1], ids[2]);
    });
  }

  /* ================================================================== */
  /* Viewer                                                              */
  /* ================================================================== */

  function Viewer(container, opts) {
    opts = opts || {};
    this.container = container;
    this.listeners = {};
    this.model = null;
    this.chunks = [];
    this.lineChunks = [];
    this.selection = [];
    this.hovered = -1;
    this.states = null;
    this.colors = null;
    this.renderStyle = 'solid';
    this.needsRender = true;
    this.quality = { shadows: true, ao: true, ground: true };
    this.clipPlanes = [];
    this.dispose_ = [];

    var w = container.clientWidth || 800, h = container.clientHeight || 600;

    // Logarithmic depth keeps depth precision even across a whole campus
    // seen from far away, so nearly-coplanar faces never flicker.
    this.renderer = new THREE.WebGLRenderer({
      antialias: true, alpha: false, powerPreference: 'high-performance',
      logarithmicDepthBuffer: true
    });
    this.renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.renderer.localClippingEnabled = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(this.renderer.domElement);
    // The canvas is sized by CSS and its drawing buffer by setSize(w, h, false).
    // Letting setSize own the CSS size means any resize that skips the style
    // update leaves the element at its old width — which is what put a dead
    // band of canvas under the data panel.
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';

    this.scene = new THREE.Scene();
    this.modelRoot = new THREE.Group();
    this.overlayRoot = new THREE.Group();
    this.scene.add(this.modelRoot);
    this.scene.add(this.overlayRoot);

    // Z-up matches every structural convention; three.js defaults to Y-up.
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 20000);
    this.camera.up.set(0, 0, 1);
    this.orthoCamera = new THREE.OrthographicCamera(-10, 10, 10, -10, -10000, 20000);
    this.orthoCamera.up.set(0, 0, 1);
    this.useOrtho = false;

    this.target = new THREE.Vector3(0, 0, 0);
    this.spherical = { radius: 40, theta: Math.PI * 0.25, phi: Math.PI * 0.35 };

    this.setupLights();
    this.setupPicking();
    this.bindInput();

    var self = this;
    this.resizeObserver = new ResizeObserver(function () { self.resize(); });
    this.resizeObserver.observe(container);

    this.turntable = { on: false, speed: 0.35, cinematic: false, t: 0 };
    this.walk = { on: false, keys: {}, pos: new THREE.Vector3(), yaw: 0, pitch: 0, speed: 4 };
    this.explode = { storey: 0, radial: 0, type: 0 };
    this.viewHistory = [];
    this.viewFuture = [];

    this.clock = new THREE.Clock();
    this.fps = 0;
    this.loop();
  }

  Viewer.prototype.on = function (evt, fn) {
    (this.listeners[evt] = this.listeners[evt] || []).push(fn);
    return this;
  };
  Viewer.prototype.emit = function (evt, data) {
    (this.listeners[evt] || []).forEach(function (fn) { fn(data); });
  };

  /* ---- Lights & environment ---------------------------------------- */

  Viewer.prototype.setupLights = function () {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.45);
    this.sun = new THREE.DirectionalLight(0xffffff, 0.95);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0008;
    this.fill = new THREE.DirectionalLight(0xffffff, 0.18);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.18);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.fill, this.ambient);

    var groundGeo = new THREE.PlaneGeometry(1, 1);
    this.ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({
      color: 0xdfe4e8, roughness: 0.92, metalness: 0.0
    }));
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
  };

  var ENVIRONMENTS = {
    studio:     { bg: 0xeef1f4, ground: 0xdfe4e8, hemiSky: 0xffffff, hemiGround: 0xc8ccd2,
                  sun: 0xffffff, sunI: 0.9, ambI: 0.45, fog: 0, ghost: 0.10 },
    night:      { bg: 0x11161b, ground: 0x171d24, hemiSky: 0x5b7fa6, hemiGround: 0x0b0e12,
                  sun: 0xbcd4f0, sunI: 0.75, ambI: 0.22, fog: 0.0016, ghost: 0.14 },
    blueprint:  { bg: 0x0b2a4a, ground: 0x0a2440, hemiSky: 0x9fd6ff, hemiGround: 0x06182c,
                  sun: 0xd8f0ff, sunI: 0.55, ambI: 0.55, fog: 0.0012, ghost: 0.18 },
    sunset:     { bg: 0xf3c9a0, ground: 0xc9a684, hemiSky: 0xffd9a8, hemiGround: 0x6b4a33,
                  sun: 0xffb36b, sunI: 1.25, ambI: 0.3, fog: 0.0009, ghost: 0.12 },
    site:       { bg: 0xb9b3a6, ground: 0x9c9384, hemiSky: 0xe8e2d4, hemiGround: 0x6d665a,
                  sun: 0xfff2d8, sunI: 1.0, ambI: 0.38, fog: 0.0014, ghost: 0.12 }
  };

  Viewer.prototype.setEnvironment = function (name) {
    var e = ENVIRONMENTS[name] || ENVIRONMENTS.studio;
    this.environment = name;
    this.scene.background = new THREE.Color(e.bg);
    this.scene.fog = e.fog ? new THREE.FogExp2(e.bg, e.fog) : null;
    this.hemi.color.setHex(e.hemiSky);
    this.hemi.groundColor.setHex(e.hemiGround);
    this.sun.color.setHex(e.sun);
    this.sun.intensity = this.quality.shadows ? e.sunI : e.sunI * 0.8;
    this.ambient.intensity = e.ambI;
    this.ground.material.color.setHex(e.ground);
    this.ground.visible = this.quality.ground;
    if (this.uniforms) this.uniforms.uGhostOpacity.value = e.ghost;
    this.needsRender = true;
  };

  /** Sun azimuth/altitude in degrees; drives the shadow direction. */
  Viewer.prototype.setSun = function (azimuth, altitude) {
    this.sunAngle = { azimuth: azimuth, altitude: altitude };
    var r = this.modelRadius || 30;
    var az = azimuth * Math.PI / 180, al = altitude * Math.PI / 180;
    this.sun.position.set(
      this.target.x + r * 2.2 * Math.cos(al) * Math.cos(az),
      this.target.y + r * 2.2 * Math.cos(al) * Math.sin(az),
      this.target.z + r * 2.2 * Math.sin(al)
    );
    this.sun.target.position.copy(this.target);
    this.fill.position.set(-this.sun.position.x, -this.sun.position.y, this.sun.position.z * 0.4);
    var d = r * 2.0;
    var cam = this.sun.shadow.camera;
    cam.left = -d; cam.right = d; cam.top = d; cam.bottom = -d;
    cam.near = 0.1; cam.far = r * 6;
    cam.updateProjectionMatrix();
    this.needsRender = true;
  };

  /**
   * Named quality presets. Draft trades every optional effect for frame
   * rate; Presentation buys back shadow resolution and pixel ratio for a
   * screen recording or a client meeting.
   */
  var QUALITY_PRESETS = {
    draft:        { shadows: false, ground: false, ao: false, pixelRatio: 1,    shadowMap: 1024, labels: 0.85 },
    balanced:     { shadows: true,  ground: true,  ao: true,  pixelRatio: 1.5,  shadowMap: 2048, labels: 1 },
    presentation: { shadows: true,  ground: true,  ao: true,  pixelRatio: 2,    shadowMap: 4096, labels: 1.15 }
  };

  Viewer.prototype.setQualityPreset = function (name) {
    var p = QUALITY_PRESETS[name] || QUALITY_PRESETS.balanced;
    this.qualityPreset = name;
    this.renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, p.pixelRatio));
    if (this.sun.shadow.mapSize.width !== p.shadowMap) {
      this.sun.shadow.mapSize.set(p.shadowMap, p.shadowMap);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    this.setQuality({ shadows: p.shadows, ground: p.ground, ao: p.ao });
    this.resize();
    this.emit('quality', { preset: name, config: p });
    return p;
  };

  Viewer.prototype.qualityPresets = function () { return Object.keys(QUALITY_PRESETS); };

  /** Live rendering statistics for the status strip. */
  Viewer.prototype.stats = function () {
    var info = this.renderer.info;
    return {
      fps: this.fps,
      triangles: info.render.triangles,
      calls: info.render.calls,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      elements: this.elementCount || 0,
      chunks: this.chunks.length
    };
  };

  Viewer.prototype.setQuality = function (q) {
    Object.assign(this.quality, q);
    this.renderer.shadowMap.enabled = !!this.quality.shadows;
    this.sun.castShadow = !!this.quality.shadows;
    this.ground.visible = !!this.quality.ground;
    this.chunks.forEach(function (c) {
      c.solid.castShadow = !!q.shadows;
      c.solid.receiveShadow = !!q.shadows;
    });
    this.scene.traverse(function (o) { if (o.material) o.material.needsUpdate = true; });
    this.setEnvironment(this.environment || 'studio');
  };

  /* ---- Picking ------------------------------------------------------ */

  Viewer.prototype.setupPicking = function () {
    this.pickTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType
    });
    this.pickBuffer = new Uint8Array(4);
  };

  Viewer.prototype.pickAt = function (clientX, clientY) {
    if (!this.chunks.length) return -1;
    var rect = this.renderer.domElement.getBoundingClientRect();
    var x = Math.floor((clientX - rect.left) * this.renderer.getPixelRatio());
    var y = Math.floor((rect.bottom - clientY) * this.renderer.getPixelRatio());
    var size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (x < 0 || y < 0 || x >= size.x || y >= size.y) return -1;

    var cam = this.activeCamera();
    cam.setViewOffset(size.x, size.y, x, size.y - y - 1, 1, 1);

    var self = this;
    this.chunks.forEach(function (c) {
      c.solid.material = self.pickMaterial;
      c.ghost.visible = false;
    });
    var prevBg = this.scene.background;
    this.scene.background = new THREE.Color(0x000000);
    var overlayWasVisible = this.overlayRoot.visible;
    this.overlayRoot.visible = false;
    this.ground.visible = false;

    this.renderer.setRenderTarget(this.pickTarget);
    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    this.renderer.readRenderTargetPixels(this.pickTarget, 0, 0, 1, 1, this.pickBuffer);
    this.renderer.setRenderTarget(null);

    cam.clearViewOffset();
    this.scene.background = prevBg;
    this.overlayRoot.visible = overlayWasVisible;
    this.ground.visible = this.quality.ground;
    this.chunks.forEach(function (c) {
      c.solid.material = c.solidMaterial;
      c.ghost.visible = self.renderStyle !== 'wireframe';
    });
    this.needsRender = true;

    var b = this.pickBuffer;
    var id = b[0] + b[1] * 256 + b[2] * 65536 - 1;
    return id >= 0 && id < this.elementCount ? id : -1;
  };

  /* ---- Model loading ------------------------------------------------ */

  /**
   * Build the scene from a parsed model, yielding to the browser between
   * chunks so a large file streams in with a live progress bar.
   */
  Viewer.prototype.load = function (model, onProgress) {
    var self = this;
    this.clearModel();
    this.model = model;

    var elements = model.elements;
    var n = elements.length;
    this.elementCount = n;

    var lutW = Math.min(2048, Math.max(1, n));
    var lutH = Math.max(1, Math.ceil(n / lutW));
    var data = new Uint8Array(lutW * lutH * 4);
    this.lutData = data;
    this.lutSize = [lutW, lutH];
    this.lut = new THREE.DataTexture(data, lutW, lutH, THREE.RGBAFormat);
    this.lut.magFilter = THREE.NearestFilter;
    this.lut.minFilter = THREE.NearestFilter;
    this.lut.generateMipmaps = false;
    this.lut.needsUpdate = true;

    this.states = new Uint8Array(n);
    this.colors = new Uint8Array(n * 3);
    for (var i = 0; i < n; i++) this.states[i] = ST.VISIBLE;

    var c = model.bbox.center;
    this.uniforms = makeUniforms(this.lut, this.lutSize, c);
    this.pickMaterial = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: PICK_VERT,
      fragmentShader: PICK_FRAG,
      side: THREE.DoubleSide,
      clipping: true
    });

    var size = model.bbox.size;
    this.modelRadius = Math.max(0.5, Math.sqrt(size[0] * size[0] + size[1] * size[1] + size[2] * size[2]) / 2);
    this.glyphSize = Math.max(this.modelRadius * 0.004, 0.06);

    // Cache per-element shader inputs once.
    var maxStorey = 0;
    elements.forEach(function (el) {
      el.storeyF = Math.max(0, el.storyIndex || 0);
      el.typeF = typeIndex(el.type);
      if (el.storeyF > maxStorey) maxStorey = el.storeyF;
    });
    this.maxStorey = maxStorey;

    var simplify = n > SIMPLIFY_ABOVE;
    this.autoLines = n > LINES_ONLY_ABOVE;

    return new Promise(function (resolve) {
      var index = 0;
      var t0 = performance.now();

      function step() {
        var cb = new ChunkBuilder();
        var lb = new LineBuilder();
        var end = Math.min(index + CHUNK_SIZE, n);

        for (var k = index; k < end; k++) {
          var el = elements[k];
          try {
            if (el.kind === 'frame') {
              var prof = model.sectionProfiles[el.section];
              if (!prof) {
                var def = model.frameSections[el.section] || { name: el.section };
                prof = model.sectionProfiles[el.section] = global.ETABSSections.build(def);
              }
              var outline = simplify ? boxProxy(prof) : prof.outline;
              // Curved (multilinear) members are swept segment by segment;
              // every piece carries the same element id, so picking,
              // colouring and hiding still treat it as one member.
              var segs = el.path && el.path.length > 2 ? el.path : [el.a, el.b];
              var mid = [(el.a[0] + el.b[0]) / 2, (el.a[1] + el.b[1]) / 2, (el.a[2] + el.b[2]) / 2];
              for (var sg = 1; sg < segs.length; sg++) {
                var piece = segs.length === 2 ? el : Object.create(el, {
                  a: { value: segs[sg - 1] }, b: { value: segs[sg] }
                });
                if (!self.autoLines) extrudeFrame(cb, piece, outline, !simplify);
                lb.segment(segs[sg - 1], segs[sg], el.id, el.storeyF, el.typeF, mid);
              }
            } else if (el.kind === 'area') {
              if (!self.autoLines) extrudeArea(cb, el);
              var pts = el.pts, cen = centroid(pts);
              for (var q = 0; q < pts.length; q++) {
                lb.segment(pts[q], pts[(q + 1) % pts.length], el.id, el.storeyF, el.typeF, cen);
              }
            } else if (el.kind === 'joint') {
              addGlyph(cb, el, el.type, self.glyphSize * (el.type === 'Joint' ? 1 : 2.2));
            }
          } catch (err) {
            // One malformed element must never abort the whole build.
            if (model.meta.warnings.length < 20) {
              model.meta.warnings.push('Element ' + (el.name || el.id) + ' could not be built.');
            }
          }
        }

        if (cb.count) self.addChunk(cb.geometry());
        if (lb.pos.length) self.addLineChunk(lb.geometry());

        index = end;
        if (onProgress) onProgress(index / n, index, n);

        if (index < n) {
          setTimeout(step, 0);
        } else {
          self.buildMs = performance.now() - t0;
          self.applyRenderStyle();
          self.setEnvironment(self.environment || 'studio');
          self.frameAll(false);
          self.setSun(135, 55);
          self.syncLut();
          self.needsRender = true;
          resolve(self);
        }
      }
      setTimeout(step, 0);
    });
  };

  function boxProxy(prof) {
    var u = prof.width / 2, v = prof.depth / 2;
    return [[-u, -v], [u, -v], [u, v], [-u, v]];
  }

  function centroid(pts) {
    var x = 0, y = 0, z = 0;
    for (var i = 0; i < pts.length; i++) { x += pts[i][0]; y += pts[i][1]; z += pts[i][2]; }
    return [x / pts.length, y / pts.length, z / pts.length];
  }

  Viewer.prototype.addChunk = function (geometry) {
    var solidMaterial = patchMaterial(new THREE.MeshLambertMaterial({
      color: 0xffffff, side: THREE.DoubleSide
    }), this.uniforms, false);
    var ghostMaterial = patchMaterial(new THREE.MeshLambertMaterial({
      color: 0xffffff, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide
    }), this.uniforms, false);

    var solid = new THREE.Mesh(geometry, solidMaterial);
    solid.castShadow = this.quality.shadows;
    solid.receiveShadow = this.quality.shadows;
    var ghost = new THREE.Mesh(geometry, ghostMaterial);
    ghost.renderOrder = 2;

    var chunk = { geometry: geometry, solid: solid, ghost: ghost, solidMaterial: solidMaterial, ghostMaterial: ghostMaterial };
    this.chunks.push(chunk);
    this.modelRoot.add(solid);
    this.modelRoot.add(ghost);
    this.updateChunkPass(chunk);
  };

  Viewer.prototype.addLineChunk = function (geometry) {
    var mat = patchMaterial(new THREE.LineBasicMaterial({ color: 0xffffff }), this.uniforms, true);
    var lines = new THREE.LineSegments(geometry, mat);
    lines.renderOrder = 3;
    // Every patched material shares one uniform bag, so each draw declares
    // which pass it is — otherwise lines inherit the ghost pass and vanish.
    var self = this;
    lines.onBeforeRender = function () {
      self.uniforms.uPass.value = 0;
      self.uniforms.uTint.value = 1;
    };
    this.lineChunks.push({ geometry: geometry, lines: lines, material: mat });
    this.modelRoot.add(lines);
  };

  Viewer.prototype.updateChunkPass = function (chunk) {
    // Material-level uPass cannot be shared (all materials share one bag),
    // so the pass is set per draw in onBeforeRender.
    var self = this;
    chunk.solid.onBeforeRender = function () {
      self.uniforms.uPass.value = self.renderStyle === 'xray' ? 2 : 0;
      self.uniforms.uTint.value = 1;
    };
    chunk.ghost.onBeforeRender = function () {
      self.uniforms.uPass.value = 1;
      self.uniforms.uTint.value = 1;
    };
  };

  Viewer.prototype.clearModel = function () {
    var self = this;
    this.chunks.forEach(function (c) {
      self.modelRoot.remove(c.solid); self.modelRoot.remove(c.ghost);
      c.geometry.dispose(); c.solidMaterial.dispose(); c.ghostMaterial.dispose();
    });
    this.lineChunks.forEach(function (c) {
      self.modelRoot.remove(c.lines); c.geometry.dispose(); c.material.dispose();
    });
    this.chunks = []; this.lineChunks = [];
    this.clearOverlays();
    if (this.lut) this.lut.dispose();
    this.selection = []; this.hovered = -1;
  };

  Viewer.prototype.clearOverlays = function () {
    while (this.overlayRoot.children.length) {
      var o = this.overlayRoot.children.pop();
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    }
  };

  /* ---- Appearance --------------------------------------------------- */

  Viewer.prototype.setElementColor = function (id, r, g, b) {
    this.colors[id * 3] = r; this.colors[id * 3 + 1] = g; this.colors[id * 3 + 2] = b;
  };
  Viewer.prototype.setElementState = function (id, state) { this.states[id] = state; };

  /** Push the CPU-side colour/state arrays into the GPU lookup texture. */
  Viewer.prototype.syncLut = function () {
    var n = this.elementCount, d = this.lutData;
    for (var i = 0; i < n; i++) {
      d[i * 4] = this.colors[i * 3];
      d[i * 4 + 1] = this.colors[i * 3 + 1];
      d[i * 4 + 2] = this.colors[i * 3 + 2];
      d[i * 4 + 3] = this.states[i];
    }
    this.lut.needsUpdate = true;
    this.needsRender = true;
  };

  Viewer.prototype.setRenderStyle = function (style) {
    this.renderStyle = style;
    this.applyRenderStyle();
  };

  Viewer.prototype.applyRenderStyle = function () {
    var s = this.renderStyle;
    var solidOn = s !== 'wireframe' && !this.autoLines;
    var linesOn = s === 'wireframe' || s === 'technical' || s === 'xray' || this.autoLines;
    var lineColor = (this.environment === 'night' || this.environment === 'blueprint') ? 1 : 1;

    this.chunks.forEach(function (c) {
      c.solid.visible = solidOn;
      c.ghost.visible = solidOn && s !== 'xray';
      c.solidMaterial.transparent = (s === 'xray');
      c.solidMaterial.depthWrite = (s !== 'xray');
      c.solidMaterial.flatShading = (s === 'technical');
      c.solidMaterial.needsUpdate = true;
    });
    this.lineChunks.forEach(function (c) {
      c.lines.visible = linesOn;
      c.material.opacity = s === 'technical' ? 0.85 : 1;
      c.material.transparent = s === 'technical';
    });
    void lineColor;
    this.needsRender = true;
  };

  Viewer.prototype.setGhostOpacity = function (v) {
    // The uniform bag only exists once a model has been built; these setters
    // are called from state resets that can run before the first load.
    if (!this.uniforms) return;
    this.uniforms.uGhostOpacity.value = v;
    this.needsRender = true;
  };

  Viewer.prototype.setExplode = function (storey, radial, typeSpread) {
    this.explode = { storey: storey, radial: radial, type: typeSpread };
    if (!this.uniforms) return;
    this.uniforms.uExplodeStorey.value = storey;
    this.uniforms.uExplodeRadial.value = radial;
    var offs = this.uniforms.uTypeOffset.value;
    var r = this.modelRadius || 20;
    var dirs = [
      [0, 0, 0],                 // Column
      [0, 0, 0.35],              // Beam
      [0, 0, 0.7],               // Brace
      [0, 0, 1.1],               // Slab
      [0, 0, 0.2],               // Wall
      [0, 0, 0.9],               // Ramp
      [0, 0, -0.2],              // Joint
      [0, 0, 0]                  // Other
    ];
    for (var i = 0; i < 8; i++) {
      offs[i].set(dirs[i][0] * r * typeSpread, dirs[i][1] * r * typeSpread, dirs[i][2] * r * typeSpread);
    }
    this.needsRender = true;
  };

  /* ---- Clipping ------------------------------------------------------ */

  /**
   * @param {Array<{axis:number, value:number, sign:number}>} defs
   *   axis 0/1/2 → X/Y/Z, sign +1 keeps the low side, -1 keeps the high side.
   */
  Viewer.prototype.setClipPlanes = function (defs) {
    var planes = (defs || []).map(function (d) {
      var n = [0, 0, 0];
      n[d.axis] = -d.sign;
      return new THREE.Plane(new THREE.Vector3(n[0], n[1], n[2]), d.sign * d.value);
    });
    this.clipPlanes = planes;
    // Always an array, never null: three r128's shadow pass reads
    // clippingPlanes.length whenever clipShadows is on, so null crashed the
    // renderer (blank canvas) the moment clipping was cleared with shadows on.
    var all = planes;
    var clipShadows = planes.length > 0;
    this.chunks.forEach(function (c) {
      c.solidMaterial.clippingPlanes = all; c.solidMaterial.clipShadows = clipShadows;
      c.ghostMaterial.clippingPlanes = all;
    });
    this.lineChunks.forEach(function (c) { c.material.clippingPlanes = all; });
    if (this.rebarMesh) {
      this.rebarMesh.material.clippingPlanes = all;
      this.rebarMesh.material.clipShadows = clipShadows;
    }
    if (this.pickMaterial) this.pickMaterial.clippingPlanes = all;
    this.needsRender = true;
  };

  /* ---- Camera ------------------------------------------------------- */

  Viewer.prototype.activeCamera = function () { return this.useOrtho ? this.orthoCamera : this.camera; };

  Viewer.prototype.setProjection = function (mode) {
    this.useOrtho = (mode === 'ortho');
    this.updateCamera();
    this.needsRender = true;
  };

  Viewer.prototype.updateCamera = function () {
    this.cameraMovedAt = (global.performance && performance.now) ? performance.now() : Date.now();
    this.settled = false;
    var s = this.spherical;
    var sinPhi = Math.sin(s.phi);
    var pos = new THREE.Vector3(
      this.target.x + s.radius * sinPhi * Math.cos(s.theta),
      this.target.y + s.radius * sinPhi * Math.sin(s.theta),
      this.target.z + s.radius * Math.cos(s.phi)
    );
    if (this.walk.on) {
      this.camera.position.copy(this.walk.pos);
      var dir = new THREE.Vector3(
        Math.cos(this.walk.pitch) * Math.cos(this.walk.yaw),
        Math.cos(this.walk.pitch) * Math.sin(this.walk.yaw),
        Math.sin(this.walk.pitch)
      );
      this.camera.lookAt(this.walk.pos.clone().add(dir));
      return;
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(this.target);

    var aspect = this.camera.aspect;
    var half = s.radius * 0.5;
    this.orthoCamera.left = -half * aspect; this.orthoCamera.right = half * aspect;
    this.orthoCamera.top = half; this.orthoCamera.bottom = -half;
    this.orthoCamera.position.copy(pos);
    this.orthoCamera.up.set(0, 0, 1);
    this.orthoCamera.lookAt(this.target);
    this.orthoCamera.updateProjectionMatrix();
  };

  Viewer.prototype.frameAll = function (animate) {
    if (!this.model) return;
    var b = this.model.bbox;
    this.frameBox(b.min, b.max, animate);
  };

  Viewer.prototype.frameBox = function (min, max, animate) {
    var cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;
    var dx = max[0] - min[0], dy = max[1] - min[1], dz = max[2] - min[2];
    var r = Math.max(0.5, Math.sqrt(dx * dx + dy * dy + dz * dz) / 2);
    var dist = r / Math.sin((this.camera.fov * Math.PI / 180) / 2) * 1.18;
    var to = { target: new THREE.Vector3(cx, cy, cz), radius: dist };
    if (animate === false) {
      this.target.copy(to.target);
      this.spherical.radius = dist;
      this.updateCamera();
      this.needsRender = true;
    } else {
      this.animateTo(to.target, dist, this.spherical.theta, this.spherical.phi);
    }
    this.ground.position.set(cx, cy, min[2] - r * 0.004);
    this.ground.scale.set(r * 14, r * 14, 1);
  };

  Viewer.prototype.frameElements = function (ids) {
    if (!ids || !ids.length || !this.model) return;
    var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    var els = this.model.elements;
    ids.forEach(function (id) {
      var el = els[id];
      if (!el) return;
      var pts = el.kind === 'frame' ? [el.a, el.b] : (el.kind === 'area' ? el.pts : [el.p]);
      pts.forEach(function (p) {
        for (var i = 0; i < 3; i++) {
          if (p[i] < min[i]) min[i] = p[i];
          if (p[i] > max[i]) max[i] = p[i];
        }
      });
    });
    if (!isFinite(min[0])) return;
    for (var i = 0; i < 3; i++) {
      var pad = Math.max((max[i] - min[i]) * 0.25, 0.8);
      min[i] -= pad; max[i] += pad;
    }
    this.frameBox(min, max, true);
  };

  var VIEW_ANGLES = {
    top:   [0, 0.001], bottom: [0, Math.PI - 0.001],
    front: [-Math.PI / 2, Math.PI / 2], back: [Math.PI / 2, Math.PI / 2],
    left:  [Math.PI, Math.PI / 2], right: [0, Math.PI / 2],
    iso:   [Math.PI * 0.25, Math.PI * 0.32],
    isoSE: [-Math.PI * 0.25, Math.PI * 0.32],
    isoNE: [Math.PI * 0.25, Math.PI * 0.32],
    isoNW: [Math.PI * 0.75, Math.PI * 0.32],
    isoSW: [-Math.PI * 0.75, Math.PI * 0.32]
  };

  Viewer.prototype.setView = function (name) {
    var a = VIEW_ANGLES[name];
    if (!a) return;
    this.pushViewState();
    this.animateTo(this.target.clone(), this.spherical.radius, a[0], a[1]);
  };

  Viewer.prototype.animateTo = function (target, radius, theta, phi) {
    var self = this;
    var from = {
      t: this.target.clone(), r: this.spherical.radius,
      th: this.spherical.theta, ph: this.spherical.phi
    };
    // Take the short way round the turntable.
    var dTheta = theta - from.th;
    while (dTheta > Math.PI) dTheta -= Math.PI * 2;
    while (dTheta < -Math.PI) dTheta += Math.PI * 2;

    var start = performance.now(), dur = 520;
    if (this.anim) cancelAnimationFrame(this.anim);
    function tick() {
      var k = Math.min(1, (performance.now() - start) / dur);
      var e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      self.target.lerpVectors(from.t, target, e);
      self.spherical.radius = from.r + (radius - from.r) * e;
      self.spherical.theta = from.th + dTheta * e;
      self.spherical.phi = from.ph + (phi - from.ph) * e;
      self.updateCamera();
      self.needsRender = true;
      if (k < 1) self.anim = requestAnimationFrame(tick); else self.anim = null;
    }
    tick();
  };

  Viewer.prototype.pushViewState = function () {
    this.viewHistory.push({
      target: this.target.clone(),
      radius: this.spherical.radius,
      theta: this.spherical.theta,
      phi: this.spherical.phi
    });
    if (this.viewHistory.length > 60) this.viewHistory.shift();
    this.viewFuture.length = 0;
  };

  Viewer.prototype.viewUndo = function () {
    if (!this.viewHistory.length) return false;
    this.viewFuture.push(this.captureView());
    this.restoreView(this.viewHistory.pop());
    return true;
  };
  Viewer.prototype.viewRedo = function () {
    if (!this.viewFuture.length) return false;
    this.viewHistory.push(this.captureView());
    this.restoreView(this.viewFuture.pop());
    return true;
  };
  Viewer.prototype.captureView = function () {
    return {
      target: this.target.clone(), radius: this.spherical.radius,
      theta: this.spherical.theta, phi: this.spherical.phi,
      ortho: this.useOrtho
    };
  };
  Viewer.prototype.restoreView = function (v) {
    if (!v) return;
    if (v.ortho !== undefined) this.setProjection(v.ortho ? 'ortho' : 'persp');
    this.animateTo(v.target.clone ? v.target.clone() : new THREE.Vector3(v.target.x, v.target.y, v.target.z),
      v.radius, v.theta, v.phi);
  };

  /* ---- Turntable, cinematic orbit, walk ----------------------------- */

  Viewer.prototype.setTurntable = function (on, cinematic) {
    var was = this.turntable.on;
    this.turntable.on = !!on;
    this.turntable.cinematic = !!cinematic;
    this.turntable.t = 0;
    if (was !== this.turntable.on) this.emit('turntable', this.turntable.on);
  };
  Viewer.prototype.setTurntableSpeed = function (v) { this.turntable.speed = v; };

  Viewer.prototype.setWalk = function (on) {
    this.walk.on = !!on;
    if (on) {
      var s = this.spherical;
      this.walk.pos.set(
        this.target.x + s.radius * 0.45 * Math.cos(s.theta),
        this.target.y + s.radius * 0.45 * Math.sin(s.theta),
        (this.model ? this.model.bbox.min[2] : 0) + 1.65
      );
      this.walk.yaw = s.theta + Math.PI;
      this.walk.pitch = 0;
      this.walk.speed = Math.max(2, this.modelRadius * 0.12);
    }
    this.needsRender = true;
    this.emit('walk', this.walk.on);
  };

  /* ---- Input -------------------------------------------------------- */

  Viewer.prototype.bindInput = function () {
    var el = this.renderer.domElement, self = this;
    var dragging = false, mode = 'orbit', lastX = 0, lastY = 0, moved = 0;
    var pointers = {}, pinchDist = 0;

    function pos(e) { return { x: e.clientX, y: e.clientY }; }

    el.addEventListener('pointerdown', function (e) {
      el.setPointerCapture(e.pointerId);
      pointers[e.pointerId] = pos(e);
      if (Object.keys(pointers).length === 2) {
        var k = Object.keys(pointers);
        pinchDist = Math.hypot(
          pointers[k[0]].x - pointers[k[1]].x, pointers[k[0]].y - pointers[k[1]].y);
        mode = 'pan';
        return;
      }
      dragging = true; moved = 0;
      lastX = e.clientX; lastY = e.clientY;
      mode = (e.button === 1 || e.button === 2 || e.shiftKey) ? 'pan' : 'orbit';
      if (mode === 'orbit' && !self.walk.on) self.pushViewState();
    });

    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    el.addEventListener('pointermove', function (e) {
      if (pointers[e.pointerId]) pointers[e.pointerId] = pos(e);
      var ids = Object.keys(pointers);

      if (ids.length === 2) {
        var d = Math.hypot(
          pointers[ids[0]].x - pointers[ids[1]].x, pointers[ids[0]].y - pointers[ids[1]].y);
        if (pinchDist) self.dolly(Math.pow(0.995, d - pinchDist));
        pinchDist = d;
        return;
      }

      if (!dragging) {
        self.scheduleHover(e.clientX, e.clientY);
        return;
      }
      var dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);

      if (self.walk.on) {
        self.walk.yaw -= dx * 0.005;
        self.walk.pitch = Math.max(-1.4, Math.min(1.4, self.walk.pitch - dy * 0.005));
      } else if (mode === 'orbit') {
        self.spherical.theta -= dx * 0.008;
        self.spherical.phi = Math.max(0.02, Math.min(Math.PI - 0.02, self.spherical.phi - dy * 0.008));
        self.turntable.on = false;
      } else {
        self.pan(dx, dy);
      }
      self.updateCamera();
      self.needsRender = true;
    });

    function up(e) {
      delete pointers[e.pointerId];
      if (Object.keys(pointers).length < 2) pinchDist = 0;
      if (dragging && moved < 5 && !self.walk.on) self.handleClick(e);
      dragging = false;
    }
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', function () {
      if (self.hovered >= 0) { self.setHover(-1); }
    });

    el.addEventListener('wheel', function (e) {
      e.preventDefault();
      self.turntable.on = false;
      self.dolly(Math.pow(0.9, -Math.sign(e.deltaY)));
    }, { passive: false });

    el.addEventListener('dblclick', function (e) {
      var id = self.pickAt(e.clientX, e.clientY);
      self.emit('isolate-request', id);
    });

    global.addEventListener('keydown', function (e) {
      if (self.walk.on) self.walk.keys[e.key.toLowerCase()] = true;
    });
    global.addEventListener('keyup', function (e) {
      if (self.walk.on) self.walk.keys[e.key.toLowerCase()] = false;
    });
  };

  Viewer.prototype.dolly = function (factor) {
    if (this.walk.on) return;
    this.spherical.radius = Math.max(this.modelRadius * 0.01, Math.min(this.modelRadius * 40, this.spherical.radius * factor));
    this.updateCamera();
    this.needsRender = true;
  };

  Viewer.prototype.pan = function (dx, dy) {
    var cam = this.camera;
    var scale = this.spherical.radius * 0.0016;
    var right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0);
    var up = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 1);
    var move = right.multiplyScalar(-dx * scale).add(up.multiplyScalar(dy * scale));
    this.target.add(move);
  };

  Viewer.prototype.scheduleHover = function (x, y) {
    var self = this;
    this.hoverPos = { x: x, y: y };
    if (this.hoverTimer) return;
    this.hoverTimer = setTimeout(function () {
      self.hoverTimer = null;
      if (!self.hoverPos) return;
      var id = self.pickAt(self.hoverPos.x, self.hoverPos.y);
      self.setHover(id);
    }, 45);
  };

  Viewer.prototype.setHover = function (id) {
    if (this.hovered === id) return;
    if (this.hovered >= 0 && this.states[this.hovered] === ST.HOVER) {
      this.states[this.hovered] = this.selection.indexOf(this.hovered) >= 0 ? ST.SELECTED : ST.VISIBLE;
    }
    this.hovered = id;
    if (id >= 0 && this.states[id] === ST.VISIBLE) this.states[id] = ST.HOVER;
    this.syncLut();
    this.emit('hover', id);
  };

  Viewer.prototype.handleClick = function (e) {
    var id = this.pickAt(e.clientX, e.clientY);
    var additive = e.shiftKey || e.ctrlKey || e.metaKey;
    this.select(id >= 0 ? [id] : [], additive);
  };

  Viewer.prototype.select = function (ids, additive) {
    var self = this;
    if (!additive) {
      this.selection.forEach(function (id) {
        if (self.states[id] === ST.SELECTED) self.states[id] = ST.VISIBLE;
      });
      this.selection = [];
    }
    ids.forEach(function (id) {
      if (self.selection.indexOf(id) < 0 && self.states[id] !== ST.HIDDEN) {
        self.selection.push(id);
        self.states[id] = ST.SELECTED;
      }
    });
    this.syncLut();
    this.emit('select', this.selection.slice());
  };

  /** Rubber-band selection: project every element centre into screen space. */
  Viewer.prototype.selectInRect = function (rect, additive) {
    if (!this.model) return;
    var cam = this.activeCamera();
    cam.updateMatrixWorld();
    var canvas = this.renderer.domElement.getBoundingClientRect();
    var v = new THREE.Vector3();
    var hits = [];
    var els = this.model.elements;
    for (var i = 0; i < els.length; i++) {
      if (this.states[i] === ST.HIDDEN) continue;
      var el = els[i];
      var c = el.kind === 'frame'
        ? [(el.a[0] + el.b[0]) / 2, (el.a[1] + el.b[1]) / 2, (el.a[2] + el.b[2]) / 2]
        : (el.kind === 'area' ? centroid(el.pts) : el.p);
      v.set(c[0], c[1], c[2] + (el.storeyF * this.explode.storey));
      v.project(cam);
      var sx = canvas.left + (v.x * 0.5 + 0.5) * canvas.width;
      var sy = canvas.top + (-v.y * 0.5 + 0.5) * canvas.height;
      if (v.z > 1) continue;
      if (sx >= rect.left && sx <= rect.right && sy >= rect.top && sy <= rect.bottom) hits.push(i);
    }
    this.select(hits, additive);
  };

  /* ---- Screen capture ----------------------------------------------- */

  /**
   * Render at a multiple of the display size and return a PNG data URL.
   * `transparent` swaps the background out for an alpha channel.
   */
  /* ================================================================== */
  /* Reinforcement                                                       */
  /* ================================================================== */

  /**
   * Draw a set of bars as real 3-D steel. Each bar is a polyline swept with
   * a six-sided tube, all welded into one geometry so tens of thousands of
   * bars stay one draw call. A triangle→bar map is kept so the cursor can
   * name the bar under it.
   *
   * @param {Array} bars   from ETABSRebar — each { pts, dia, kind }
   * @param {object} opt   { thickness, colorOf, maxSegments }
   * @returns {object} { segments, bars, capped }
   */
  Viewer.prototype.setRebar = function (bars, opt) {
    opt = opt || {};
    this.clearRebar();
    if (!bars || !bars.length) { this.needsRender = true; return { segments: 0, bars: 0, capped: false }; }

    var thickness = opt.thickness || 1;
    var maxSeg = opt.maxSegments || 60000;
    var SIDES = 6;

    // Count first so the typed arrays are allocated once.
    var segCount = 0, i, b;
    for (i = 0; i < bars.length; i++) segCount += bars[i].pts.length - 1;
    var capped = segCount > maxSeg;
    var ratio = capped ? maxSeg / segCount : 1;

    var verts = [], norms = [], cols = [], idx = [];
    var triOfBar = [];
    var drawn = 0, usedBars = 0;

    for (i = 0; i < bars.length; i++) {
      b = bars[i];
      if (capped && (i * ratio) % 1 >= ratio) continue;      // thin evenly
      var colour = opt.colorOf ? opt.colorOf(b) : [0.55, 0.58, 0.62];
      var r = Math.max(0.004, b.dia / 2000) * thickness;
      var any = false;
      for (var s = 0; s + 1 < b.pts.length; s++) {
        if (drawn >= maxSeg) break;
        tube(verts, norms, cols, idx, triOfBar, b.pts[s], b.pts[s + 1], r, SIDES, colour, i);
        drawn++; any = true;
      }
      if (any) usedBars++;
      if (drawn >= maxSeg) break;
    }

    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();

    var mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.clippingPlanes = this.clipPlanes;
    mat.clipShadows = this.clipPlanes.length > 0;

    this.rebarMesh = new THREE.Mesh(g, mat);
    this.rebarMesh.castShadow = false;
    this.rebarMesh.receiveShadow = false;
    this.rebarMesh.renderOrder = 2;
    this.rebarTriOfBar = triOfBar;
    this.rebarBars = bars;
    this.modelRoot.add(this.rebarMesh);
    this.needsRender = true;

    return { segments: drawn, bars: usedBars, capped: capped || drawn >= maxSeg };
  };

  /** One straight length of bar, as a six-sided tube. */
  function tube(verts, norms, cols, idx, triOfBar, p0, p1, r, sides, colour, barIndex) {
    var ax = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    var L = Math.sqrt(ax[0] * ax[0] + ax[1] * ax[1] + ax[2] * ax[2]);
    if (L < 1e-6) return;
    ax = [ax[0] / L, ax[1] / L, ax[2] / L];
    var ref = Math.abs(ax[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
    var u = normalize(cross(ref, ax));
    var v = cross(ax, u);
    var base = verts.length / 3;

    for (var k = 0; k < sides; k++) {
      var a = k / sides * Math.PI * 2;
      var ca = Math.cos(a), sa = Math.sin(a);
      var n = [u[0] * ca + v[0] * sa, u[1] * ca + v[1] * sa, u[2] * ca + v[2] * sa];
      verts.push(p0[0] + n[0] * r, p0[1] + n[1] * r, p0[2] + n[2] * r);
      norms.push(n[0], n[1], n[2]);
      cols.push(colour[0], colour[1], colour[2]);
      verts.push(p1[0] + n[0] * r, p1[1] + n[1] * r, p1[2] + n[2] * r);
      norms.push(n[0], n[1], n[2]);
      cols.push(colour[0], colour[1], colour[2]);
    }
    for (var q = 0; q < sides; q++) {
      var a0 = base + q * 2, b0 = base + ((q + 1) % sides) * 2;
      idx.push(a0, a0 + 1, b0 + 1);
      idx.push(a0, b0 + 1, b0);
      triOfBar.push(barIndex, barIndex);
    }
  }

  Viewer.prototype.clearRebar = function () {
    if (!this.rebarMesh) return;
    this.modelRoot.remove(this.rebarMesh);
    this.rebarMesh.geometry.dispose();
    this.rebarMesh.material.dispose();
    this.rebarMesh = null;
    this.rebarTriOfBar = null;
    this.rebarBars = null;
    this.needsRender = true;
  };

  /** Which bar is under the cursor? Returns the bar object, or null. */
  Viewer.prototype.pickRebar = function (clientX, clientY) {
    if (!this.rebarMesh || !this.rebarBars) return null;
    var rect = this.renderer.domElement.getBoundingClientRect();
    var ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.rayPicker = this.rayPicker || new THREE.Raycaster();
    this.rayPicker.setFromCamera(ndc, this.activeCamera());
    var hit = this.rayPicker.intersectObject(this.rebarMesh, false)[0];
    if (!hit || hit.faceIndex === undefined) return null;
    var bi = this.rebarTriOfBar[hit.faceIndex];
    return bi === undefined ? null : this.rebarBars[bi];
  };

  Viewer.prototype.capture = function (scale, transparent) {
    var el = this.container;
    var w = el.clientWidth, h = el.clientHeight;
    var cam = this.activeCamera();
    var prevRatio = this.renderer.getPixelRatio();
    var prevBg = this.scene.background;
    var prevGround = this.ground.visible;
    var prevAlpha = this.renderer.getClearAlpha();

    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w * scale, h * scale, false);
    if (this.useOrtho) { cam.updateProjectionMatrix(); }
    else { cam.aspect = w / h; cam.updateProjectionMatrix(); }

    if (transparent) {
      this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
      this.ground.visible = false;
    }
    this.renderer.render(this.scene, cam);
    var url = this.renderer.domElement.toDataURL('image/png');

    this.scene.background = prevBg;
    this.renderer.setClearAlpha(prevAlpha);
    this.ground.visible = prevGround;
    this.renderer.setPixelRatio(prevRatio);
    this.renderer.setSize(w, h, false);
    this.resize();
    return url;
  };

  /* ---- Loop --------------------------------------------------------- */

  Viewer.prototype.resize = function () {
    var w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.updateCamera();
    this.needsRender = true;
    this.emit('resize', { width: w, height: h });
  };

  Viewer.prototype.loop = function () {
    var self = this;
    var frames = 0, acc = 0;
    function frame() {
      var dt = Math.min(self.clock.getDelta(), 0.1);
      acc += dt; frames++;
      if (acc > 0.5) { self.fps = Math.round(frames / acc); frames = 0; acc = 0; }

      if (self.turntable.on && !self.walk.on) {
        self.turntable.t += dt;
        self.spherical.theta += dt * self.turntable.speed;
        if (self.turntable.cinematic) {
          var k = (Math.sin(self.turntable.t * 0.18) + 1) / 2;
          self.spherical.phi = 0.55 + k * 0.65;
          self.spherical.radius = self.spherical.radius * (1 + Math.sin(self.turntable.t * 0.11) * 0.0012);
        }
        self.updateCamera();
        self.needsRender = true;
      }

      if (self.walk.on) {
        var k2 = self.walk.keys, sp = self.walk.speed * dt * (k2['shift'] ? 2.5 : 1);
        var fwd = new THREE.Vector3(Math.cos(self.walk.yaw), Math.sin(self.walk.yaw), 0);
        var rgt = new THREE.Vector3(-Math.sin(self.walk.yaw), Math.cos(self.walk.yaw), 0);
        var moved = false;
        if (k2['w'] || k2['arrowup']) { self.walk.pos.addScaledVector(fwd, sp); moved = true; }
        if (k2['s'] || k2['arrowdown']) { self.walk.pos.addScaledVector(fwd, -sp); moved = true; }
        if (k2['a'] || k2['arrowleft']) { self.walk.pos.addScaledVector(rgt, -sp); moved = true; }
        if (k2['d'] || k2['arrowright']) { self.walk.pos.addScaledVector(rgt, sp); moved = true; }
        if (k2['q']) { self.walk.pos.z -= sp; moved = true; }
        if (k2['e']) { self.walk.pos.z += sp; moved = true; }
        if (moved) { self.updateCamera(); self.needsRender = true; }
      }

      if (self.needsRender) {
        self.needsRender = false;
        self.renderer.render(self.scene, self.activeCamera());
      }

      // Fire once when the camera stops: label decluttering and the plan
      // locator only need recomputing when the view actually settles.
      if (!self.settled && self.cameraMovedAt) {
        var now = (global.performance && performance.now) ? performance.now() : Date.now();
        if (now - self.cameraMovedAt > 140) {
          self.settled = true;
          self.emit('settled');
        }
      }
      self.raf = requestAnimationFrame(frame);
    }
    frame();
  };

  Viewer.prototype.dispose = function () {
    cancelAnimationFrame(this.raf);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    this.clearModel();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  };

  global.ETABSViewer = {
    create: function (container, opts) { return new Viewer(container, opts); },
    STATE: ST,
    TYPE_ORDER: TYPE_ORDER,
    localAxes: localAxes,
    planeNormal: planeNormal
  };
})(window);
