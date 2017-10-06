/* Copyright (C) 2016 NooBaa */
'use strict';

const api = require('../../api');
const P = require('../../util/promise');
const promise_utils = require('../../util/promise_utils');
const s3ops = require('../qa/s3ops');
const ops = require('../system_tests/basic_server_ops');
const AzureFunctions = require('../../deploy/azureFunctions');
const cloudCD = require('cloud-cd');
const path = require('path');
const request = require('request');
const fs = require('fs');
const _ = require('lodash');
const argv = require('minimist')(process.argv);

const provider = 'azure-v2';
//var subscription = 'a3556050-2d88-42a4-a4e3-f0a2087edc60';
const resourceGroup = argv.resource || 'qa-upgrade-test';
const lastUpgradePack = argv.last_upgrade_pack;

const YELLOW = "\x1b[33;1m";
const RED = "\x1b[31m";
const NC = "\x1b[0m";

//var clientId = "199522b3-407d-45eb-b7fb-023d21ab6406";
//var secret = "20ef99ce";
//var domain = "noobaa.com";

const location = argv.location || 'westus2';
const storage = argv.storage || 'qaupgradeserverdisk';

const clientId = process.env.CLIENT_ID;
const domain = process.env.DOMAIN;
const secretApp = process.env.APPLICATION_SECRET;
const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;

/*
var service = {
    clientId: clientId,
    secret: secret,
    domain: domain
};
*/
/*
var connection = {
    provider: provider,
    subscriptionId: subscriptionId,
    resourceGroup: resourceGroup,
    servicePrincipal: service
};
*/
var timestamp = (Math.floor(Date.now() / 1000));
var vnet = argv.vnet || 'qa-upgrade-vnet';
var noobaa_server = {
    name: 'qa-upgrade-server',
    flavor: 'Standard_A2_v2',
    username: 'notadmin',
    password: 'Passw0rd123!',

    storageOSDiskName: 'osdisk-noobaa' + timestamp,
    storageAccountName: storage,

    vnetName: vnet,
    osType: 'Linux',
};

var noobaa_agent = {
    name: 'qa-upgrade-agent',
    flavor: 'Standard_A2_v2',
    username: 'notadmin',
    password: 'Passw0rd123!',

    storageOSDiskName: 'osdisk-linux' + timestamp,
    storageAccountName: storage,

    vnetName: vnet,
    osType: 'Linux',
    imagePublisher: "Canonical",
    imageOffer: "UbuntuServer",
    imageSku: "16.04.0-LTS",
    imageVersion: "latest"
};

var basic_tar_uri = 'https://qaupgrade.blob.core.windows.net/tar-files/';
var version_map_tar = {
    //'1.4.1': 'noobaa-NVA-1.4.1-e9ba76d.tar.gz', //azure ver: 14.6.17
    '1.6.1': 'noobaa-NVA-1.6.1-d4a7fb7.tar.gz',
    '1.7.0': 'noobaa-NVA-1.7.0-72af55b.tar.gz',
    '1.9.4': 'noobaa-NVA-1.9.4-fc230d5.tar.gz',
    '1.13.0': 'noobaa-NVA-1.13.0-1e1c317.tar.gz',
    '2.0.0': 'noobaa-NVA-2.0.0-45e4af1.tar.gz'
};

var basic_vhd_uri = 'https://qaupgrade.blob.core.windows.net/vhd-images/';
// the images of the installations.
var version_map_vhd = {
  //  '0.8.0': 'NooBaa-0.8.0-demo.vhd',
    '1.4.1': 'NooBaa-1.4.1-demo.vhd',
   // '1.6.1': 'NooBaa-1.6.1-demo.vhd', not exist
   // '1.7.0': 'NooBaa-1.7.0-demo.vhd', not exist
    '1.9.4': 'noobaa-1.9.4-demo.vhd',
};

var destroyOption = {
    destroyNics: true,
    destroyPublicIP: true,
    destroyVnet: false,
    destroyStorage: false,
    destroyFileOSDisk: true,
    destroyFileDataDisk: false
};

var procedure = [

    /*{
        "base_version": "0.8.0",
        "versions_list": ["1.9.4"]
    },
    */
    {
        "base_version": "1.4.1",
        "versions_list": ["1.9.4"]
    },
    {
        "base_version": "1.6.1",
        "versions_list": ["1.9.4"]
    },
    {
        "base_version": "1.7.0",
        "versions_list": ["1.9.4"]
    }
];

