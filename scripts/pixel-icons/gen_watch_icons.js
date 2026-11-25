#!/usr/bin/env node
/**
 * Build the status icons' pixel drawings into the watch (README.md in this folder).
 *
 *   node scripts/pixel-icons/gen_watch_icons.js           write the files below
 *   node scripts/pixel-icons/gen_watch_icons.js --check   exit 1 if any of them is stale
 *
 * From resources/pixel-icons.json, for every icon, one drawing per box (a size keyed
 * `emery-<box>`, the Pebble Time 2; the box is the rows a bar's icon height paints). A drawing is its box: the watch centres it on the text, so
 * its blank rows above and below its ink are its seat, and how tall its ink is, its size.
 *   resources/data/PX_<KEY>_<FAMILY>_<box>.pdc   each drawing in its version (VERSIONS): by
 *                                        default the pixel drawing as 1 px lines through pixel
 *                                        centres (level, upright and 45-degree runs, joined end to
 *                                        end, and single dots), which the watch draws exactly,
 *                                        smoothing on or off; or 3.1.1's icon scaled the old way
 *                                        (old), or a drawing in lines (drawing), by their kept
 *                                        lines; its view box as tall as the drawing's box, as wide
 *                                        as its ink;
 *   package.template.json                one raw resource per drawing;
 *   src/c/layers/status_pixel_icons.generated.h   which drawing each icon id uses at each box
 *                                        (the rain alert's too: status_rain_glyph);
 *   src/pkjs/settings/status-pixels.generated.js   every drawing's pixels, in its box, for the
 *                                        settings page's pictures of the watch (its labels draw
 *                                        outlines: src/pkjs/page/weather/condition-icons.js).
 * The watch draws nothing else: an icon id without a drawing is text only, and a box without one
 * takes the icon's next smaller drawing (status_icon_size.h).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PIXELS = path.join(ROOT, 'resources', 'pixel-icons.json');
const DATA_DIR = path.join(ROOT, 'resources', 'data');
const PACKAGE = path.join(ROOT, 'package.template.json');
const HEADER = path.join(ROOT, 'src', 'c', 'layers', 'status_pixel_icons.generated.h');
const PAGE_PIXELS = path.join(ROOT, 'src', 'pkjs', 'settings', 'status-pixels.generated.js');
// A size's key: its watch family and box.
const SIZE_KEY = /^(emery)-(\d+)$/;
// The versions a size is built in: its pixel drawing; 3.1.1's icon scaled the old way (old); or a
// drawing in lines (drawing). The last two keep their lines in the file, under their name.
const VERSIONS = ['pixel', 'old', 'drawing'];
const PU = 8;

// The icon catalogue: the watch's icon ids each drawing serves
// (status_line.h, status_row_icons.h), by the icon's key.
const ICONS_JSON = path.join(__dirname, 'icons.json');
const ICON_IDS = Object.fromEntries(JSON.parse(fs.readFileSync(ICONS_JSON, 'utf8')).icons.map((i) => [i.key, i.ids]));

/**
 * The set pixels of '#'/'.' rows, moved so the ink starts at (0, 0).
 * @param {!Array<string>} lines The drawing's rows.
 * @returns {!Array<!Array<number>>} [x, y] of each set pixel; empty for a blank drawing.
 */
function inkPixels(lines) {
    const px = boxPixels(lines);
    if (!px.length) return px;
    const y0 = Math.min(...px.map(p => p[1]));
    return px.map(([x, y]) => [x, y - y0]);
}

/**
 * The set pixels of '#'/'.' rows in the drawing's box: moved left so the ink starts at column 0,
 * its rows as they are, so the blank rows above and below the ink stay its seat.
 * @param {!Array<string>} lines The drawing's rows.
 * @returns {!Array<!Array<number>>} [x, y] of each set pixel; empty for a blank drawing.
 */
function boxPixels(lines) {
    const px = [];
    lines.forEach((s, y) => { for (let x = 0; x < s.length; x++) if (s[x] === '#') px.push([x, y]); });
    if (!px.length) return px;
    const x0 = Math.min(...px.map(p => p[0]));
    return px.map(([x, y]) => [x - x0, y]);
}

/**
 * The pixels as runs: level, upright and 45-degree lines through lit pixels only, chosen greedily
 * (the run that covers the most pixels not yet drawn first), so drawing every run lights exactly
 * these pixels. A pixel no run of two reaches is a dot (both ends the same).
 * @param {!Array<!Array<number>>} px [x, y] of each lit pixel.
 * @returns {!Array<!Array<!Array<number>>>} [[x0, y0], [x1, y1]] per run.
 */
