var LifeCycleLegacyBulkSyncUtil = Class.create();
LifeCycleLegacyBulkSyncUtil.prototype = {

    startTime: null,
    logger: null,
    lifecycleUtil: new LifeCycleUtil(),
    jobCtxMgr: new CMDBJobContextManager(),
    tickPerMinute: 1,
    onlyForNonAssetCI: true,
    stats: {
        recordFetched: 0,
        recordUpdated: 0,
        recordUnchanged: 0,
        totalTimeSpentOnFetchMs: 0,
        totalTimeSpentOnUpdateMs: 0,
        updateRatePerMin: 0,
        fetchRatePerMin: 0,
        processingRatePerMin: 0
    },

    KEY: "csdm.life.cycle.legacy.bulk.sync.job.context",
    MAX_EXECUTION_TIME: parseInt(gs.getProperty("csdm.life.cycle.legacy.bulk.sync.job.execution.time", 600000), 10), // 10 min
    BATCH_SIZE: parseInt(gs.getProperty("csdm.life.cycle.legacy.bulk.sync.job.batch.size", 500), 10),
    LOG_PER_MINUTE: 1, // update log after this many minutes
    TIME_CHECK_INTERVAL: 25, // check the time budget after this many records within a batch
    DEFAULT_ROOT_TABLE: "cmdb_ci",
    SYS_ID: "sys_id",
    SYS_CLASS_NAME: "sys_class_name",
    ASSET: "asset",

    initialize: function(iLogger) {
        if (iLogger)
            this.logger = iLogger;
        else
            this.logger = new GSLog(this.lifecycleUtil.LOG_LEVEL_PROPERTY, this.type);
    },

    /**
     * Bulk sync of the legacy fields (install_status, substatus, ...) from the
     * CSDM life cycle fields, using LifeCycleUtil.updateFromCSDM().
     *
     * This method is re-invocable within the scheduled job: when the execution
     * time budget is exhausted the current position (last processed sys_id) is
     * stored in cmdb_job_context and the next invocation continues from there.
     *
     * @param {String} rootTable table to process, including all its extensions. Defaults to cmdb_ci.
     * @returns {Boolean} true if all records have been processed, false if the job must run again
     */
    run: function(rootTable) {
        this.startTime = new GlideDateTime();
        var jobCtx = null;

        if (!this._preCheck())
            return false;

        try {
            jobCtx = this._getJobContext(rootTable);

            do {
                var timeExpired = this._processNextBatch(jobCtx);
                if (timeExpired) {
                    this.jobCtxMgr.saveJobContext(this.KEY, "", JSON.stringify(jobCtx));
                    this._logStats(this._getTimeSpent());
                    this.logger.logInfo("Time expired for " + this.type + ". It will continue from where it left in next invocation of the JOB. Job Context:" + JSON.stringify(jobCtx));
                    return false;
                }
            } while (jobCtx.isDone === false);

            this.jobCtxMgr.deleteJobContext(this.KEY);
            this._logStats(this._getTimeSpent());
            this.logger.logInfo("JOB: " + this.type + " finished successfully. Legacy fields have been synced from the CSDM life cycle fields for all records of " + jobCtx.rootTable + ". Final state of Job Context:" + JSON.stringify(jobCtx));
            return true;

        } catch (ex) {
            // Keep the job context so that the next invocation resumes instead of starting over.
            if (jobCtx != null)
                this.jobCtxMgr.saveJobContext(this.KEY, "", JSON.stringify(jobCtx));
            this.logger.logErr("Error occurred in " + this.type + ". Job context for KEY: " + this.KEY + " has been kept for the next invocation. VALUE:" + JSON.stringify(jobCtx));
            this.logger.logErr("ERROR:" + ex.message + " STACK_TRACE:" + ex.stack);
            throw ex;
        }
    },

    /**
     * Include CIs that are linked to an asset as well. By default only non asset CIs are processed,
     * because for asset backed CIs the legacy fields are kept in sync with the asset record.
     */
    includeAssetCI: function() {
        this.onlyForNonAssetCI = false;
    },

    /**
     * Reset the job so that the next run starts from the beginning of the table again.
     */
    reset: function() {
        this.jobCtxMgr.deleteJobContext(this.KEY);
    },

    /**
     * Guard rails: reverse sync only makes sense after the life cycle migration
     * and must not run in parallel with the forward bulk population.
     */
    _preCheck: function() {
        if (!this.lifecycleUtil.isLifeCycleMigrationActivated()) {
            this.logger.logWarning(this.type + ": life cycle migration is not activated (" + this.lifecycleUtil.CSDM_LIFE_CYCLE_MIGRATION_ACTIVATED + "), aborting");
            return false;
        }
        if (this.lifecycleUtil.isBulkPopulationActive()) {
            this.logger.logWarning(this.type + ": life cycle bulk population is currently active (" + this.lifecycleUtil.CSDM_LIFE_CYCLE_BULK_POPULATION_ACTIVE + "), aborting to avoid concurrent updates");
            return false;
        }
        return true;
    },

    _getJobContext: function(rootTable) {
        if (gs.nil(rootTable))
            rootTable = this.DEFAULT_ROOT_TABLE;

        if (!new GlideRecord(rootTable).isValid()) {
            var errMsg = this.type + ": invalid rootTable:" + rootTable;
            this.logger.logErr(errMsg);
            throw new Error(errMsg); // throw error so that we can stop processing and deactivate the job
        }

        var jobCtx = this.jobCtxMgr.getJobContextJSONValue(this.KEY);

        if (jobCtx && jobCtx.rootTable != rootTable) {
            this.logger.logWarning(this.type + ": existing job context was created for rootTable:" + jobCtx.rootTable + " but the job is called with rootTable:" + rootTable + ". Starting over.");
            jobCtx = null;
        }

        if (jobCtx) {
            this.logger.logInfo("Reoccurrence of:" + this.type + " Job. Resuming after sys_id:" + jobCtx.lastSysId + " (" + jobCtx.totalProcessed + " records processed so far)");
        } else {
            jobCtx = {
                rootTable: rootTable,
                lastSysId: null,
                isDone: false,
                totalProcessed: 0,
                totalUpdated: 0,
                totalUnchanged: 0
            };
            this.jobCtxMgr.saveJobContext(this.KEY, "", JSON.stringify(jobCtx));
            this.logger.logInfo("First occurrence of:" + this.type + " Job. Starting bulk sync of the legacy fields from the CSDM life cycle fields for " + rootTable);
        }
        return jobCtx;
    },

    /**
     * Fetch the next batch and sync every record of it.
     * @returns {Boolean} true if the execution time budget is exhausted
     */
    _processNextBatch: function(jobCtx) {
        var fetchStart = new GlideDateTime();
        var gr = this._getGlideRecordWithFilter(jobCtx);
        var rowCount = gr.getRowCount();
        this.stats.totalTimeSpentOnFetchMs += this._getTimeSpent(fetchStart);
        this.stats.recordFetched += rowCount;

        var countInBatch = 0;
        while (gr.next()) {
            this._syncRecord(gr, jobCtx);
            jobCtx.lastSysId = gr.getValue(this.SYS_ID);
            countInBatch++;

            // check the time budget within the batch as well, single updates can be slow
            if ((countInBatch % this.TIME_CHECK_INTERVAL) === 0 && this._isTimeExpired())
                return true; // isDone stays false, lastSysId marks the exact position
        }

        // the batch has been fully processed, a partial batch means there is nothing left
        jobCtx.isDone = (rowCount < this.BATCH_SIZE);
        return this._isTimeExpired();
    },

    /**
     * Records are read ordered by sys_id and the last processed sys_id is used as marker.
     * A "life cycle stage is not empty" filter alone would not work as a marker, because the
     * records stay in the result set after they have been synced.
     */
    _getGlideRecordWithFilter: function(jobCtx) {
        var gr = new GlideRecord(jobCtx.rootTable);
        gr.addNotNullQuery(this.lifecycleUtil.LIFE_CYCLE_STAGE);
        gr.addNotNullQuery(this.lifecycleUtil.LIFE_CYCLE_STAGE_STATUS);
        // updateFromCSDM() is a no-op for TBD, so those records are filtered out right away
        gr.addQuery(this.lifecycleUtil.LIFE_CYCLE_STAGE, "!=", this.lifecycleUtil.TBD_VAL.life_cycle_stage);

        if (this.onlyForNonAssetCI === true)
            gr.addNullQuery(this.ASSET);

        if (!gs.nil(jobCtx.lastSysId))
            gr.addQuery(this.SYS_ID, ">", jobCtx.lastSysId);

        gr.orderBy(this.SYS_ID);
        gr.setLimit(this.BATCH_SIZE);
        gr.query();
        return gr;
    },

    /**
     * Sync the legacy fields of a single record. The record is only written when
     * updateFromCSDM() actually changed something.
     */
    _syncRecord: function(gr, jobCtx) {
        var updateStart = new GlideDateTime();
        var currentClass = gr.getValue(this.SYS_CLASS_NAME);

        gr.setWorkflow(false);
        this.lifecycleUtil.updateFromCSDM(currentClass, gr);

        if (this._hasChanges(gr)) {
            gr.update();
            this.stats.recordUpdated++;
            jobCtx.totalUpdated++;
        } else {
            this.stats.recordUnchanged++;
            jobCtx.totalUnchanged++;
        }

        jobCtx.totalProcessed++;
        this.stats.totalTimeSpentOnUpdateMs += this._getTimeSpent(updateStart);
    },

    _hasChanges: function(gr) {
        try {
            var changedFields = GlideScriptRecordUtil.get(gr).getChangedFieldNames();
            return changedFields != null && changedFields.size() > 0;
        } catch (ex) {
            return true; // fail safe: rather write once too often than skip a correction
        }
    },

    _isTimeExpired: function(jobCtx) {
        var timeSpent = this._getTimeSpent();

        if (timeSpent > this.MAX_EXECUTION_TIME)
            return true;

        if (timeSpent > (this.LOG_PER_MINUTE * 60 * 1000) * this.tickPerMinute) {
            // print message after every specified min.
            this._logStats(timeSpent);
            this.tickPerMinute++;
        }
        return false;
    },

    _getTimeSpent: function(iTime) {
        var currTime = new GlideDateTime();
        return currTime.getNumericValue() - (iTime == undefined ? this.startTime.getNumericValue() : iTime.getNumericValue());
    },

    _logStats: function(timeSpent) {
        var timeInMin = timeSpent / 60000;
        this.stats.processingRatePerMin = Math.round(this.stats.recordFetched / timeInMin);
        if (this.stats.totalTimeSpentOnUpdateMs > 0)
            this.stats.updateRatePerMin = Math.round(this.stats.recordUpdated / (this.stats.totalTimeSpentOnUpdateMs / 60000));
        if (this.stats.totalTimeSpentOnFetchMs > 0)
            this.stats.fetchRatePerMin = Math.round(this.stats.recordFetched / (this.stats.totalTimeSpentOnFetchMs / 60000));
        this.logger.logInfo("Stats:" + JSON.stringify(this.stats));
    },

    type: 'LifeCycleLegacyBulkSyncUtil'
};
