/**
 * bg-import-set-scan.js
 *
 * Sucht eine Person in allen Import Set Tables und gibt die Fundstellen als
 * Tabelle -> Spalte -> Beispielwert aus. Grundlage für die Registrierung der
 * betroffenen Staging-Tabellen in der Data Classification (RTBI, DSGVO Art. 15).
 *
 * Verwendung: Inhalt in "Scripts - Background" einfügen (Scope: global),
 * oben USER_SYS_ID und USER_NAME setzen, ausführen.
 *
 * Das Skript liest ausschliesslich. Es legt nichts an und ändert nichts.
 * Die Ausgabe geht bewusst nur nach gs.print (Output-Pane) und NICHT nach
 * gs.info/gs.log - letztere würden die gefundenen Personendaten nach syslog
 * schreiben und genau die Datenspur anlegen, die hier auskunftsfähig gemacht
 * werden soll.
 */
(function () {

    // ===================== Parameter =====================

    var USER_SYS_ID       = '';                 // sys_id aus sys_user (für Kriterium B)
    var USER_NAME         = 'max.mustermann';   // Login-Name (für Kriterium A)
    var VALUE_PREVIEW_LEN = 80;                 // Kürzung der Beispielwerte
    var COLUMN_CHUNK      = 50;                 // Spalten pro Encoded Query

    // =====================================================

    var BASE_TABLE = 'sys_import_set_row';

    var needle    = String(USER_NAME || '').trim();
    var needleLc  = needle.toLowerCase();
    var userSysId = String(USER_SYS_ID || '').trim();

    if (!needle && !userSysId) {
        gs.print('Abbruch: weder USER_NAME noch USER_SYS_ID gesetzt.');
        return;
    }
    if (needle && /[\^=,]/.test(needle)) {
        gs.print('Abbruch: USER_NAME enthält ^ = oder , - die Encoded Query würde zerfallen.');
        return;
    }

    // ---------- Helfer ----------

    function toArray(value) {
        var out = [];
        if (!value) return out;
        if (typeof value.size === 'function') {          // Java-Liste
            for (var i = 0; i < value.size(); i++) out.push(String(value.get(i)));
            return out;
        }
        for (var j = 0; j < value.length; j++) out.push(String(value[j]));
        return out;
    }

    function preview(value) {
        var s = String(value).replace(/[\r\n\t]+/g, ' ');
        return s.length > VALUE_PREVIEW_LEN ? s.substring(0, VALUE_PREVIEW_LEN) + ' ...' : s;
    }

    function pad(value, width) {
        var s = String(value);
        while (s.length < width) s += ' ';
        return s;
    }

    function sortedKeys(obj) {
        var keys = [];
        for (var k in obj) if (obj.hasOwnProperty(k)) keys.push(k);
        return keys.sort();
    }

    /**
     * Fachliche Spalten einer Import Set Table. Alles mit Präfix sys_ fällt weg -
     * das sind genau die von sys_import_set_row geerbten Basisspalten
     * (sys_created_by, sys_import_set, sys_target_sys_id, ...), die für jede
     * Person anschlagen würden, die je einen Import ausgelöst hat.
     */
    function fachColumns(table) {
        var gr = new GlideRecord(table);
        gr.initialize();
        var elements = gr.getElements();
        var cols = [];
        for (var i = 0; i < elements.length; i++) {
            var name = String(elements[i].getName());
            if (name.indexOf('sys_') === 0) continue;
            if (cols.indexOf(name) === -1) cols.push(name);
        }
        return cols;
    }

    // ---------- Tabellen ermitteln ----------

    // getAllExtensions() liefert die komplette Nachkommenschaft. Eine Abfrage auf
    // sys_db_object.super_class=sys_import_set_row würde nur die erste Ebene
    // erwischen - Import Set Tables erben teils voneinander.
    var tables = toArray(new GlideTableHierarchy(BASE_TABLE).getAllExtensions());
    var scanTables = [];
    for (var ti = 0; ti < tables.length; ti++) {
        // Basistabelle auslassen: eine Abfrage darauf liefert die Zeilen aller
        // Kindtabellen und würde jeden Treffer doppeln.
        if (tables[ti] !== BASE_TABLE) scanTables.push(tables[ti]);
    }
    scanTables.sort();

    // ---------- Kriterium B: Target Record ----------

    var targetHits = {};
    var targetNote = '';

    if (!userSysId) {
        targetNote = 'übersprungen: USER_SYS_ID nicht gesetzt.';
    } else if (!new GlideRecord(BASE_TABLE).isValidField('sys_target_sys_id')) {
        targetNote = 'übersprungen: Feld sys_target_sys_id existiert auf ' + BASE_TABLE + ' nicht.';
    } else {
        // Ein einziger Query genügt - über die Basistabelle wird die gesamte
        // Hierarchie erfasst, die konkrete Tabelle liefert getRecordClassName().
        var tgt = new GlideRecord(BASE_TABLE);
        tgt.addQuery('sys_target_sys_id', userSysId);
        tgt.query();
        while (tgt.next()) {
            var cls = String(tgt.getRecordClassName());
            targetHits[cls] = (targetHits[cls] || 0) + 1;
        }
    }

    // ---------- Kriterium A: Feldinhalt ----------

    var fieldHits = {};   // table -> column -> { rows, sample }
    var tableInfo = {};   // table -> { rows, newest, error }

    for (var t = 0; t < scanTables.length; t++) {
        var table = scanTables[t];
        var info = { rows: 0, newest: '', error: '' };
        tableInfo[table] = info;

        try {
            var probe = new GlideRecord(table);
            if (!probe.isValid()) {
                info.error = 'nicht abfragbar';
                continue;
            }

            var agg = new GlideAggregate(table);
            agg.addAggregate('COUNT');
            agg.query();
            if (agg.next()) info.rows = parseInt(agg.getAggregate('COUNT'), 10) || 0;
            if (!info.rows) continue;

            var newest = new GlideRecord(table);
            newest.orderByDesc('sys_created_on');
            newest.setLimit(1);
            newest.query();
            if (newest.next()) info.newest = String(newest.getValue('sys_created_on') || '');

            if (!needle) continue;

            var columns = fachColumns(table);
            if (!columns.length) continue;

            var seen = {};
            for (var c = 0; c < columns.length; c += COLUMN_CHUNK) {
                var chunk = columns.slice(c, c + COLUMN_CHUNK);
                var conditions = [];
                for (var k = 0; k < chunk.length; k++) conditions.push(chunk[k] + 'LIKE' + needle);

                var hitGr = new GlideRecord(table);
                hitGr.addEncodedQuery(conditions.join('^OR'));
                hitGr.query();
                while (hitGr.next()) {
                    var sysId = String(hitGr.getUniqueValue());
                    if (seen[sysId]) continue;   // Zeile kann in mehreren Chunks anschlagen
                    seen[sysId] = true;

                    // Welche Spalte getroffen hat, geht aus dem Query nicht hervor -
                    // deshalb hier über ALLE fachlichen Spalten der Zeile laufen.
                    // toLowerCase hält die Zuordnung konsistent zum case-insensitiven LIKE.
                    for (var f = 0; f < columns.length; f++) {
                        var col = columns[f];
                        var raw = hitGr.getValue(col);
                        if (raw === null || raw === undefined) continue;
                        var val = String(raw);
                        if (val.toLowerCase().indexOf(needleLc) === -1) continue;

                        if (!fieldHits[table]) fieldHits[table] = {};
                        if (!fieldHits[table][col]) fieldHits[table][col] = { rows: 0, sample: preview(val) };
                        fieldHits[table][col].rows++;
                    }
                }
            }
        } catch (e) {
            info.error = String(e);
        }
    }

    // ---------- Ausgabe ----------

    gs.print('');
    gs.print('Import-Set-Scan');
    gs.print('  user_name : ' + (needle || '(nicht gesetzt)'));
    gs.print('  sys_id    : ' + (userSysId || '(nicht gesetzt)'));
    gs.print('  Tabellen  : ' + scanTables.length + ' (Nachkommen von ' + BASE_TABLE + ')');

    gs.print('');
    gs.print('=== A: Treffer über Feldinhalt ===');
    var hitTables = sortedKeys(fieldHits);
    if (!hitTables.length) gs.print('  keine');
    for (var a = 0; a < hitTables.length; a++) {
        var ht = hitTables[a];
        gs.print('');
        gs.print('  ' + ht + '  (' + tableInfo[ht].rows + ' Zeilen gesamt)');
        gs.print('    ' + pad('Spalte', 34) + pad('Zeilen', 8) + 'Beispielwert');
        var cols = sortedKeys(fieldHits[ht]);
        for (var b = 0; b < cols.length; b++) {
            var hit = fieldHits[ht][cols[b]];
            gs.print('    ' + pad(cols[b], 34) + pad(hit.rows, 8) + hit.sample);
        }
    }

    gs.print('');
    gs.print('=== B: Treffer über Target Record ===');
    if (targetNote) {
        gs.print('  ' + targetNote);
    } else {
        var tgtTables = sortedKeys(targetHits);
        if (!tgtTables.length) gs.print('  keine');
        for (var d = 0; d < tgtTables.length; d++) {
            gs.print('  ' + pad(tgtTables[d], 44) + targetHits[tgtTables[d]] + ' Zeilen');
        }
    }

    gs.print('');
    gs.print('=== C: Import Set Tables ohne Treffer ===');
    gs.print('  Hinweis: der Job "Import set deleter" räumt Staging-Zeilen standardmässig');
    gs.print('  nach wenigen Tagen ab. "Kein Treffer, weil leer" ist für die Klassifizierung');
    gs.print('  etwas anderes als "kein Treffer, weil nicht personenbezogen".');
    gs.print('');
    gs.print('  ' + pad('Tabelle', 44) + pad('Zeilen', 10) + 'jüngste Zeile');
    var emptyCount = 0;
    for (var e2 = 0; e2 < scanTables.length; e2++) {
        var st = scanTables[e2];
        if (fieldHits[st] || targetHits[st]) continue;
        var i2 = tableInfo[st];
        if (i2.error) {
            gs.print('  ' + pad(st, 44) + 'FEHLER: ' + i2.error);
            continue;
        }
        if (!i2.rows) { emptyCount++; continue; }
        gs.print('  ' + pad(st, 44) + pad(i2.rows, 10) + i2.newest);
    }
    gs.print('  (' + emptyCount + ' weitere Tabellen sind vollständig leer)');

    gs.print('');
    gs.print('=== D: Kopierliste für die Data Classification ===');
    var all = {};
    for (var g = 0; g < hitTables.length; g++) all[hitTables[g]] = true;
    var tgtKeys = sortedKeys(targetHits);
    for (var h = 0; h < tgtKeys.length; h++) all[tgtKeys[h]] = true;
    var allKeys = sortedKeys(all);
    if (!allKeys.length) gs.print('  keine');
    for (var i3 = 0; i3 < allKeys.length; i3++) gs.print(allKeys[i3]);
    gs.print('');

})();