function runs(px) {
    const lit = new Set(px.map(([x, y]) => x + ',' + y));
    const todo = new Set(lit);
    const has = (x, y) => lit.has(x + ',' + y);
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    const order = px.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const out = [];
    while (todo.size) {
        let best = null;
        for (const [x, y] of order) {
            if (!todo.has(x + ',' + y)) continue;
            for (const [dx, dy] of dirs) {
                let ax = x, ay = y, bx = x, by = y;
                while (has(ax - dx, ay - dy)) { ax -= dx; ay -= dy; }
                while (has(bx + dx, by + dy)) { bx += dx; by += dy; }
                const len = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) + 1;
                let gain = 0;
                for (let i = 0; i < len; i++) if (todo.has((ax + i * dx) + ',' + (ay + i * dy))) gain++;
                if (!best || gain > best.gain || (gain === best.gain && len > best.len)) {
                    best = { gain, len, ax, ay, dx, dy };
                }
            }
        }
        for (let i = 0; i < best.len; i++) todo.delete((best.ax + i * best.dx) + ',' + (best.ay + i * best.dy));
        out.push([[best.ax, best.ay], [best.ax + (best.len - 1) * best.dx, best.ay + (best.len - 1) * best.dy]]);
    }
    return out;
}

/**
 * The runs joined end to end into open paths: a run that starts where another ends continues it,
 * so the image holds fewer commands (9 bytes each, plus 4 per point) and costs the watch less heap.
 * The pixels stay the same: a path is drawn as its runs, one after another.
 * @param {!Array<!Array<!Array<number>>>} segs runs() of the drawing.
 * @returns {!Array<!Array<!Array<number>>>} The paths' points, [x, y] each.
 */
function paths(segs) {
    const key = (p) => p[0] + ',' + p[1];
    const at = {};
    segs.forEach((s, i) => s.forEach(p => { (at[key(p)] = at[key(p)] || []).push(i); }));
    const used = segs.map(() => false);
    const out = [];
    segs.forEach((seg, i) => {
        if (used[i]) return;
        used[i] = true;
        const pts = seg.slice();
        for (const tail of [true, false]) {
            for (;;) {
                const end = tail ? pts[pts.length - 1] : pts[0];
                const j = at[key(end)].find(q => !used[q]);
                if (j === undefined) break;
                used[j] = true;
                const next = key(segs[j][0]) === key(end) ? segs[j][1] : segs[j][0];
                if (tail) pts.push(next); else pts.unshift(next);
            }
        }
        out.push(pts);
    });
    return out;
}

/**
 * A size's kept lines (an old or drawing version's), a dot as a line of one point twice.
 * @param {string} version 'old' or 'drawing'.
 * @param {?{lines: !Array<!Array<!Array<number>>>, w: number, h: number}} kept The lines the file keeps.
 * @returns {{lines: !Array<!Array<!Array<number>>>, w: number, h: number}}
 */
function keptLines(version, kept) {
    if (!kept) throw new Error('no ' + version + ' version for this size');
    return { lines: kept.lines.map((p) => (p.length === 1 ? [p[0], p[0]] : p)), w: kept.w, h: kept.h };
}

/**
 * A size's kept lines, in the same box as its pixels: the box seats both alike.
 * @param {string} where The icon and size, for the error.
 * @param {string} version 'old' or 'drawing'.
 * @param {!Object} s The size's entry.
 * @returns {{lines: !Array<!Array<!Array<number>>>, w: number, h: number}}
 */
function keptInBox(where, version, s) {
    const v = keptLines(version, s[version]);
    if (v.h !== s.pixels.length) throw new Error(where + ': its ' + version + ' lines are ' + v.h + ' rows tall, its box ' + s.pixels.length);
    return v;
}

/**
 * A PDC image of 1 px open precise paths, its points in pixels (on the 1/8 px grid), pixel (x, y)'s
 * centre at (x + 1/2, y + 1/2).
 * @param {!Array<!Array<!Array<number>>>} lines The paths' points, [x, y] each (paths()).
 * @param {number} w The image's width in pixels, its view box.
 * @param {number} h Its height.
 * @returns {!Buffer} The .pdc file.
 */
