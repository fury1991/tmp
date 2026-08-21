var MockImportSetTable = Class.create();
MockImportSetTable.prototype = {

    /**
     * In-memory stand-in for the GlideImportSetTable object that a script based
     * Data Source (type CUSTOM) hands to the data loader as first parameter.
     *
     * It implements the two methods AbstractLoader.load() and the loaders use -
     * addColumn(name, length) and insert(row) - but writes nothing to the
     * database. Everything is kept in memory and can be printed afterwards, so
     * a loader can be executed from a background script without running an
     * import and without producing import set rows.
     *
     * Beyond recording the calls it reproduces the three things that silently
     * go wrong in a real import set table:
     *  - a row key for which no column exists: the value is dropped
     *  - a value longer than the column: the value is truncated
     *  - a column that is never filled: the column stays empty
     *
     * @param {Object}  [options]
     * @param {String}  [options.tableName]    - Real staging table, used by compareWithTable().
     * @param {Boolean} [options.echo=true]    - Write every call to the system log.
     * @param {Boolean} [options.strict=false] - Throw instead of only recording a finding.
     */
    initialize: function({
        tableName = '',
        echo = true,
        strict = false
    } = {}) {
        this.tableName = tableName;
        this.echo = echo;
        this.strict = strict;

        this.columns = [];
        this.rows = [];
        this.findings = [];
    },

    /* ----------------------------------------------------------------------
     * Simulated GlideImportSetTable API
     * --------------------------------------------------------------------*/

    /**
     * Simulates GlideImportSetTable.addColumn().
     *
     * In the shipped application the columns already exist in the dictionary,
     * so the real call has no effect. Here it always records the column, which
     * makes the column list a loader declares visible.
     *
     * @param {String} columnName - Name as passed by the loader, e.g. 'pdm_env_name'.
     * @param {Number} maxLength  - Maximum length of the column.
     *
     * @returns {String} - Column name the platform would create, e.g. 'u_pdm_env_name'.
     */
    addColumn: function(columnName, maxLength) {
        const existing = this._findColumn(columnName);
        if (existing) {
            this._addFinding('duplicate_column', "addColumn('" + columnName + "') called more than once.");
            return existing.column;
        }

        const column = {
            name: String(columnName),
            column: this._toColumnName(columnName),
            maxLength: parseInt(maxLength, 10) || 0
        };
        this.columns.push(column);

        this._echo("addColumn('" + column.name + "', " + column.maxLength + ") -> " + column.column);
        return column.column;
    },

    /**
     * Simulates GlideImportSetTable.insert().
     *
     * @param {Object} row - Row object as built by the loader.
     *
     * @returns {String} - Fake sys_id of the row that would have been inserted.
     */
    insert: function(row) {
        const entry = {
            sysId: this._newSysId(),
            values: {},
            dropped: {},
            truncated: []
        };

        for (const key in row) {
            const value = this._toStringValue(row[key]);
            const column = this._findColumn(key);

            if (!column) {
                entry.dropped[key] = value;
                this._addFinding('unknown_column', `Row ${this.rows.length + 1}: no column '${key}' - the value would be lost in the real import set table.`);
                continue;
            }

            if (column.maxLength > 0 && value.length > column.maxLength) {
                entry.truncated.push(column.column);
                this._addFinding('truncated_value', `Row ${this.rows.length + 1}: '${key}' is ${value.length} characters, the column allows ${column.maxLength} - the value would be truncated.`);
                entry.values[column.column] = value.substring(0, column.maxLength);
                continue;
            }

            entry.values[column.column] = value;
        }

        this.rows.push(entry);
        this._echo(`insert() -> row ${this.rows.length}: ${JSON.stringify(entry.values)}`);
        return entry.sysId;
    },

    /* ----------------------------------------------------------------------
     * Result access
     * --------------------------------------------------------------------*/

    /**
     * @returns {Array<Object>} - The inserted rows, keyed by the real column names.
     */
    getRows: function() {
        return this.rows.map(function(entry) {
            return entry.values;
        });
    },

    /**
     * @param {Number} [index=0]
     *
     * @returns {Object} - One inserted row, keyed by the real column names.
     */
    getRow: function(index) {
        const entry = this.rows[index || 0];
        return entry ? entry.values : null;
    },

    /**
     * @returns {Number}
     */
    getRowCount: function() {
        return this.rows.length;
    },

    /**
     * @returns {Array<String>} - Column names the loader declared, e.g. 'u_csa_snk'.
     */
    getColumns: function() {
        return this.columns.map(function(column) {
            return column.column;
        });
    },

    /**
     * @param {String} [type] - Optional filter, e.g. 'unknown_column'.
     *
     * @returns {Array<Object>} - Problems detected while inserting.
     */
    getFindings: function(type) {
        if (!type) {
            return this.findings;
        }
        return this.findings.filter(function(finding) {
            return finding.type === type;
        });
    },

    /**
     * Columns that exist but were never filled by any row.
     *
     * @returns {Array<String>}
     */
    getEmptyColumns: function() {
        const rows = this.rows;
        return this.columns.filter(function(column) {
            return !rows.some(function(entry) {
                return entry.values[column.column] !== undefined && entry.values[column.column] !== '';
            });
        }).map(function(column) {
            return column.column;
        });
    },

    /**
     * Compares the declared columns against the dictionary of the real staging
     * table. Only meaningful when a tableName was passed to the constructor.
     *
     * @param {String} [tableName] - Overrides the table name of the constructor.
     *
     * @returns {{table: String, missing: Array<String>, unused: Array<String>}}
     *          - missing: declared by the loader, but not in the dictionary
     *          - unused:  in the dictionary, but not declared by the loader
     */
    compareWithTable: function(tableName) {
        const table = tableName || this.tableName;
        const result = {
            table: table,
            missing: [],
            unused: []
        };
        if (!table) {
            return result;
        }

        const dictionary = [];
        const grDictionary = new GlideRecord('sys_dictionary');
        grDictionary.addQuery('name', table);
        grDictionary.addNotNullQuery('element');
        grDictionary.query();
        while (grDictionary.next()) {
            dictionary.push(String(grDictionary.getValue('element')));
        }

        const declared = this.getColumns();
        result.missing = declared.filter(function(column) {
            return dictionary.indexOf(column) === -1;
        });
        result.unused = dictionary.filter(function(column) {
            return column.indexOf('u_') === 0 && declared.indexOf(column) === -1;
        });

        return result;
    },

    /**
     * Human readable summary of everything that happened.
     *
     * @param {Object}  [options]
     * @param {Number}  [options.maxRows=5]       - Rows printed in full.
     * @param {Boolean} [options.showEmpty=false] - Also print empty values of a row.
     * @param {Boolean} [options.compare=false]   - Include compareWithTable().
     *
     * @returns {String}
     */
    report: function({
        maxRows = 5,
        showEmpty = false,
        compare = false
    } = {}) {
        const lines = [];
        lines.push('--- MockImportSetTable ---');
        lines.push(`Table:   ${this.tableName || '(none)'}`);
        lines.push(`Columns: ${this.columns.length}`);
        lines.push(`Rows:    ${this.rows.length}`);

        this.columns.forEach(function(column) {
            lines.push(`  column ${column.column} (${column.maxLength})`);
        });

        this.rows.slice(0, maxRows).forEach(function(entry, index) {
            lines.push(`  row ${index + 1} (${entry.sysId})`);
            for (const column in entry.values) {
                const value = entry.values[column];
                if (value === '' && !showEmpty) {
                    continue;
                }
                lines.push(`    ${column} = ${value}`);
            }
            for (const key in entry.dropped) {
                lines.push(`    [dropped] ${key} = ${entry.dropped[key]}`);
            }
        });
        if (this.rows.length > maxRows) {
            lines.push(`  ... ${this.rows.length - maxRows} more row(s) not printed.`);
        }

        const empty = this.getEmptyColumns();
        if (empty.length) {
            lines.push(`Never filled: ${empty.join(', ')}`);
        }

        if (compare) {
            const comparison = this.compareWithTable();
            if (comparison.table) {
                lines.push(`Dictionary of ${comparison.table}:`);
                lines.push(`  missing in table:     ${comparison.missing.join(', ') || '-'}`);
                lines.push(`  not filled by loader: ${comparison.unused.join(', ') || '-'}`);
            }
        }

        if (this.findings.length) {
            lines.push(`Findings: ${this.findings.length}`);
            this.findings.forEach(function(finding) {
                lines.push(`  [${finding.type}] ${finding.message}`);
            });
        } else {
            lines.push('Findings: none');
        }

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
     * Reproduces the column name the platform derives from an addColumn() label.
     *
     * @private
     */
    _toColumnName: function(columnName) {
        const normalized = String(columnName).toLowerCase().replace(/[^a-z0-9]+/g, '_');
        return normalized.indexOf('u_') === 0 ? normalized : `u_${normalized}`;
    },

    /**
     * @private
     */
    _findColumn: function(columnName) {
        const column = this._toColumnName(columnName);
        return this.columns.filter(function(candidate) {
            return candidate.column === column;
        })[0] || null;
    },

    /**
     * Import set columns are strings - everything else is converted the way the
     * platform would convert it.
     *
     * @private
     */
    _toStringValue: function(value) {
        if (value === null || value === undefined) {
            return '';
        }
        if (typeof value === 'object') {
            return JSON.stringify(value);
        }
        return String(value);
    },

    /**
     * @private
     */
    _addFinding: function(type, message) {
        this.findings.push({
            type: type,
            message: message
        });
        gs.warn(`${this.type} - ${type}: ${message}`);
        if (this.strict) {
            throw new Error(message);
        }
    },

    /**
     * @private
     */
    _echo: function(message) {
        if (this.echo) {
            gs.info(`${this.type}: ${message}`);
        }
    },

    /**
     * @private
     */
    _newSysId: function() {
        let sysId = '';
        while (sysId.length < 32) {
            sysId += Math.random().toString(16).substring(2);
        }
        return sysId.substring(0, 32);
    },

    type: 'MockImportSetTable'
};
