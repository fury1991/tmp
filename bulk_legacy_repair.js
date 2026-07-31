const rootTable = "cmdb_ci";
const PROP_LAST_SYS_ID = "custom.csdm_repair.last_sys_id";
const BATCH_SIZE = 200; // Nur alle 200 CIs in der DB speichern

const lastSysId = gs.getProperty(PROP_LAST_SYS_ID, "");

const grCI = new GlideRecord(rootTable);
grCI.addEncodedQuery('assetISEMPTY^life_cycle_stageISNOTEMPTY');

if (lastSysId) {
    grCI.addQuery('sys_id', '>', lastSysId);
    gs.info(`Legacy States Bulk Repair - Resuming after SysID: ${lastSysId}`);
}

grCI.orderBy('sys_id');
grCI.query();

var counter = 1;
const max = grCI.getRowCount();
var currentSysId = "";

gs.info(`Legacy States Bulk Repair - Found ${max} remaining CIs`);

while (grCI.next()) {
    currentSysId = grCI.getUniqueValue();
    const currentClass = grCI.getValue('sys_class_name');
    
    gs.info(`Legacy States Bulk Repair - ${counter} / ${max} - Correcting ${grCI.getValue('name')}`);

    grCI.setWorkflow(false);
    new LifeCycleUtil().updateFromCSDM(currentClass, grCI);
    grCI.update();

    // Nur alle X Datensätze die Property aktualisieren
    if (counter % BATCH_SIZE === 0) {
        gs.setProperty(PROP_LAST_SYS_ID, currentSysId);
    }

    counter += 1;
}

// Wenn die Query durchgelaufen ist: Property zurücksetzen, sonst den letzten Stand sichern
if (!grCI.hasNext() && max > 0) {
    gs.setProperty(PROP_LAST_SYS_ID, "");
    gs.info(`Legacy States Bulk Repair - Finished completely. Reset property.`);
} else if (currentSysId) {
    // Sichert den Rest ab, falls mitten im Batch abgebrochen wurde
    gs.setProperty(PROP_LAST_SYS_ID, currentSysId);
}