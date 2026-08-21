var MockImportLog = Class.create();
MockImportLog.prototype = {

    /**
     * Stand-in for the import log object that a script based Data Source
     * (type CUSTOM) hands to the data loader as second parameter.
     *
     * Implements the three methods the loaders call and writes nothing to the
     * import_log table - every message goes to the system log instead.
     */
    initialize: function() {},

    /**
     * @param {String} message
     */
    info: function(message) {
        gs.info(`${this.type} - info: ${message}`);
    },

    /**
     * @param {String} message
     */
    warn: function(message) {
        gs.warn(`${this.type} - warn: ${message}`);
    },

    /**
     * @param {String} message
     */
    error: function(message) {
        gs.error(`${this.type} - error: ${message}`);
    },

    type: 'MockImportLog'
};
