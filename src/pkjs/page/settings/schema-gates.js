// src/pkjs/page/settings/schema-gates.js — ES5, PKJS-parsed. The gates and copy links the
// settings schema's modules share, split out of schema.js so the modules that build parts
// of the schema (schema.js, level-rows-schema.js, alerts-schema.js and
// forecast-lines-schema.js) can read them without requiring each other: the named
// showWhen predicates (the setting gates several rows repeat),
// the one-pass gateAll, the link that brings a tab to the front and the link row a reset
// rides. Plain CommonJS with an
// unguarded require(), like schema.js itself (custom-layout-schema.js's precedent): the
// schema is evaluated in PKJS and injected into the page as data, never concatenated into
// it as a flat browser file.
// "A health item can appear in some status slot" — the gate for settings that are
// inert otherwise (the health threshold sub-sections), the rule the slot catalog applies
// (statusLineCatalog.itemAvailable). Deliberately not a Health bar gate: 'slot' mode puts
// health items in the ordinary bars, where their thresholds are just as live.
var HEALTH_SLOT_WHEN = {key: 'healthMode', ne: 'off'};
/**
 * A link in copy that brings a tab to the front (engine.js [data-goto-tab]: from the tab
 * body or from inside a sheet, which closes; never to a tab whose showWhen hides it). Same
 * markup and look as an inline text link (shell.html .txt-link).
 * @param {string} tab The tab's id, e.g. 'alerts'.
 * @param {string} label The link's text (a constant here, printed as is).
 * @param {string} [pane] The pane to open the tab on (a tab with panes, e.g. 'forecast'
 *     on the Graphs tab); without it the tab shows the pane it showed last.
 * @returns {string} The link's HTML.
 */
function tabLink(tab, label, pane) {
    return '<button type="button" class="txt-link" data-goto-tab="' + tab + '"'
        + (pane ? ' data-goto-pane="' + pane + '"' : '') + '>' + label + '</button>';
}
// "The Status bars tab's master Bold row overrides every slot" — statusBoldAll 'all' packs
// the bold cell of EVERY kind as always-bold at blob-build time, and 'off' as Off (bold at
// danger or a reached goal only, as a slot's own Off), both in status-wire.js
// buildSettingsBlob and WITHOUT touching the stored per-kind thresh<Stem>BoldMode values,
// so the per-slot Bold rows go inert (disabledWhen — muted, not hidden) rather than lying
// about being in charge; flipping the master back to 'perSlot' restores their stored
// choices.
var BOLD_MASTER_WHEN = {key: 'statusBoldAll', in: ['off', 'all']};
/**
 * A bar 4 to 6's gate: New status bar made it (view-cycle.js barMade).
 * @param {string} prefix The bar's key prefix, e.g. 'statusBar4'.
 * @returns {Object} showWhen predicate
 */
function extraBarWhen(prefix) {
    return {key: prefix + 'Made', eq: true};
}
// "The theme actually renders color choices" — inlined ~10 times before it had
// a name. (The compound "effectively B&W" check is the BW_LEGEND rows' showWhen in
// schema.js.)
var COLOR_THEME_WHEN = {key: 'theme', nin: ['bw', 'bw-light']};
/**
 * Gate every item that has no showWhen of its own — the sheet and group
 * builders' one-pass idiom: an item added later cannot forget its gate line,
 * and a caller-supplied row that brings its own showWhen keeps it.
 * @param {Object[]} items Schema items (mutated).
 * @param {?Object} gate showWhen predicate, or null for no gate.
 * @returns {Object[]} The same array.
 */
function gateAll(items, gate) {
    if (gate) {
        items.forEach(function (item) {
            item.showWhen = item.showWhen || gate;
        });
    }
    return items;
}
/**
 * A link row (a `button` drawn as a line of link text, engine.js chevronRow): a reset,
 * e.g. the About alerts card's.
 * @param {string} action A registered PConf.actions id, e.g. 'resetOnDemand'.
 * @param {string} label The link's text.
 * @param {boolean} [more] True to fold the link under its card's More options.
 * @returns {Object} Schema item.
 */
function linkRow(action, label, more) {
    var row = {type: 'button', style: 'link', action: action, label: label};
    if (more) { row.more = true; }
    return row;
}

module.exports = {
    HEALTH_SLOT_WHEN: HEALTH_SLOT_WHEN,
    BOLD_MASTER_WHEN: BOLD_MASTER_WHEN,
    extraBarWhen: extraBarWhen,
    COLOR_THEME_WHEN: COLOR_THEME_WHEN,
    gateAll: gateAll,
    tabLink: tabLink,
    linkRow: linkRow
};
