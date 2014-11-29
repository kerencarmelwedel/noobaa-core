// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var Q = require('q');
var mongoose = require('mongoose');
var rest_api = require('../util/rest_api');
var size_utils = require('../util/size_utils');
var api = require('../api');
var system_server = require('./system_server');
var node_monitor = require('./node_monitor');
var Semaphore = require('noobaa-util/semaphore');
var Agent = require('../agent/agent');
var db = require('./db');


module.exports = new api.node_api.Server({

    // CRUD
    create_node: create_node,
    read_node: read_node,
    update_node: update_node,
    delete_node: delete_node,

    // LIST
    list_nodes: list_nodes,

    // GROUP
    group_nodes: group_nodes,

    // START STOP
    start_nodes: start_nodes,
    stop_nodes: stop_nodes,
    get_agents_status: get_agents_status,

    // AGENT
    heartbeat: heartbeat,

    // NODE VENDOR
    connect_node_vendor: connect_node_vendor,
}, {
    before: function(req) {
        return req.load_account();
    }
});



//////////
// CRUD //
//////////


function create_node(req) {
    var info;

    // admin or create_node roles allowed
    return req.load_system(['admin', 'create_node'])
        .then(function() {
            info = _.pick(req.rest_params,
                'name',
                'is_server',
                'geolocation'
            );
            info.system = req.system.id;
            info.heartbeat = new Date();
            info.storage = {
                alloc: req.rest_params.storage_alloc,
                used: 0,
            };

            var tier_query = {
                system: req.system.id,
                name: req.rest_params.tier,
                deleted: null,
            };

            return db.Tier.findOne(tier_query).exec();
        })
        .then(db.check_not_deleted(req, 'tier'))
        .then(function(tier) {
            info.tier = tier;

            if (String(info.tier.system) !== String(info.system)) {
                console.error('TIER SYSTEM MISMATCH', info);
                throw req.rest_error('tier not found');
            }

            return db.Node.create(info);
        })
        .then(null, db.check_already_exists(req, 'node'))
        .then(function(node) {
            var reply = {};
            if (req.role === 'create_node') {
                reply.token = req.make_auth_token({
                    role: 'agent',
                    ext: {
                        node_id: node.id,
                    }
                });
            }
            return reply;
        });
}


function read_node(req) {
    return req.load_system(['admin'])
        .then(function() {
            return find_node_by_name(req);
        })
        .then(function(node) {
            return get_node_info(node);
        });
}


function update_node(req) {
    return req.load_system(['admin'])
        .then(function() {
            var updates = _.pick(req.rest_params, 'is_server', 'geolocation');
            updates.storage = {
                alloc: req.rest_params.storage_alloc,
            };

            // TODO move node between tiers - requires decomission
            if (req.rest_params.tier) throw req.rest_error('TODO switch tier');

            return db.Node.findOneAndUpdate(get_node_query(req), updates).exec();
        })
        .then(db.check_not_deleted(req, 'node'))
        .thenResolve();
}


function delete_node(req) {
    return req.load_system(['admin'])
        .then(function() {
            var updates = {
                deleted: new Date()
            };
            return db.Node.findOneAndUpdate(get_node_query(req), updates).exec();
        })
        .then(db.check_not_found(req, 'node'))
        .then(function(node) {
            // TODO notify to initiate rebuild of blocks
        })
        .thenResolve();
}




//////////
// LIST //
//////////

function list_nodes(req) {
    return req.load_system(['admin'])
        .then(function() {
            var info = {
                system: req.system.id,
                deleted: null,
            };
            var query = req.rest_params.query;
            var skip = req.rest_params.skip;
            var limit = req.rest_params.limit;
            if (query) {
                if (query.name) {
                    info.name = new RegExp(query.name);
                }
                if (query.tier) {
                    info.tier = query.tier;
                }
                if (query.geolocation) {
                    info.geolocation = new RegExp(query.geolocation);
                }
            }

            var find = db.Node.find(info).sort('-_id');
            if (skip) {
                find.skip(skip);
            }
            if (limit) {
                find.limit(limit);
            }
            return find.exec();
        })
        .then(function(nodes) {
            return {
                nodes: _.map(nodes, get_node_info)
            };
        });
}



///////////
// GROUP //
///////////

