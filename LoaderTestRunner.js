var LoaderTestRunner = Class.create();
LoaderTestRunner.prototype = {

    /**
     * Runs the load() method of any loader of this connector against
     * MockImportSetTable and MockImportLog instead of against a real import.
     *
     * Nothing is written to the database: no import set rows, no import log
     * entries, no transformation, no CI. The REST calls of the loader are
     * executed normally, so the run does reach the configured PDM instances.
     *
     * @param {Object}  [options]
     * @param {String}  [options.tableName]     - Staging table used for the dictionary comparison.
     * @param {Boolean} [options.echo=false]    - Echo every mock call to the system log while running.
     * @param {Boolean} [options.strict=false]  - Let the mock table throw on a finding.
     * @param {Boolean} [options.report=true]   - Write the report to the system log after the run.
     * @param {Number}  [options.maxRows=5]     - Rows printed in full.
     * @param {Boolean} [options.showEmpty=false] - Also print empty values of a row.
     */
    initialize: function({
        tableName = '',
        echo = false,
        strict = false,
        report = true,
        maxRows = 5,
        showEmpty = false
    } = {}) {
        this.tableName = tableName;
        this.echo = echo;
        this.strict = strict;
        this.report = report;
        this.maxRows = maxRows;
        this.showEmpty = showEmpty;
    },

    /**
     * Runs one loader.
     *
     * @param {Object|Function} loader - Loader instance, or a function returning one.
     *                                   Pass a function to also catch errors that
     *                                   happen in the constructor of the loader,
     *                                   for example while resolving the aliases.
     *
     * @returns {{loader: String, summary: Object, error: String, durationMs: Number,
     *            importSetTable: MockImportSetTable, importLog: MockImportLog}}
     */
    run: function(loader) {
        const importSetTable = new MockImportSetTable({
            tableName: this.tableName,
            echo: this.echo,
            strict: this.strict
        });
        const importLog = new MockImportLog({
            echo: this.echo
        });

        const result = {
            loader: '',
            summary: null,
            error: '',
            durationMs: 0,
            importSetTable: importSetTable,
            importLog: importLog
        };

        const started = new Date().getTime();
        try {
            const instance = typeof loader === 'function' ? loader() : loader;
            result.loader = instance.loaderName || instance.type || 'unknown';
            result.summary = instance.load(importSetTable, importLog);
        } catch (e) {
            result.error = String(e);
            gs.error(`${this.type} - run: ${result.loader || 'loader'} failed (${e})`);
        }
        result.durationMs = new Date().getTime() - started;

        if (this.report) {
            gs.info(this.buildReport(result));
        }

        return result;
    },

    /**
     * Convenience wrapper for the only loader that is implemented today.
     *
     * @returns {Object} - See run().
     */
    runPDMInstanceLoader: function() {
        if (!this.tableName) {
            this.tableName = 'x_crp_corp_sgc_pve_corp_sg_proxmox_ve_pdm_instances';
        }
        return this.run(function() {
            return new PDMInstanceLoader();
        });
    },

    /**
     * Full report of a run: summary of load(), the rows the loader would have
     * inserted, and everything that was logged.
     *
     * @param {Object} result - Return value of run().
     *
     * @returns {String}
     */
    buildReport: function(result) {
        const lines = [];

        lines.push('==========================================================');
        lines.push(`LoaderTestRunner: ${result.loader || '(loader not created)'}`);
        lines.push(`Duration: ${result.durationMs} ms`);

        if (result.error) {
            lines.push(`Aborted:  ${result.error}`);
        }

        if (result.summary) {
            const summary = result.summary;
            lines.push(`Summary:  total ${summary.total}, imported ${summary.imported}, rows ${summary.rows}, skipped ${summary.skipped}, failed ${summary.failed}`);
        }

        lines.push('');
        lines.push(result.importSetTable.report({
            maxRows: this.maxRows,
            showEmpty: this.showEmpty,
            compare: !!this.tableName
        }));

        lines.push('');
        lines.push(result.importLog.report());

        lines.push('==========================================================');

        return lines.join('\n');
    },

    type: 'LoaderTestRunner'
};
