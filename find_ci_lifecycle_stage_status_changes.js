/**
 * Find CIs that have NO asset and whose field "Life Cycle Stage Status"
 * (cmdb_ci.life_cycle_stage_status) was updated.
 *
 * Where to run: System Definition > Scripts - Background  (scope: global)
 * Output:  1) count of CIs per class
 *          2) flat list of all sys_ids
 *
 * NOTE: USE_AUDIT = true reads sys_audit, so field auditing must be enabled
 *       for the CI tables (Audit flag on cmdb_ci). If it is not, set
 *       USE_AUDIT = false to fall back to a field-value based detection.
 */

// ------------------------------- CONFIG -------------------------------
var DAYS           = 30;     // 0 = no time restriction (all CIs / all audit history)
var FIELD          = 'life_cycle_stage_status';
var USE_AUDIT      = true;   // true = real "was changed" via sys_audit
                             // false = life_cycle_stage_status not empty + sys_updated_on
var PRINT_SYS_IDS  = true;
var IDS_PER_LINE   = 20;     // keeps the log readable
var CHUNK_SIZE     = 500;    // sys_ids per cmdb_ci query (avoid huge IN clauses)
var PRINT_ENCODED_QUERY = true;  // prints sys_idIN... to paste into a list view
// ----------------------------------------------------------------------

var perClass = {};   // class -> count
var allIds   = [];   // sys_ids of matching CIs

function fromDate() {
    var gdt = new GlideDateTime();
    gdt.addDaysUTC(-DAYS);
    return gdt.getValue();
}

/** Registers a cmdb_ci GlideRecord as a hit. */
function addHit(gr) {
    var cls = gr.getValue('sys_class_name') || '(empty sys_class_name)';
    perClass[cls] = (perClass[cls] || 0) + 1;
    allIds.push(gr.getUniqueValue());
}

/** Checks a batch of sys_ids against cmdb_ci: only CIs without asset survive. */
function checkChunk(ids) {
    if (!ids.length)
        return;
    var ci = new GlideRecord('cmdb_ci');
    ci.addQuery('sys_id', 'IN', ids.join(','));
    ci.addNullQuery('asset');          // "kein Asset"
    // ci.addQuery('install_status', '!=', 7);   // optional: skip retired CIs
    ci.query();
    while (ci.next())
        addHit(ci);
}

// ---------------------- 1) collect candidate CIs ----------------------
var auditRows = 0, uniqueCandidates = 0;

if (USE_AUDIT) {
    var seen = {};
    var buffer = [];

    var au = new GlideRecord('sys_audit');
    au.addQuery('fieldname', FIELD);
    if (DAYS > 0)
        au.addQuery('sys_created_on', '>=', fromDate());
    au.orderBy('documentkey');
    au.query();
    while (au.next()) {
        auditRows++;
        var key = au.getValue('documentkey');
        if (!key || seen[key])
            continue;
        seen[key] = true;
        uniqueCandidates++;
        buffer.push(key);
        if (buffer.length >= CHUNK_SIZE) {
            checkChunk(buffer);
            buffer = [];
        }
    }
    checkChunk(buffer);

} else {
    // Fallback: no audit data. Treat "field is filled and record was touched" as updated.
    var gr = new GlideRecord('cmdb_ci');
    gr.addNotNullQuery(FIELD);
    gr.addNullQuery('asset');
    if (DAYS > 0)
        gr.addQuery('sys_updated_on', '>=', fromDate());
    gr.query();
    while (gr.next()) {
        uniqueCandidates++;
        addHit(gr);
    }
}

// ------------------------------ 2) output -----------------------------
var window = (DAYS > 0) ? ('last ' + DAYS + ' days') : 'all time';
gs.info('==================================================================');
gs.info('Field: ' + FIELD + ' | Window: ' + window +
        ' | Mode: ' + (USE_AUDIT ? 'sys_audit' : 'field value'));
if (USE_AUDIT)
    gs.info('Audit entries: ' + auditRows + ' | unique CIs touched: ' + uniqueCandidates);
gs.info('CIs WITHOUT asset and with updated ' + FIELD + ': ' + allIds.length);
gs.info('==================================================================');

// --- count per class, sorted descending ---
var classes = [];
for (var c in perClass)
    classes.push(c);
classes.sort(function (a, b) { return perClass[b] - perClass[a]; });

gs.info('--- Count per class ---');
for (var i = 0; i < classes.length; i++)
    gs.info(pad(classes[i], 45) + perClass[classes[i]]);
gs.info(pad('TOTAL', 45) + allIds.length);

// --- flat sys_id list ---
if (PRINT_SYS_IDS && allIds.length) {
    gs.info('--- sys_ids (' + allIds.length + ') ---');
    for (var j = 0; j < allIds.length; j += IDS_PER_LINE)
        gs.info(allIds.slice(j, j + IDS_PER_LINE).join(','));
}

if (PRINT_ENCODED_QUERY && allIds.length && allIds.length <= 1000) {
    gs.info('--- encoded query for cmdb_ci list view ---');
    gs.info('sys_idIN' + allIds.join(','));
}

function pad(s, len) {
    s = String(s);
    while (s.length < len)
        s += ' ';
    return s;
}
