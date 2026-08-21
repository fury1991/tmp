var MockImportSetTable = Class.create();
MockImportSetTable.prototype = {

    /**
     * Stand-in for the GlideImportSetTable object that a script based Data
     * Source (type CUSTOM) hands to the data loader as first parameter.
     *
     * Implements the two methods the loaders call and writes nothing to the
     * database - every call is only logged. This allows load() to be executed
     * from a background script without running an import.
     */
    initialize: function() {},

    /**
     * Simulates GlideImportSetTable.addColumn().
     *
     * @param {String} columnName - Name as passed by the loader, e.g. 'pdm_env_name'.
     * @param {Number} maxLength  - Maximum length of the column.
     */
    addColumn: function(columnName, maxLength) {
        gs.info(`${this.type} - addColumn: ${columnName} (${maxLength})`);
    },

    /**
     * Simulates GlideImportSetTable.insert().
     *
     * @param {Object} row - Row object as built by the loader.
     */
    insert: function(row) {
        gs.info(`${this.type} - insert: ${JSON.stringify(row, null, 4)}`);
    },

    type: 'MockImportSetTable'
};
