var MockImportLog = Class.create();
MockImportLog.prototype = {

    /**
     * In-memory stand-in for the import log object that a script based Data
     * Source (type CUSTOM) hands to the data loader as second parameter.
     *
     * It implements the three methods AbstractLoader.load() and the loaders use
     * - info(message), warn(message) and error(message) - but writes nothing to
     * the import_log table. Every message is kept in memory and, unless echo is
     * switched off, additionally written to the system log.
     *
     * @param {Object}  [options]
     * @param {Boolean} [options.echo=true]   - Write every message to the system log.
     * @param {String}  [options.prefix]      - Prefix of the system log messages.
     * @param {Boolean} [options.timestamps=true] - Record a timestamp per message.
     */
    initialize: function({
        echo = true,
        prefix = 'MockImportLog',
        timestamps = true
    } = {}) {
        this.echo = echo;
        this.prefix = prefix;
        this.timestamps = timestamps;

        this.entries = [];
        this.tableName = '';
    },

    /* ----------------------------------------------------------------------
     * Simulated import log API
     * --------------------------------------------------------------------*/

    /**
     * @param {String} message
     */
    info: function(message) {
        this._add('info', message);
    },

    /**
     * @param {String} message
     */
    warn: function(message) {
        this._add('warn', message);
    },

    /**
     * @param {String} message
     */
    error: function(message) {
        this._add('error', message);
    },

    /**
     * Not used by the current loaders, implemented so a future loader that
     * calls it does not fail against the mock.
     *
     * @param {String} tableName
     */
    setTableName: function(tableName) {
        this.tableName = String(tableName);
    },

    /* ----------------------------------------------------------------------
     * Result access
     * --------------------------------------------------------------------*/

    /**
     * @param {String} [level] - Optional filter: 'info', 'warn' or 'error'.
     *
     * @returns {Array<{level: String, message: String, timestamp: String}>}
     */
    getEntries: function(level) {
        if (!level) {
            return this.entries;
        }
        return this.entries.filter(function(entry) {
            return entry.level === level;
        });
    },

    /**
     * @param {String} [level] - Optional filter: 'info', 'warn' or 'error'.
     *
     * @returns {Array<String>} - Only the messages.
     */
    getMessages: function(level) {
        return this.getEntries(level).map(function(entry) {
            return entry.message;
        });
    },

    /**
     * @returns {{info: Number, warn: Number, error: Number, total: Number}}
     */
    getCounts: function() {
        const counts = {
            info: 0,
            warn: 0,
            error: 0,
            total: this.entries.length
        };
        this.entries.forEach(function(entry) {
            counts[entry.level]++;
        });
        return counts;
    },

    /**
     * True when nothing was logged as warn or error.
     *
     * @returns {Boolean}
     */
    isClean: function() {
        const counts = this.getCounts();
        return counts.warn === 0 && counts.error === 0;
    },

    /**
     * Fails the test when a message matching the pattern was not logged.
     * Useful in a background script that asserts a specific loader behaviour.
     *
     * @param {String|RegExp} pattern
     * @param {String}        [level] - Optional level the message must have.
     *
     * @returns {Boolean}
     */
    contains: function(pattern, level) {
        const matcher = pattern instanceof RegExp ? pattern : new RegExp(String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        return this.getMessages(level).some(function(message) {
            return matcher.test(message);
        });
    },

    /**
     * Human readable summary of everything that was logged.
     *
     * @param {Object}  [options]
     * @param {String}  [options.level]         - Only print this level.
     * @param {Boolean} [options.timestamps=false] - Prefix every line with its timestamp.
     *
     * @returns {String}
     */
    report: function({
        level = '',
        timestamps = false
    } = {}) {
        const lines = [];
        const counts = this.getCounts();

        lines.push('--- MockImportLog ---');
        lines.push(`Entries: ${counts.total} (info ${counts.info}, warn ${counts.warn}, error ${counts.error})`);

        this.getEntries(level).forEach(function(entry) {
            const stamp = timestamps && entry.timestamp ? `${entry.timestamp} ` : '';
            lines.push(`  ${stamp}[${entry.level}] ${entry.message}`);
        });

        return lines.join('\n');
    },

    /**
     * Writes report() to the system log.
     *
     * @param {Object} [options] - See report().
     */
    printReport: function(options) {
        gs.info(this.report(options));
    },

    /* ----------------------------------------------------------------------
     * Internals
     * --------------------------------------------------------------------*/

    /**
     * @private
     */
    _add: function(level, message) {
        const entry = {
            level: level,
            message: String(message),
            timestamp: this.timestamps ? new GlideDateTime().getDisplayValue() : ''
        };
        this.entries.push(entry);

        if (!this.echo) {
            return;
        }

        const line = `${this.prefix} [${level}]: ${entry.message}`;
        if (level === 'error') {
            gs.error(line);
        } else if (level === 'warn') {
            gs.warn(line);
        } else {
            gs.info(line);
        }
    },

    type: 'MockImportLog'
};