var test = './src/test/qa/agents_matrix.js';
var args = [
    '--location', location,
    '--resource', resourceGroup,
    '--storage', storage,
    '--vnet', vnet,
    '--skipsetup'
];

const oses = [
    'ubuntu12', 'ubuntu14', 'ubuntu16',
    'centos6', 'centos7',
    'redhat6', 'redhat7',
    'win2008', 'win2012', 'win2016'
];

var errors = false;
var file_path;

let server = {
    name: 'UpgradeTestService',
    ip: '',
    secret: '',
};

let failures_in_test;
let azf = new AzureFunctions(clientId, domain, secretApp, subscriptionId, resourceGroup, location);

function saveErrorAndResume(message) {
    console.error(message);
    errors.push(message);
}

function createNewService() {
    return azf.createServer(server.name, vnet, storage)
        .then(new_secret => {
            server.secret = new_secret;
            return azf.getIpAddress(server.name + '_pip');
        })
        .then(ip => {
            console.log(`${YELLOW}${server.name} ip is: ${server.ip}${NC}`);
            server.ip = ip;
        })
        .catch(err => {
            saveErrorAndResume('Can\'t create server and upgrade servers', err);
            failures_in_test = true;
            throw err;
        });
}

function upgradeService(upgrade_pack) {
    let version = upgrade_pack.substring('noobaa-NVA-'.length, '.tar.gz'.length);
    if (!_.isUndefined(upgrade_pack)) {
        return ops.upload_and_upgrade(server.ip, upgrade_pack)
            .then(() => ops.wait_for_server(server.ip, version));
    }
}

function deleteAgents() {
    return P.map(oses, osname => azf.deleteVirtualMachine(osname))
        .catch(err => {
            console.warn(`Deleting agents is FAILED `, err);
        });
}

function cleanEnv() {
    return azf.deleteVirtualMachine(server.name)
        .catch(err => console.log(`Can't delete old server ${err.message}`))
        .then(() => deleteAgents());
}

return azf.authenticate()
    .then(() => cleanEnv())
    .then(() => createNewService())
    .then(() => P.each(version_map_tar, pack => {
        let tar_file = azf.getBlobFile(basic_tar_uri, version_map_tar[pack]);
        upgradeService(tar_file);
    }))
    .then(() => upgradeService(lastUpgradePack))
    .catch(err => {
        console.error('something went wrong :(' + err + errors);
        failures_in_test = true;
    })
    .then(() => {
        if (failures_in_test) {
            console.error(':( :( Errors during cluster test ): ):' + errors);
            process.exit(1);
        }
        console.log(':) :) :) cluster test were successful! (: (: (:');

        process.exit(0);
        // return clean ? cleanEnv() : console.log('Clean env is ', clean);
    });

