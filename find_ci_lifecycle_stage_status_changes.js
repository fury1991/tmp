/**
 * CIs WITHOUT an asset whose "Life Cycle Stage Status" was updated.
 *
 * Optional:
 *   - REQUIRE_LIFECYCLE_LAST: only track the CI if life_cycle_stage_status was the
 *     LAST changed field among {life_cycle_stage_status, operational_status,
 *     install_status, hardware_status} -> i.e. the legacy states are out of sync.
 *   - SYNC_LEGACY: push the CSDM life cycle values into the legacy state fields via
 *     new LifeCycleUtil().updateFromCSDM(sys_class_name, ciGlideRecord)
 *
 * Where to run: System Definition > Scripts - Background (scope: global)
 * Output: 1) count of CIs per class   2) flat list of all sys_ids
 *
 * Requires field auditing on the CI tables for the audit-based modes.
 */

// ------------------------------- CONFIG -------------------------------
var DAYS          = 30;      // 0 = no time restriction
var FIELD         = 'life_cycle_stage_status';
var LEGACY_FIELDS = ['operational_status', 'install_status', 'hardware_status'];

var USE_AUDIT     = true;    // true  = real "was changed" via sys_audit
                             // false = life_cycle_stage_status filled + sys_updated_on

// Only keep CIs where FIELD was changed AFTER every legacy state field.
// This check always uses the FULL audit history (not limited by DAYS), otherwise a
// legacy change just outside the window would be invisible. Needs USE_AUDIT = true.
var REQUIRE_LIFECYCLE_LAST = true;
// What if FIELD and a legacy field share the exact same timestamp (same transaction)?
//   'legacy'    -> do NOT track (they were synced together)  [recommended]
//   'lifecycle' -> track anyway
var TIE_WINS = 'legacy';

// --- WRITE OPERATION - off by default ---
var SYNC_LEGACY      = false;  // run LifeCycleUtil().updateFromCSDM() on every tracked CI
var SYNC_LIMIT       = 0;      // 0 = no limit. Use e.g. 5 for a first test run.
var SYNC_SUPPRESS_BR = false;  // true = setWorkflow(false) (no business rules/notifications)

var PRINT_SYS_IDS       = true;
var IDS_PER_LINE        = 20;
var CHUNK_SIZE          = 500;
var PRINT_ENCODED_QUERY = true;
// ----------------------------------------------------------------------

var perClass = {};
var allIds   = [];
var skippedNotLast = 0;
var syncUpdated = 0, syncNoChange = 0, syncErrors = 0;

function fromDate() {
    var gdt = new GlideDateTime();
    gdt.addDaysUTC(-DAYS);
    return gdt.getValue();
}

/**
 * For a batch of CI sys_ids: which of the tracked fields changed last?
 * Returns { sys_id: { t: '<timestamp>', fields: { fieldname: true, ... } } }
 */
function buildLastChangeMap(ids) {
    var map = {};
    var watched = [FIELD].concat(LEGACY_FIELDS);

    var au = new GlideRecord('sys_audit');
    au.addQuery('documentkey', 'IN', ids.join(','));
    au.addQuery('fieldname', 'IN', watched.join(','));
    au.orderBy('sys_created_on');            // no date filter on purpose
    au.query();
    while (au.next()) {
        var key = au.getValue('documentkey');
        var ts  = au.getValue('sys_created_on');
        var fn  = au.getValue('fieldname');
        var e   = map[key];
        if (!e || ts > e.t) {
            map[key] = { t: ts, fields: {} };
            map[key].fields[fn] = true;
        } else if (ts == e.t) {
            e.fields[fn] = true;
        }
    }
    return map;
}

function lifecycleWasLast(entry) {
    if (!entry || !entry.fields[FIELD])
        return false;                        // never changed, or a legacy field came later
    var legacyToo = false;
    for (var i = 0; i < LEGACY_FIELDS.length; i++)
        if (entry.fields[LEGACY_FIELDS[i]])
            legacyToo = true;
    if (legacyToo && TIE_WINS == 'legacy')
        return false;                        // changed in the same transaction -> in sync
    return true;
}

function track(sysId, cls) {
    cls = cls || '(empty sys_class_name)';
    perClass[cls] = (perClass[cls] || 0) + 1;
    allIds.push(sysId);
    if (SYNC_LEGACY && (SYNC_LIMIT === 0 || syncUpdated < SYNC_LIMIT))
        syncLegacy(sysId, cls);
}

/**
 * OOTB sync of the legacy state fields from the CSDM life cycle fields.
 * The CI is re-read on its own class table because hardware_status & co. do not
 * exist on the cmdb_ci base table.
 */
function syncLegacy(sysId, cls) {
    var gr = new GlideRecord(cls);
    if (!gr.isValid() || !gr.get(sysId)) {
        syncErrors++;
        return;
    }
    try {
        var util = (typeof LifeCycleUtil != 'undefined')
            ? new LifeCycleUtil()
            : new global.LifeCycleUtil();
        util.updateFromCSDM(cls, gr);

        // updateFromCSDM only sets the values on some versions - persist if still dirty.
        var changed = false;
        for (var i = 0; i < LEGACY_FIELDS.length; i++) {
            var f = LEGACY_FIELDS[i];
            if (gr.isValidField(f) && gr[f].changes())
                changed = true;
        }
        if (changed) {
            if (SYNC_SUPPRESS_BR)
                gr.setWorkflow(false);
            gr.update();
            syncUpdated++;
        } else {
            syncNoChange++;   // either already in sync, or the util wrote it itself
        }
    } catch (e) {
        syncErrors++;
        gs.warn('LifeCycleUtil failed for ' + cls + '/' + sysId + ': ' + e);
    }
}

