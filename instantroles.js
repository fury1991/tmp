var CORPInstantRole = Class.create();
CORPInstantRole.prototype = {
    initialize: function() {
        this.type = 'CORPInstantRole';
    },

    // ==========================================
    // PUBLIC API
    // ==========================================

    /**
     * Public method to add one or multiple roles to a user.
     * @param {string|GlideUser} userRef - Sys_id of the user OR a GlideUser object.
     * @param {string|Array} roleRefs - A single role name/sys_id OR an array of role names/sys_ids.
     * @returns {boolean} True if successful.
     */
    addRoles: function(userRef, roleRefs) {
        return this._processAccessRequest('grant', userRef, { roles: roleRefs });
    },

    /**
     * Public method to remove one or multiple roles from a user.
     * @param {string|GlideUser} userRef - Sys_id of the user OR a GlideUser object.
     * @param {string|Array} roleRefs - A single role name/sys_id OR an array of role names/sys_ids.
     * @returns {boolean} True if successful.
     */
    removeRoles: function(userRef, roleRefs) {
        return this._processAccessRequest('revoke', userRef, { roles: roleRefs });
    },

    /**
     * Public method to add a user to one or multiple groups.
     * @param {string|GlideUser} userRef - Sys_id of the user OR a GlideUser object.
     * @param {string|Array} groupRefs - A single group name/sys_id OR an array of group names/sys_ids.
     * @returns {boolean} True if successful.
     */
    addGroups: function(userRef, groupRefs) {
        return this._processAccessRequest('grant', userRef, { groups: groupRefs });
    },

    /**
     * Public method to remove a user from one or multiple groups.
     * @param {string|GlideUser} userRef - Sys_id of the user OR a GlideUser object.
     * @param {string|Array} groupRefs - A single group name/sys_id OR an array of group names/sys_ids.
     * @returns {boolean} True if successful.
     */
    removeGroups: function(userRef, groupRefs) {
        return this._processAccessRequest('revoke', userRef, { groups: groupRefs });
    },

    // ==========================================
    // CORE ENGINE
    // ==========================================

    /**
     * Core handler engine that normalizes inputs and routes to the correct DB operations.
     * @private
     * @param {string} action - 'grant' or 'revoke'
     * @param {string|GlideUser} userRef - The user reference
     * @param {Object} options - { roles: [...], groups: [...] }
     * @returns {boolean} True if successful.
     */
    _processAccessRequest: function(action, userRef, options) {
        try {
            var userSysId = this._resolveUserSysId(userRef);
            if (!userSysId) {
                gs.error(`[${this.type}] Invalid User Reference provided.`);
                return false;
            }

            var accessUpdated = false;

            // 1. Process Roles
            if (options.roles) {
                var roleSysIds = this._resolveRoleSysIds(options.roles);
                if (roleSysIds.length > 0) {
                    if (action === 'grant' && this._grantRoles(userSysId, roleSysIds)) accessUpdated = true;
                    if (action === 'revoke' && this._revokeRoles(userSysId, roleSysIds)) accessUpdated = true;
                }
            }

            // 2. Process Groups
            if (options.groups) {
                var groupSysIds = this._resolveGroupSysIds(options.groups);
                if (groupSysIds.length > 0) {
                    if (action === 'grant' && this._grantGroups(userSysId, groupSysIds)) accessUpdated = true;
                    if (action === 'revoke' && this._revokeGroups(userSysId, groupSysIds)) accessUpdated = true;
                }
            }

            // 3. Trigger Session Refresh (Only if DB was modified)
            if (accessUpdated) {
                this._refreshUserSession(userSysId);
            }

            return true;
        } catch (e) {
            gs.error(`[${this.type}] _processAccessRequest Failed: ${e.message}`);
            return false;
        }
    },

    /**
     * Standardizes the user input into a sys_id.
     * @private
     */
    _resolveUserSysId: function(userRef) {
        if (!userRef) return null;
        if (typeof userRef === 'string') return userRef; 
        if (typeof userRef.getID === 'function') return userRef.getID(); 
        return null;
    },

    // ==========================================
    // ROLE DB OPERATIONS (sys_user_role / sys_user_has_role)
    // ==========================================

    _resolveRoleSysIds: function(refs) {
        var refArray = Array.isArray(refs) ? refs : [refs];
        var finalSysIds = [];
        var namesToQuery = [];

        refArray.forEach(function(ref) {
            if (!ref) return;
            if (ref.length === 32 && /^[0-9a-f]{32}$/i.test(ref)) finalSysIds.push(ref);
            else namesToQuery.push(ref);
        });

        if (namesToQuery.length > 0) {
            var grRole = new GlideRecord('sys_user_role'); 
            grRole.addQuery('name', 'IN', namesToQuery);
            grRole.query();
            while (grRole.next()) finalSysIds.push(grRole.getUniqueValue());
        }
        return finalSysIds;
    },

    _grantRoles: function(userSysId, roleSysIds) {
        var updated = false;
        roleSysIds.forEach(function(targetRoleSysId) {
            var grUserRole = new GlideRecord('sys_user_has_role'); 
            grUserRole.addQuery('user', userSysId);
            grUserRole.addQuery('role', targetRoleSysId);
            grUserRole.query();
            
            if (!grUserRole.hasNext()) { 
                grUserRole.initialize();
                grUserRole.setValue('user', userSysId);
                grUserRole.setValue('role', targetRoleSysId);
                if (grUserRole.insert()) updated = true;
            }
        });
        return updated;
    },

    _revokeRoles: function(userSysId, roleSysIds) {
        var updated = false;
        var grUserRole = new GlideRecord('sys_user_has_role'); 
        grUserRole.addQuery('user', userSysId);
        grUserRole.addQuery('role', 'IN', roleSysIds);
        grUserRole.query();
        
        while (grUserRole.next()) {
            grUserRole.deleteRecord();
            updated = true;
        }
        return updated;
    },

    // ==========================================
    // GROUP DB OPERATIONS (sys_user_group / sys_user_grmember)
    // ==========================================

    _resolveGroupSysIds: function(refs) {
        var refArray = Array.isArray(refs) ? refs : [refs];
        var finalSysIds = [];
        var namesToQuery = [];

        refArray.forEach(function(ref) {
            if (!ref) return;
            if (ref.length === 32 && /^[0-9a-f]{32}$/i.test(ref)) finalSysIds.push(ref);
            else namesToQuery.push(ref);
        });

        if (namesToQuery.length > 0) {
            var grGroup = new GlideRecord('sys_user_group'); 
            grGroup.addQuery('name', 'IN', namesToQuery);
            grGroup.query();
            while (grGroup.next()) finalSysIds.push(grGroup.getUniqueValue());
        }
        return finalSysIds;
    },

    _grantGroups: function(userSysId, groupSysIds) {
        var updated = false;
        groupSysIds.forEach(function(targetGroupSysId) {
            var grMember = new GlideRecord('sys_user_grmember'); 
            grMember.addQuery('user', userSysId);
            grMember.addQuery('group', targetGroupSysId);
            grMember.query();
            
            if (!grMember.hasNext()) { 
                grMember.initialize();
                grMember.setValue('user', userSysId);
                grMember.setValue('group', targetGroupSysId);
                if (grMember.insert()) updated = true;
            }
        });
        return updated;
    },

    _revokeGroups: function(userSysId, groupSysIds) {
        var updated = false;
        var grMember = new GlideRecord('sys_user_grmember'); 
        grMember.addQuery('user', userSysId);
        grMember.addQuery('group', 'IN', groupSysIds);
        grMember.query();
        
        while (grMember.next()) {
            grMember.deleteRecord();
            updated = true;
        }
        return updated;
    },

    // ==========================================
    // SYSTEM OPERATIONS
    // ==========================================

    /**
     * Refreshes the user session via undocumented GlideSecurityManager.
     * @private
     * @param {string} userSysId 
     */
    _refreshUserSession: function(userSysId) {
        gs.debug(`[${this.type}] _refreshUserSession: Refreshing session for '${userSysId}'`);
        try {
            var guObject = gs.getUser().getUserByID(userSysId);
            if (guObject) {
                GlideSecurityManager.get().setUser(guObject);
                gs.getSession().loadUserByID(userSysId);
                gs.info(`[${this.type}] Successfully refreshed session for user: ${userSysId}`);
            }
        } catch (e) {
            gs.error(`[${this.type}] _refreshUserSession Error: ${e.message}`);
        }
    }
};