/*
function clean_old_machines(machine_name) {
    noobaa_server.name = machine_name;
    var destroyVMClient = new cloudCD.DestroyVMAction(connection);
    return P.fromCallback(callback => destroyVMClient.perform(noobaa_server, destroyOption, callback))
        .catch(err => {
            console.log('VM wasn\'t found', err.message);
        })
        .then(() => P.each(oses, osname => {
            console.log('Removing agents:', osname);
            var destroyVMagent = new cloudCD.DestroyVMAction(connection);
            var os = azf.getImagesfromOSname(osname);
            noobaa_agent.name = (machine_name + os.offer.substring(0, 1) + os.sku.substring(0, 4))
                .replace(new RegExp('\\.', 'g'), '-').toLowerCase();
            return P.fromCallback(callback => destroyVMagent.perform(noobaa_agent, destroyOption, callback))
                .catch(err => {
                    console.log('VM wasn\'t found', err.message);
                });
        }));
}

return P.each(procedure, upgrade_procedure => {
        var machine_name = 'u' + upgrade_procedure.base_version.replace(new RegExp('\\.', 'g'), '-');
        var machine_ip = '52.229.30.76'; // the ip of the machine was just created
        var base64;
        console.log('Removing old running machine if exist');
        return clean_old_machines(machine_name)
            .then(() => {
                console.log('Creating new server of version ', upgrade_procedure.base_version);
                var createVMClient = new cloudCD.CreateVMAction(connection);
                noobaa_server.storageOSDiskName = machine_name + '-osdisk' + timestamp;
                var uri = basic_vhd_uri + version_map_vhd[upgrade_procedure.base_version];
                noobaa_server.imageSourceUri = uri;
                return P.fromCallback(callback => createVMClient.perform(noobaa_server, callback));
            })
            .then(machine => {
                console.log('The server created is', machine.hostname);
                machine_ip = machine.hostname;
                return P.delay(10000);
            })
            .then(() => {
                var rpc = api.new_rpc('wss://' + machine_ip + ':8443');
                rpc.disable_validation();
                var client = rpc.new_client({});
                return P.fcall(() => {
                        var auth_params = {
                            email: 'demo@noobaa.com',
                            password: 'DeMo1',
                            system: 'demo'
                        };
                        return client.create_auth_token(auth_params);
                    })
                    .then(() => P.resolve(client.system.read_system({})))
                    .then(result => {
                        var agent_conf = {
                            address: result.base_address,
                            system: result.name,
                            access_key: '123',
                            secret_key: 'abc',
                            tier: 'nodes',
                            root_path: './noobaa_storage/'
                        };
                        base64 = Buffer.from(JSON.stringify(agent_conf)).toString('base64');
                        console.log('BASE64:', base64);
                    })
                    .then(() => P.each(oses, osname => {
                        console.log('Adding agent', osname);
                        var createVMagent = new cloudCD.CreateVMAction(connection);
                        var os = azf.getImagesfromOSname(osname);
                        noobaa_agent.name = (machine_name + os.offer.substring(0, 1) + os.sku.substring(0, 4))
                            .replace(new RegExp('\\.', 'g'), '-').toLowerCase();
                        noobaa_agent.storageOSDiskName = machine_name + osname + '-osdisk' + timestamp;
                        noobaa_agent.imagePublisher = os.publisher;
                        noobaa_agent.imageOffer = os.offer;
                        noobaa_agent.imageSku = os.sku;
                        noobaa_agent.osType = os.osType;
                        noobaa_agent.imageVersion = 'latest';
                        return P.fromCallback(callback => createVMagent.perform(noobaa_agent, callback))
                            .delay(10000)
                            .then(() => {
                                var remoteExecuteClient = new cloudCD.RemoteExecute(connection);
                                var ssh_script = path.join(__dirname, '/../../deploy/init_agent.sh');
                                if (os.osType === 'Windows') {
                                    ssh_script = path.join(__dirname, '/../../deploy/init_agent.ps1');
                                }
                                var args2 = machine_ip + ' ' + base64;
                                return P.fromCallback(callback => remoteExecuteClient.perform(noobaa_agent, {
                                    script: ssh_script,
                                    args: args2
                                }, callback));
                            });
                    }))
                    .delay(120000)
                    .then(() => P.each(upgrade_procedure.versions_list, version => {
                        console.log('Upgrading to', version);
                        return s3ops.put_file_with_md5(machine_ip, 'first.bucket', '20MBFile-' + version, 5, 1048576)
                            .then(filepath => {
                                file_path = filepath;
                                var file = fs.createWriteStream(version_map_tar[version]);
                                return new P((resolve, reject) => {
                                    request.get({
                                            url: basic_tar_uri + version_map_tar[version],
                                            rejectUnauthorized: false
                                        })
                                        .pipe(file)
                                        .on('error', reject)
                                        .on('finish', resolve);
                                });
                            })
                            .then(() => rpc.disconnect_all())
                            .then(() => {
                                ops.disable_rpc_validation();
                                return P.resolve(ops.upload_and_upgrade(machine_ip, version_map_tar[version]));
                            })
                            .then(() => {
                                console.log('Upgrade successful, waiting on agents to upgrade');
                                return P.resolve(ops.wait_on_agents_upgrade(machine_ip));
                            })
                            .then(() => {
                                console.log('Verifying download of 20MB file', file_path);
                                return s3ops.get_file_check_md5(machine_ip, 'first.bucket', '20MBFile-' + version);
                            })
                            .then(() => {
                                console.log('Running the desired external test', test);
                                args = args.concat(['--server_ip', machine_ip]);
                                return promise_utils.fork(test, args)
                                    .then(() => {
                                        console.log('Upgrading was successful');
                                        return clean_old_machines(machine_name);
                                    })
                                    .catch(err => {
                                        console.log('Upgrade failed', err.message);
                                        errors = true;
                                    });
                            });
                    }));
            });
    })
    .then(() => {
        if (errors) {
            console.error(':( :( Errors during upgrades ): ):');
            process.exit(1);
        }
        console.log(':) :) :) Upgrades were all done successfully! (: (: (:');
        process.exit(0);
    });
*/