function pdc(lines, w, h) {
    const cmds = lines.map((pts) => {
        const b = Buffer.alloc(9 + 4 * pts.length);
        b.writeUInt8(3, 0);        // precise path
        b.writeUInt8(0, 1);        // not hidden
        b.writeUInt8(0xFF, 2);     // stroke colour, recoloured on load
        b.writeUInt8(1, 3);        // stroke width
        b.writeUInt8(0x00, 4);     // fill clear
        b.writeUInt16LE(1, 5);     // open
        b.writeUInt16LE(pts.length, 7);
        pts.forEach(([x, y], k) => {
            b.writeInt16LE(Math.round(x * PU + PU / 2), 9 + 4 * k);
            b.writeInt16LE(Math.round(y * PU + PU / 2), 11 + 4 * k);
        });
        return b;
    });
    const head = Buffer.alloc(8);
    head.writeUInt8(1, 0);         // version
    head.writeUInt8(0, 1);
    head.writeInt16LE(w, 2);
    head.writeInt16LE(h, 4);
    head.writeUInt16LE(cmds.length, 6);
    const body = Buffer.concat([head, ...cmds]);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(body.length, 0);
    return Buffer.concat([Buffer.from('PDCI'), size, body]);
}

/**
 * Every file this generator owns, as {path: Buffer|string}.
 * @param {!Object=} doc resources/pixel-icons.json's content; the file by default.
 * @returns {!Object<string, (!Buffer|string)>} The files' content by absolute path.
 */
function outputs(doc = JSON.parse(fs.readFileSync(PIXELS, 'utf8'))) {
    const files = {};
    const media = [];
    const table = [];        // [icon id, rows, resource]
    for (const key of Object.keys(doc.icons)) {
        if (!ICON_IDS[key]) throw new Error('unknown icon ' + key);
        const sizes = doc.icons[key].sizes;
        for (const id of Object.keys(sizes).sort()) {
            const s = sizes[id];
            const px = boxPixels(s.pixels);
            if (!px.length) continue;
            // As wide as the ink, as tall as the box: the box's blank rows are the seat.
            const w = Math.max(...px.map(p => p[0])) + 1, h = s.pixels.length;
            // The box the watch looks it up by: the rows a bar's icon height paints.
            const m = SIZE_KEY.exec(id);
            if (!m) throw new Error(key + ' ' + id + ': a size is keyed emery-<box>');
            const rows = Number(m[2]);
            if (h % 2 !== 1) throw new Error(key + ' ' + id + ': a drawing\'s box has an odd number of rows, centred on the text');
            const version = s.version || 'pixel';
            if (!VERSIONS.includes(version)) throw new Error(key + ' ' + id + ': unknown version ' + version);
            const res = 'PX_' + key + '_EMERY_' + rows;
            let buf;
            if (version === 'pixel') {
                buf = pdc(paths(runs(px)), w, h);
            } else {
                const v = keptInBox(key + ' ' + id, version, s);
                buf = pdc(v.lines, v.w, v.h);
            }
            files[path.join(DATA_DIR, res + '.pdc')] = buf;
            media.push({ type: 'raw', name: res, file: 'data/' + res + '.pdc' });
            ICON_IDS[key].forEach(icon => table.push([icon, rows, 'RESOURCE_ID_' + res]));
        }
    }
    // package.template.json: the drawings' resources after every other one, in a fixed order.
    const pkg = JSON.parse(fs.readFileSync(PACKAGE, 'utf8'));
    const res = pkg.pebble.resources;
    res.media = res.media.filter(m => !/^PX_/.test(m.name)).concat(media);
    files[PACKAGE] = JSON.stringify(pkg, null, 2) + '\n';
    files[HEADER] = header(table);
    files[PAGE_PIXELS] = pagePixels(doc);
    return files;
}

/**
 * status-pixels.generated.js: every drawing's pixels as the settings page draws them, so its
 * pictures of the watch show what the watch draws: per icon key and size
 * (emery-<box>), the drawing's box as wide as its ink, a row per number (bit x lights
 * column x), its blank rows above and below kept (its seat); and the key each status icon id's
 * drawings are under, by the id's name. ES5, for the page.
 *
 * The page opens as one data: URL that Android caps at 2 MiB (settings-url-budget.test.js), and
 * encodeURIComponent turns every space, comma, colon and bracket into three characters. So each
 * icon's drawings are one string of characters it leaves as they are, which the file unpacks:
 * sizes split by '~', each its id, '!', its width, '!' and its rows split by '.', the numbers in
 * base 36.
 * @param {!Object} doc resources/pixel-icons.json's content.
 * @returns {string} The file.
 */
