/**
 * xlsx.js — Minimal Office Open XML workbook writer.
 * =================================================================
 * Writes a real .xlsx with multiple sheets, number formats, column widths
 * and — the point of writing our own rather than rendering a flat table —
 * LIVE FORMULAS. An estimator changes a rate in the rate-card sheet and
 * every dependent total moves, which a dumped CSV can never do.
 *
 * Strings are written inline (`t="inlineStr"`), which costs a few bytes over
 * a shared-string table and removes an entire class of index bugs.
 *
 * Namespace: window.ETABSXlsx
 */
(function (global) {
  'use strict';

  /* Style slots, in the order they are declared in cellXfs below. */
  var S = {
    NORMAL: 0,
    BOLD: 1,
    HEADER: 2,
    DEC3: 3,
    INT: 4,
    MONEY: 5,
    MONEY_BOLD: 6,
    TITLE: 7,
    NOTE: 8,
    PCT: 9,
    DEC2: 10,
    INPUT: 11,
    SUBHEAD: 12
  };

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      // Control characters are illegal in XML 1.0 and Excel refuses the file.
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  function colLetter(index) {
    var s = '';
    index++;
    while (index > 0) {
      var m = (index - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      index = Math.floor((index - 1) / 26);
    }
    return s;
  }

  function ref(col, row) { return colLetter(col) + (row + 1); }

  /* ------------------------------------------------------------------ */
  /* Sheet XML                                                           */
  /* ------------------------------------------------------------------ */

  function cellXml(cell, col, row) {
    if (cell === null || cell === undefined || cell === '') return '';
    var c = (typeof cell === 'object' && !(cell instanceof Date)) ? cell : { v: cell };
    var r = ref(col, row);
    var style = c.s === undefined ? '' : ' s="' + c.s + '"';

    if (c.f) {
      return '<c r="' + r + '"' + style + '><f>' + esc(c.f) + '</f></c>';
    }
    if (typeof c.v === 'number' && isFinite(c.v)) {
      return '<c r="' + r + '"' + style + '><v>' + c.v + '</v></c>';
    }
    if (typeof c.v === 'boolean') {
      return '<c r="' + r + '" t="b"' + style + '><v>' + (c.v ? 1 : 0) + '</v></c>';
    }
    return '<c r="' + r + '" t="inlineStr"' + style + '><is><t xml:space="preserve">' +
      esc(c.v) + '</t></is></c>';
  }

  function sheetXml(sheet) {
    var cols = '';
    if (sheet.widths && sheet.widths.length) {
      cols = '<cols>' + sheet.widths.map(function (w, i) {
        return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
      }).join('') + '</cols>';
    }

    var rows = sheet.rows.map(function (row, rIndex) {
      if (!row || !row.length) return '<row r="' + (rIndex + 1) + '"/>';
      var cells = row.map(function (cell, cIndex) { return cellXml(cell, cIndex, rIndex); }).join('');
      return '<row r="' + (rIndex + 1) + '">' + cells + '</row>';
    }).join('');

    var freeze = sheet.freeze
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="' + sheet.freeze +
        '" topLeftCell="A' + (sheet.freeze + 1) + '" activePane="bottomLeft" state="frozen"/>' +
        '</sheetView></sheetViews>'
      : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      freeze + cols +
      '<sheetData>' + rows + '</sheetData>' +
      '</worksheet>';
  }

  /* ------------------------------------------------------------------ */
  /* Workbook parts                                                      */
  /* ------------------------------------------------------------------ */

  function stylesXml(currencySymbol) {
    var sym = esc(currencySymbol || '');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="4">' +
        '<numFmt numFmtId="164" formatCode="#,##0.000"/>' +
        '<numFmt numFmtId="165" formatCode="#,##0"/>' +
        '<numFmt numFmtId="166" formatCode="&quot;' + sym + '&quot;#,##0"/>' +
        '<numFmt numFmtId="167" formatCode="#,##0.00"/>' +
      '</numFmts>' +
      '<fonts count="6">' +
        '<font><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="15"/><color rgb="FF0E5B63"/><name val="Calibri"/></font>' +
        '<font><i/><sz val="9"/><color rgb="FF6C7A85"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><color rgb="FF0E5B63"/><name val="Calibri"/></font>' +
      '</fonts>' +
      '<fills count="4">' +
        '<fill><patternFill patternType="none"/></fill>' +
        '<fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FF0E5B63"/><bgColor indexed="64"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF3D6"/><bgColor indexed="64"/></patternFill></fill>' +
      '</fills>' +
      '<borders count="2">' +
        '<border><left/><right/><top/><bottom/><diagonal/></border>' +
        '<border><left/><right/><top/><bottom style="thin"><color rgb="FFD6DDE3"/></bottom><diagonal/></border>' +
      '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="13">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +                                  // 0 normal
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                     // 1 bold
        '<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +       // 2 header
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/>' +           // 3 dec3
        '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/>' +           // 4 int
        '<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/>' +           // 5 money
        '<xf numFmtId="166" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1"/>' + // 6 money bold
        '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                     // 7 title
        '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                     // 8 note
        '<xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/>' +           // 9 pct
        '<xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/>' +           // 10 dec2
        '<xf numFmtId="167" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1"/>' + // 11 input
        '<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                     // 12 subhead
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';
  }

  function contentTypes(count) {
    var sheets = '';
    for (var i = 1; i <= count; i++) {
      sheets += '<Override PartName="/xl/worksheets/sheet' + i +
        '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>';
  }

  function rootRels() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';
  }

  function workbookXml(sheets) {
    var entries = sheets.map(function (s, i) {
      return '<sheet name="' + esc(safeName(s.name, i)) + '" sheetId="' + (i + 1) +
        '" r:id="rId' + (i + 1) + '"/>';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + entries + '</sheets>' +
      '<calcPr calcId="0" fullCalcOnLoad="1"/>' +
      '</workbook>';
  }

  function workbookRels(sheets) {
    var rels = sheets.map(function (s, i) {
      return '<Relationship Id="rId' + (i + 1) +
        '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
        'Target="worksheets/sheet' + (i + 1) + '.xml"/>';
    }).join('');
    rels += '<Relationship Id="rId' + (sheets.length + 1) +
      '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      rels + '</Relationships>';
  }

  /** Excel rejects these characters in a tab name, and caps it at 31 chars. */
  function safeName(name, i) {
    var n = String(name || ('Sheet' + (i + 1))).replace(/[\\\/\?\*\[\]:]/g, '-').slice(0, 31);
    return n || ('Sheet' + (i + 1));
  }

  /* ------------------------------------------------------------------ */
  /* Entry point                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * @param {Array<{name, rows, widths?, freeze?}>} sheets
   * @param {{currencySymbol?: string}} opts
   * @returns {Blob} an .xlsx ready to hand to the downloads capability
   */
  function build(sheets, opts) {
    opts = opts || {};
    if (!global.ETABSExport || !global.ETABSExport.zip) {
      throw new Error('The archive writer is unavailable.');
    }
    var files = [
      { name: '[Content_Types].xml', text: contentTypes(sheets.length) },
      { name: '_rels/.rels', text: rootRels() },
      { name: 'xl/workbook.xml', text: workbookXml(sheets) },
      { name: 'xl/_rels/workbook.xml.rels', text: workbookRels(sheets) },
      { name: 'xl/styles.xml', text: stylesXml(opts.currencySymbol) }
    ];
    sheets.forEach(function (s, i) {
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', text: sheetXml(s) });
    });
    var blob = global.ETABSExport.zip(files);
    return new Blob([blob], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  global.ETABSXlsx = {
    build: build,
    S: S,
    ref: ref,
    colLetter: colLetter
  };
})(window);