function group_nodes(req) {
    return req.load_system(['admin'])
        .then(function() {
            var reduce_sum = size_utils.reduce_sum;
            var group_by = req.rest_params.group_by;
            var by_system = {
                system: req.system.id,
                deleted: null,
            };

            return db.Node.mapReduce({
                query: by_system,
                scope: {
                    group_by: group_by,
                    reduce_sum: reduce_sum,
                },
                map: function() {
                    var key = {};
                    if (group_by.tier) {
                        key.t = this.tier;
                    }
                    if (group_by.geolocation) {
                        key.g = this.geolocation;
                    }
                    var val = {
                        // count
                        c: 1,
                        // allocated
                        a: this.storage.alloc,
                        // used
                        u: this.storage.used,
                    };
                    /* global emit */
                    emit(key, val);
                },
                reduce: function(key, values) {
                    var c = []; // count
                    var a = []; // allocated
                    var u = []; // used
                    values.forEach(function(v) {
                        c.push(v.c);
                        a.push(v.a);
                        u.push(v.u);
                    });
                    return {
                        c: reduce_sum(key, c),
                        a: reduce_sum(key, a),
                        u: reduce_sum(key, u),
                    };
                }
            });
        })
        .then(function(res) {
            console.log('GROUP NODES', res);
            return {
                groups: _.map(res, function(r) {
                    var group = {
                        count: r.value.c,
                        storage: {
                            alloc: r.value.a,
                            used: r.value.u,
                        }
                    };
                    if (r._id.v) {
                        group.vendor = r._id.v;
                    }
                    if (r._id.g) {
                        group.geolocation = r._id.g;
                    }
                    return group;
                })
            };
        });
}



////////////////
// START STOP //
////////////////

function start_nodes(req) {
    var node_names = req.rest_params.nodes;
    return Q.fcall(update_nodes_started_state, req, node_names, true)
        .then(function(nodes) {
            return agent_host_action(nodes, 'start_agent');
        })
        .thenResolve();
}

function stop_nodes(req) {
    var node_names = req.rest_params.nodes;
    return Q.fcall(update_nodes_started_state, req, node_names, false)
        .then(function(nodes) {
            return agent_host_action(nodes, 'stop_agent');
        })
        .thenResolve();
}



// TODO is this still needed as api method?
function get_agents_status(req) {
    var node_names = req.rest_params.nodes;
    return find_nodes_with_vendors(req, node_names)
        .then(function(nodes) {
            return agent_host_action(nodes, 'get_agent_status');
        })
        .then(function(res) {
            return {
                nodes: _.map(res, function(node_res) {
                    var status = false;
                    if (node_res.state === 'fulfilled' &&
                        node_res.value && node_res.value.status) {
                        status = true;
                    }
                    return {
                        status: status
                    };
                })
            };
        });
}



///////////////
// HEARTBEAT //
///////////////

function heartbeat(req) {
    var updates = _.pick(req.rest_params,
        'geolocation',
        'ip',
        'port',
        'device_info'
    );
    updates.ip = (updates.ip && updates.ip !== '0.0.0.0' && updates.ip) ||
        req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress;
    updates.heartbeat = new Date();
    updates.storage = {};
    if (req.rest_params.storage_alloc) {
        updates.storage.alloc = req.rest_params.storage_alloc;
    }

    var agent_storage_used = req.rest_params.storage_used;
    var node;

    return req.load_system(['admin', 'agent'])
        .then(function() {
            return find_node_by_name(req);
        })
        .then(function(node_arg) {
            node = node_arg;
            // TODO CRITICAL need to optimize - we count blocks on every heartbeat...
            return count_node_storage_used(node.id);
        })
        .then(function(storage_used) {
            if (node.storage.used !== storage_used) {
                updates.storage.used = storage_used;
            }
            // the agent's used storage is verified but not updated
            if (agent_storage_used !== storage_used) {
                console.log('NODE agent used storage not in sync',
                    agent_storage_used, 'real', storage_used);
                // TODO trigger a usage check
            }

            if (updates.storage.alloc !== node.storage.alloc) {
                console.log('NODE change allocated storage from',
                    node.storage.alloc, 'to', updates.storage.alloc);
                // TODO agent sends storage_alloc but never reads it so it always overrides it...
                //      so for now we just ignore this change from the agent.
                delete updates.storage.alloc;
            }

            // we log the ip and location updates,
            // probably need to detect nodes that change too rapidly

            if (updates.geolocation !== node.geolocation) {
                console.log('NODE change geolocation from',
                    node.geolocation, 'to', updates.geolocation);
            }
            if (updates.ip !== node.ip || updates.port !== node.port) {
                console.log('NODE change ip:port from',
                    node.ip + ':' + node.port, 'to',
                    updates.ip + ':' + updates.port);
            }

            return db.Node.findByIdAndUpdate(node.id, updates).exec();
        })
        .then(function(node) {
            return get_node_info(node);
        });
}