function pagePixels(doc) {
    const packed = (id, w, rows) => id + '!' + w.toString(36) + '!' + rows.map(r => r.toString(36)).join('.');
    const icons = Object.keys(doc.icons).filter((key) => ICON_IDS[key]).map((key) => {
        const sizes = Object.keys(doc.icons[key].sizes).sort().map((id) => {
            const s = doc.icons[key].sizes[id];
            const px = boxPixels(s.pixels);
            if (!px.length) return null;
            const w = Math.max(...px.map(p => p[0])) + 1;
            const rows = s.pixels.map((_, y) => px.filter(p => p[1] === y).reduce((m, p) => m | (1 << p[0]), 0));
            return packed(id, w, rows);
        }).filter(Boolean);
        return '        ' + key + ": '" + sizes.join('~') + "'";
    });
    const ids = [];
    Object.keys(ICON_IDS).forEach((key) => ICON_IDS[key].forEach((id) => ids.push('        ' + id + ": '" + key + "'")));
    return [
        '// GENERATED by scripts/pixel-icons/gen_watch_icons.js from resources/pixel-icons.json: do not',
        '// edit. Every status icon drawing as the watch draws it, for the settings page\'s pictures of',
        '// the watch (pixel-icon.js):',
        '// per icon and size (emery-<box>), its box as wide as its ink,',
        '// a row per number (bit x lights column x), the blank rows above and below its ink kept, as',
        '// they seat it; and the icon whose drawings each watch icon id takes.',
        '// Packed into characters a URL carries as they are (the page opens as one data: URL):',
        '// sizes split by \'~\', each its id, \'!\', its width, \'!\' and its rows split by \'.\', in base 36.',
        '(function () {',
        '    var PACKED = {',
        icons.join(',\n'),
        '    };',
        '    var ICONS = {};',
        '    Object.keys(PACKED).forEach(function (key) {',
        '        var sizes = ICONS[key] = {};',
        "        PACKED[key].split('~').forEach(function (size) {",
        "            var f = size.split('!');",
        "            sizes[f[0]] = {w: parseInt(f[1], 36), rows: f[2].split('.').map(function (r) { return parseInt(r, 36); })};",
        '        });',
        '    });',
        '    var IDS = {',
        ids.join(',\n'),
        '    };',
        '    var api = {icons: ICONS, ids: IDS};',
        "    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }",
        "    if (typeof window !== 'undefined') { window.StatusPixels = api; }",
        '})();',
        '',
    ].join('\n');
}

/**
 * status_pixel_icons.generated.h: the drawing each icon id uses at each box.
 * @param {!Array<!Array>} table [icon id, rows, resource] per icon drawing.
 * @returns {string} The header.
 */
function header(table) {
    const rows = table.length
        ? table.map(([a, b, c]) => '    { ' + a + ', ' + b + ', PX_RES(' + c.replace(/^RESOURCE_ID_/, '') + ') },').join('\n')
        : '    { 0, 0, 0 },   // none yet';
    return `// GENERATED by scripts/pixel-icons/gen_watch_icons.js from resources/pixel-icons.json: do not
// edit. The status icons drawn pixel by pixel (scripts/pixel-icons/README.md): the drawing each
// icon id uses at each box (the rows a bar's icon height paints), drawn 1:1 by status_row_icons.c
// and centred on the text: a drawing carries its size and seat. The rain alert's buckets take
// theirs by id too (status_rain_glyph). Included by
// status_row_icons.c alone, and by the host test
// test/c/status_icon_drawings_test.c, which defines PX_RES itself.
#pragma once
#include "status_icon_size.h"

#ifndef PX_RES
#define PX_RES(name) RESOURCE_ID_##name
#endif

#define STATUS_PIXEL_ICON_COUNT ${table.length}
static const StatusPixelIcon s_status_pixel_icons[] = {
${rows}
};
`;
}

/**
 * Write the files, or with --check exit 1 when one of them is stale.
 * @returns {void}
 */
function main() {
    const check = process.argv.includes('--check');
    const files = outputs();
    // Drawings no longer built (a size or an icon taken out of the file) leave resources/data.
    const stale = fs.readdirSync(DATA_DIR).filter(f => /^PX_.*\.pdc$/.test(f))
        .map(f => path.join(DATA_DIR, f)).filter(f => !(f in files));
    const changed = Object.keys(files).filter(f => !fs.existsSync(f)
        || !Buffer.from(files[f]).equals(fs.readFileSync(f)));
    if (check) {
        const all = changed.concat(stale).map(f => path.relative(ROOT, f));
        if (all.length) {
            console.error('Stale, run node scripts/pixel-icons/gen_watch_icons.js:\n  ' + all.join('\n  '));
            process.exit(1);
        }
        return;
    }
    changed.forEach(f => fs.writeFileSync(f, files[f]));
    stale.forEach(f => fs.unlinkSync(f));
    const n = Object.keys(files).filter(f => f.endsWith('.pdc')).length;
    console.log('pixel icons: ' + n + ' drawings; wrote ' + changed.length + ' files, removed ' + stale.length);
}

if (require.main === module) main();
module.exports = { outputs, header, pagePixels, runs, paths, pdc, keptLines, inkPixels, boxPixels, VERSIONS, ICON_IDS,
    SIZE_KEY, PACKAGE, HEADER, PAGE_PIXELS, DATA_DIR };
