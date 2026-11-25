'use strict';
// The watchface's permissions (package.json pebble.usesPermissions, manifest version 2: SDK 4.44's
// default). With the Pebble app's permissions preview on (Settings › Plugins, to be on for everyone
// in a later release), a version 2 app's PebbleKit JS and settings page reach only the domains its
// Internet entries list, each covering its subdomains, and the app asks before anything else it
// declares (Location, Health). Since app 1.18.0.1 each entry carries a `reason` (a
// short label the user reads wherever they decide) and `required` (installing waits for an
// answer on the required ones; the others are asked about when the app first uses them). One
// entry's reason and required cover all its domains, and the phone lists each domain as a row of
// its own ("Connect to <domain>", the reason under it), so each service has an entry of its own
// whose reason names it ("DWD weather provider", the owner's, 2026-11-14), with a few words more
// only where the name doesn't say what it is for:
// https://developer.repebble.com/guides/plugins/preview/ (Declaring).
//
// package.template.json lists every API host the code requests (test/repo/uses-permissions.test.js
// keeps the list and the code in step).

/**
 * Whether a declared domain covers a host: itself and its subdomains.
 * @param {string} host A hostname.
 * @param {string[]} domains Declared domains.
 * @returns {boolean}
 */
function covered(host, domains) {
  return domains.some((d) => {
    const domain = String(d).toLowerCase().replace(/^\./, '').replace(/\.$/, '');
    return host === domain || host.endsWith('.' + domain);
  });
}

/**
 * The app's own Internet entries (not another plugin's permission of that name).
 * @param {Array<string|Object>} uses usesPermissions.
 * @returns {Object[]} The entries, in order.
 */
function internetEntries(uses) {
  return (uses || []).filter((p) => p && typeof p === 'object' && p.name === 'Internet' && !p.plugin);
}

/**
 * Every domain the Internet entries list, in entry order.
 * @param {Array<string|Object>} uses usesPermissions.
 * @returns {string[]}
 */
function declaredDomains(uses) {
  return internetEntries(uses).reduce((all, p) => all.concat((p.parameters && p.parameters.domains) || []), []);
}

module.exports = { covered, internetEntries, declaredDomains };