/** Candidate sys_ids -> CIs without asset -> optional last-change filter -> track. */
function checkChunk(ids) {
    if (!ids.length)
        return;

    var found = [];
    var ci = new GlideRecord('cmdb_ci');
    ci.addQuery('sys_id', 'IN', ids.join(','));
    ci.addNullQuery('asset');                    // "kein Asset"
    // ci.addQuery('install_status', '!=', 7);   // optional: skip retired CIs
    ci.query();
    while (ci.next())
        found.push({ id: ci.getUniqueValue(), cls: ci.getValue('sys_class_name') });

    if (!found.length)
        return;

    if (REQUIRE_LIFECYCLE_LAST) {
        var onlyIds = [];
        for (var a = 0; a < found.length; a++)
            onlyIds.push(found[a].id);
        var lastMap = buildLastChangeMap(onlyIds);
        for (var b = 0; b < found.length; b++) {
            if (lifecycleWasLast(lastMap[found[b].id]))
                track(found[b].id, found[b].cls);
            else
                skippedNotLast++;
        }
    } else {
        for (var c = 0; c < found.length; c++)
            track(found[c].id, found[c].cls);
    }
}

// ---------------------- 1) collect candidate CIs ----------------------
if (REQUIRE_LIFECYCLE_LAST && !USE_AUDIT)
    gs.warn('REQUIRE_LIFECYCLE_LAST needs sys_audit data - the filter is applied, ' +
            'but candidates come from field values only.');

var auditRows = 0, candidates = 0;

if (USE_AUDIT) {
    var seen = {}, buffer = [];
    var au0 = new GlideRecord('sys_audit');
    au0.addQuery('fieldname', FIELD);
    if (DAYS > 0)
        au0.addQuery('sys_created_on', '>=', fromDate());
    au0.orderBy('documentkey');
    au0.query();
    while (au0.next()) {
        auditRows++;
        var k0 = au0.getValue('documentkey');
        if (!k0 || seen[k0])
            continue;
        seen[k0] = true;
        candidates++;
        buffer.push(k0);
        if (buffer.length >= CHUNK_SIZE) {
            checkChunk(buffer);
            buffer = [];
        }
    }
    checkChunk(buffer);

} else {
    var buf2 = [];
    var gr0 = new GlideRecord('cmdb_ci');
    gr0.addNotNullQuery(FIELD);
    gr0.addNullQuery('asset');
    if (DAYS > 0)
        gr0.addQuery('sys_updated_on', '>=', fromDate());
    gr0.query();
    while (gr0.next()) {
        candidates++;
        buf2.push(gr0.getUniqueValue());
        if (buf2.length >= CHUNK_SIZE) {
            checkChunk(buf2);
            buf2 = [];
        }
    }
    checkChunk(buf2);
}

// ------------------------------ 2) output -----------------------------
var win = (DAYS > 0) ? ('last ' + DAYS + ' days') : 'all time';
gs.info('==================================================================');
gs.info('Field: ' + FIELD + ' | Window: ' + win +
        ' | Mode: ' + (USE_AUDIT ? 'sys_audit' : 'field value'));
gs.info('Lifecycle-must-be-last: ' + REQUIRE_LIFECYCLE_LAST +
        (REQUIRE_LIFECYCLE_LAST ? ' (tie -> ' + TIE_WINS + ')' : ''));
if (USE_AUDIT)
    gs.info('Audit entries: ' + auditRows + ' | unique candidate CIs: ' + candidates);
if (REQUIRE_LIFECYCLE_LAST)
    gs.info('Skipped (a legacy field changed later / together): ' + skippedNotLast);
gs.info('CIs WITHOUT asset and with ' + FIELD + ' updated: ' + allIds.length);
if (SYNC_LEGACY)
    gs.info('Sync: updated=' + syncUpdated + ' | no change=' + syncNoChange +
            ' | errors=' + syncErrors);
gs.info('==================================================================');

var classes = [];
for (var cn in perClass)
    classes.push(cn);
classes.sort(function (x, y) { return perClass[y] - perClass[x]; });

gs.info('--- Count per class ---');
for (var i2 = 0; i2 < classes.length; i2++)
    gs.info(pad(classes[i2], 45) + perClass[classes[i2]]);
gs.info(pad('TOTAL', 45) + allIds.length);

if (PRINT_SYS_IDS && allIds.length) {
    gs.info('--- sys_ids (' + allIds.length + ') ---');
    for (var j = 0; j < allIds.length; j += IDS_PER_LINE)
        gs.info(allIds.slice(j, j + IDS_PER_LINE).join(','));
}

if (PRINT_ENCODED_QUERY && allIds.length && allIds.length <= 1000) {
    gs.info('--- encoded query for the cmdb_ci list view ---');
    gs.info('sys_idIN' + allIds.join(','));
}

function pad(s, len) {
    s = String(s);
    while (s.length < len)
        s += ' ';
    return s;
}
