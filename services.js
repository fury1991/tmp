var ServiceSubscriptionUtil = Class.create();
ServiceSubscriptionUtil.prototype = {
    initialize: function() {},

/**
     * Retrieves an array of user objects subscribed to a specific Service Offering.
     * Evaluates direct subscriptions, group memberships, companies, departments, and locations.
     * @param {string} offeringId - The sys_id of the Service Offering (service_offering).
     * @param {Object} [options] - Configuration object to toggle subscription types.
     * @param {boolean} [options.users=true] - Include direct user subscriptions.
     * @param {boolean} [options.groups=true] - Include users from subscribed groups.
     * @param {boolean} [options.companies=true] - Include users from subscribed companies.
     * @param {boolean} [options.departments=true] - Include users from subscribed departments.
     * @param {boolean} [options.locations=true] - Include users from subscribed locations.
     * @returns {Array<Object>} An array of user objects: [{sys_id: "...", email: "..."}, ...]
     */
    getSubscribers: function(offeringId, { 
        users = true, 
        groups = true, 
        companies = true, 
        departments = true, 
        locations = true 
    } = {}) {
        if (!offeringId) return []; 

        // Fetch Dynamic Attributes from System Property
        const propValue = gs.getProperty('custom.service_offering.user_attributes', 'user_name,sys_id,source,email');
        
        // Clean the property string
        const attributes = propValue.split(',')
            .map(field => field.trim())
            .filter(field => field.length > 0);

        const userMap = new Map();

        // Fetch Users via Company, Department, or Location
        const orgQueryParts = [];
        
        if (companies) {
            const companyIds = this._getIds('service_subscribe_company', 'service_offering', offeringId, 'core_company');
            if (companyIds.length > 0) orgQueryParts.push(`companyIN${companyIds.join(',')}`);
        }

        if (departments) {
            const deptIds = this._getIds('service_subscribe_department', 'service_offering', offeringId, 'cmn_department');
            if (deptIds.length > 0) orgQueryParts.push(`departmentIN${deptIds.join(',')}`);
        }

        if (locations) {
            const locIds = this._getIds('service_subscribe_location', 'service_offering', offeringId, 'cmn_location');
            if (locIds.length > 0) orgQueryParts.push(`locationIN${locIds.join(',')}`);
        }

        if (orgQueryParts.length > 0) {
            const grUser = new GlideRecord('sys_user');
            grUser.addEncodedQuery(orgQueryParts.join('^OR'));
            grUser.query();
            while (grUser.next()) {
                const sysId = grUser.getUniqueValue();
                if (!userMap.has(sysId)) {
                    userMap.set(sysId, this._extractFields(grUser, '', attributes));
                }
            }
        }

        // Fetch Users via Group Membership
        if (groups) {
            const groupIds = this._getIds('service_subscribe_sys_user_group', 'service_offering', offeringId, 'sys_user_group');
            if (groupIds.length > 0) {
                const grMember = new GlideRecord('sys_user_grmember');
                grMember.addQuery('group', 'IN', groupIds.join(','));
                grMember.query();
                while (grMember.next()) {
                    const sysId = grMember.getValue('user');
                    if (!userMap.has(sysId)) {
                        userMap.set(sysId, this._extractFields(grMember, 'user.', attributes));
                    }
                }
            }
        }

        // Fetch Direct User Subscriptions
        if (users) {
            const grSub = new GlideRecord('service_subscribe_sys_user');
            grSub.addQuery('service_offering', offeringId);
            grSub.query();
            while (grSub.next()) {
                const sysId = grSub.getValue('sys_user');
                if (!userMap.has(sysId)) {
                    userMap.set(sysId, this._extractFields(grSub, 'sys_user.', attributes));
                }
            }
        }

        return Array.from(userMap.values());
    },

    /**
     * Helper method to dynamically extract requested fields, supporting dot-walking.
     * @private
     */
    _extractFields: function(gr, prefix, attributes) {
        const userObj = {};
        attributes.forEach(field => {
            if (prefix) {
                // Extracts via dot-walking (e.g., grMember.getElement('user.user_name'))
                const element = gr.getElement(prefix + field);
                userObj[field] = element ? element.toString() : '';
            } else {
                // Extracts directly from the base table (e.g., grUser.getValue('user_name'))
                userObj[field] = gr.getValue(field) || '';
            }
        });
        return userObj;
    },

    /**
     * Helper method to retrieve an array of IDs from mapping tables.
     * @private
     */
    _getIds: function(table, queryField, queryValue, returnField) {
        const ids = [];
        const gr = new GlideRecord(table);
        gr.addQuery(queryField, queryValue);
        gr.query();
        while (gr.next()) {
            ids.push(gr.getValue(returnField));
        }
        return ids;
    },

    type: 'ServiceSubscriptionUtil'
};
