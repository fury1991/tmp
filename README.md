# Test-Doubles für `AbstractLoader.load(importSetTable, importLog)`

Drei Script Includes, mit denen die `load()`-Methode eines Loaders ausgeführt werden kann,
ohne einen Import zu starten. Beide Übergabeparameter werden simuliert und protokolliert:
Es entstehen **keine** Import-Set-Rows, **keine** Import-Log-Einträge, **keine** Transformation
und **keine** CIs.

**Hinweis:** Die REST-Aufrufe des Loaders laufen unverändert – ein Testlauf erreicht also die
konfigurierten PDM-Instanzen tatsächlich. Simuliert wird ausschließlich die Schreibseite.

## Enthaltene Dateien

| Datei | Simuliert | Ersetzt |
|---|---|---|
| `MockImportSetTable.js` | `addColumn(name, length)`, `insert(row)` | `GlideImportSetTable` (1. Parameter von `load()`) |
| `MockImportLog.js` | `info(msg)`, `warn(msg)`, `error(msg)` | Import-Log-Objekt (2. Parameter von `load()`) |
| `LoaderTestRunner.js` | – | Klammer um beide Mocks inkl. Report |

## Anlegen in ServiceNow

Die Dateien sind reiner Script-Include-Body. Je Datei ein Record unter
`System Definition → Script Includes` mit folgenden Werten anlegen und den Dateiinhalt
in das Feld `Script` einfügen:

| Feld | Wert |
|---|---|
| Name | `MockImportSetTable` / `MockImportLog` / `LoaderTestRunner` |
| Application | `CORP Service Graph Connector for Proxmox VE` |
| Accessible from | `This application scope only` |
| Active | `true` |
| Client callable | `false` |

**Hinweis:** Die Script Includes liegen damit im Scope der Connector-Applikation und werden
mit ausgeliefert. Wenn sie nicht in die Produktion gelangen sollen, empfiehlt sich ein
eigener Update Set bzw. das Setzen von `Active = false` vor der Auslieferung.

## Verwendung

Ausführen über `System Definition → Scripts - Background`, dort den Scope
`CORP Service Graph Connector for Proxmox VE` auswählen.

### Kompletter Lauf des `PDMInstanceLoader`

```javascript
new LoaderTestRunner().runPDMInstanceLoader();
```

Der Report wird in das System Log geschrieben (`System Logs → All`) und enthält:

- das Rückgabeobjekt von `load()` (`total`, `imported`, `rows`, `skipped`, `failed`)
- die per `addColumn()` deklarierten Spalten inkl. der Namen, die die Plattform daraus
  ableiten würde (`pdm_env_name` → `u_pdm_env_name`)
- jede Zeile, die `insert()` erhalten hätte, mit allen Werten
- alle Meldungen, die über den Import Log gelaufen wären

### Beliebiger Loader

```javascript
var runner = new LoaderTestRunner({
    tableName: 'x_crp_corp_sgc_pve_corp_sg_proxmox_ve_pdm_instances',
    maxRows: 10
});

var result = runner.run(function() {
    return new PDMInstanceLoader();
});
```

Wird eine Funktion statt einer Instanz übergeben, fängt der Runner auch Fehler ab, die
bereits im Konstruktor des Loaders auftreten – etwa beim Auflösen der Aliase über
`ConnectionResolver.listUsableAliases()`.

### Nur eine Umgebung testen

`AbstractLoader.initialize()` legt die Alias-Liste als Instanzvariable `aliases` ab. Sie
kann vor dem Lauf eingeschränkt werden:

```javascript
var loader = new PDMInstanceLoader();
loader.aliases = loader.aliases.filter(function(alias) {
    return alias.id === 'x_crp_corp_sgc_pve.PDM_Produktion';
});

new LoaderTestRunner().run(loader);
```

### Auswertung im Script statt im Log

```javascript
var result = new LoaderTestRunner({ report: false }).runPDMInstanceLoader();

gs.info(result.summary.rows);                       // Anzahl Zeilen
gs.info(JSON.stringify(result.importSetTable.getRow(0)));
gs.info(result.importSetTable.getEmptyColumns());    // nie befüllte Spalten
gs.info(result.importLog.isClean());                 // keine warn/error-Meldung
gs.info(result.importLog.contains('finished', 'info'));
```

## Was die Mocks zusätzlich aufdecken

`MockImportSetTable` bildet die drei Fälle nach, die in einer echten Import-Set-Tabelle
stillschweigend passieren, und meldet sie als *Finding*:

| Finding | Bedeutung |
|---|---|
| `unknown_column` | Der Row-Key hat keine per `addColumn()` deklarierte Spalte – der Wert ginge im echten Import verloren |
| `truncated_value` | Der Wert ist länger als die Spalte – er würde abgeschnitten |
| `duplicate_column` | `addColumn()` wurde für dieselbe Spalte mehrfach aufgerufen |

Zusätzlich vergleicht `compareWithTable()` die deklarierten Spalten gegen das Dictionary der
echten Staging-Tabelle und weist aus, welche Spalten dort fehlen und welche vorhandenen
Spalten der Loader nicht befüllt. Der Vergleich läuft automatisch mit, sobald `tableName`
gesetzt ist – bei `runPDMInstanceLoader()` ist das der Fall.

Mit `strict: true` wirft `MockImportSetTable` bei jedem Finding eine Exception, statt sie
nur zu sammeln – nützlich, um einen Testlauf bewusst scheitern zu lassen.