/////////////////
// NODE VENDOR //
/////////////////

function connect_node_vendor(req) {
    var vendor_info = _.pick(req.rest_params, 'name', 'category', 'kind', 'details');
    vendor_info.system = req.system.id;
    var vendor;

    return Q.fcall(function() {
            if (!vendor_info.name) return;
            return db.Vendor.findOne({
                account: req.account.id,
                name: vendor_info.name,
                deleted: null,
            }).exec();
        })
        .then(function(vendor_arg) {
            if (vendor_arg) {
                return vendor_arg;
            } else {
                return db.Vendor.create(vendor_info);
            }
        })
        .then(null, db.check_already_exists(req, 'vendor'))
        .then(function(vendor_arg) {
            vendor = vendor_arg;

            // find all nodes hosted by this vendor
            return db.Node.find({
                vendor: vendor.id,
                deleted: null,
            }).select('name').exec();
        })
        .then(function(nodes) {
            var node_names = _.pluck(nodes, 'name');
            return agent_host_action(req.account, node_names, 'start_agent');
        })
        .then(function() {
            return _.pick(vendor, 'id', 'name', 'category', 'kind', 'details');
        });
}




///////////
// UTILS //
///////////


function count_node_storage_used(node_id) {
    return Q.when(db.DataBlock.mapReduce({
            query: {
                node: node_id
            },
            map: function() {
                emit('size', this.size);
            },
            reduce: size_utils.reduce_sum
        }))
        .then(function(res) {
            return res && res[0] && res[0].value || 0;
        });
}

function find_nodes_with_vendors(req, node_names) {
    return Q.when(db.Node.find({
            system: req.system.id,
            name: {
                $in: node_names
            },
            deleted: null,
        })
        .populate('vendor')
        .exec());
}


function update_nodes_started_state(req, node_names, started) {
    var nodes;
    return find_nodes_with_vendors(req, node_names)
        .then(function(nodes_arg) {
            nodes = nodes_arg;
            var nodes_to_update = _.compact(_.map(nodes, function(node) {
                if (node.started !== started) {
                    return node;
                }
            }));
            var sem = new Semaphore(3);
            return Q.all(_.map(nodes_to_update, function(node) {
                return sem.surround(function() {
                    var updates = {
                        started: started
                    };
                    return node.update({
                        $set: updates
                    }).exec();
                });
            }));
        })
        .then(function() {
            return agent_host_action(nodes, started ? 'start_agent' : 'stop_agent');
        })
        .thenResolve();
}

function agent_host_action(nodes, func_name) {
    var sem = new Semaphore(3);
    return Q.allSettled(_.map(nodes,
        function(node) {
            return sem.surround(function() {
                var params = {
                    name: node.name,
                };
                if (func_name === 'start_agent') {
                    params.geolocation = node.geolocation;
                }
                return agent_host_caller(node.vendor)[func_name](params);
            });
        }
    ));
}

function agent_host_caller(vendor) {
    if (vendor.kind !== 'agent_host') {
        throw new Error('NODE VENDOR KIND UNIMPLEMENTED - ' + vendor.kind);
    }
    var client = new api.agent_host_api.Client();
    _.each(vendor.info, function(val, key) {
        client.set_option(key, val);
    });
    return client;
}

function get_node_info(node) {
    var info = _.pick(node, 'name', 'geolocation');
    info.ip = node.ip || '0.0.0.0';
    info.port = node.port || 0;
    info.heartbeat = node.heartbeat.toString();
    info.storage = {
        alloc: node.storage.alloc || 0,
        used: node.storage.used || 0,
    };
    info.online = node.heartbeat >= node_monitor.get_minimum_online_heartbeat();
    var vendor_id = node.populated('vendor');
    if (!vendor_id) {
        vendor_id = node.vendor;
    }
    if (vendor_id) {
        info.vendor = vendor_id.toString();
    }
    if (node.vendor_node_id) {
        info.vendor_node_id = node.vendor_node_id;
    }
    info.device_info =
        node.device_info &&
        node.device_info.toObject &&
        node.device_info.toObject() || {};
    return info;
}

function find_node_by_name(req) {
    return Q.when(db.Node.findOne(get_node_query(req)).exec())
        .then(db.check_not_deleted(req, 'node'));
}

function get_node_query(req) {
    return {
        system: req.system.id,
        name: req.rest_params.name,
        deleted: null,
    };
}
