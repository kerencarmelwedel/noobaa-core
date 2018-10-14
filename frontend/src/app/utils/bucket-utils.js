/* Copyright (C) 2016 NooBaa */

import { deepFreeze, isUndefined, mapValues, sumBy, flatMap } from './core-utils';
import { toBigInteger, fromBigInteger, bigInteger, unitsInBytes } from 'utils/size-utils';
import { stringifyAmount, pluralize } from 'utils/string-utils';

const bucketStateToIcon = deepFreeze({
    NO_RESOURCES: {
        tooltip: 'No storage resources',
        css: 'error',
        name: 'problem'
    },
    NOT_ENOUGH_HEALTHY_RESOURCES: {
        tooltip: 'Not enough healthy storage resources',
        css: 'error',
        name: 'problem'
    },
    NOT_ENOUGH_RESOURCES: {
        tooltip: 'Not enough drives to meet resiliency policy',
        css: 'error',
        name: 'problem'
    },
    NO_CAPACITY: {
        tooltip: 'No potential available storage',
        css: 'error',
        name: 'problem'
    },
    EXCEEDING_QUOTA: {
        tooltip: 'Exceeded configured quota',
        css: 'error',
        name: 'problem'
    },
    SPILLING_BACK: {
        tooltip: 'Data spilling back to resources',
        css: 'warning',
        name: 'working'
    },
    LOW_CAPACITY: {
        tooltip: 'Storage is low',
        css: 'warning',
        name: 'problem'
    },
    RISKY_TOLERANCE: {
        tooltip: 'Risky failure tolerance ',
        css: 'warning',
        name: 'problem'
    },
    APPROUCHING_QUOTA: {
        tooltip: 'Approaching configured quota',
        css: 'warning',
        name: 'problem'
    },
    DATA_ACTIVITY: {
        tooltip: 'In process',
        css: 'warning',
        name: 'working'
    },
    OPTIMAL: {
        tooltip: 'Healthy',
        css: 'success',
        name: 'healthy'
    }
});

const placementModeToIcon = deepFreeze({
    NO_RESOURCES: _alignIconTooltip(bucketStateToIcon.NO_RESOURCES, 'start'),
    NOT_ENOUGH_RESOURCES: _alignIconTooltip(bucketStateToIcon.NOT_ENOUGH_RESOURCES, 'start'),
    NOT_ENOUGH_HEALTHY_RESOURCES: _alignIconTooltip(bucketStateToIcon.NOT_ENOUGH_HEALTHY_RESOURCES, 'start'),
    NO_CAPACITY: _alignIconTooltip(bucketStateToIcon.NO_CAPACITY, 'start'),
    RISKY_TOLERANCE: _alignIconTooltip(bucketStateToIcon.RISKY_TOLERANCE, 'start'),
    LOW_CAPACITY: _alignIconTooltip(bucketStateToIcon.LOW_CAPACITY, 'start'),
    DATA_ACTIVITY: _alignIconTooltip(bucketStateToIcon.DATA_ACTIVITY, 'start'),
    SPILLING_BACK: _alignIconTooltip(bucketStateToIcon.SPILLING_BACK, 'start'),
    OPTIMAL: _alignIconTooltip(bucketStateToIcon.OPTIMAL, 'start')
});

const placementTypeToDisplayName = deepFreeze({
    SPREAD: 'Spread',
    MIRROR: 'Mirror'
});

const namespaceBucketToStateIcon = deepFreeze({
    OPTIMAL: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Healthy'
    }
});

const resiliencyModeToIcon = deepFreeze({
    NOT_ENOUGH_RESOURCES: _alignIconTooltip(bucketStateToIcon.NOT_ENOUGH_RESOURCES, 'start'),
    RISKY_TOLERANCE: _alignIconTooltip(bucketStateToIcon.RISKY_TOLERANCE, 'start'),
    DATA_ACTIVITY: _alignIconTooltip(bucketStateToIcon.DATA_ACTIVITY, 'start'),
    OPTIMAL: _alignIconTooltip(bucketStateToIcon.OPTIMAL, 'start')
});

const resiliencyTypeToDisplay = deepFreeze({
    REPLICATION: 'Replication',
    ERASURE_CODING: 'Erasure Coding'
});

const writableStates = deepFreeze([
    'SPILLING_BACK',
    'LOW_CAPACITY',
    'RISKY_TOLERANCE',
    'APPROUCHING_QUOTA',
    'DATA_ACTIVITY',
    'OPTIMAL'
]);

const resiliencyTypeToBlockType = deepFreeze({
    REPLICATION: 'replica',
    ERASURE_CODING: 'fragment'
});

const quotaModeToIcon = deepFreeze({
    EXCEEDING_QUOTA: _alignIconTooltip(bucketStateToIcon.EXCEEDING_QUOTA, 'start'),
    APPROUCHING_QUOTA: _alignIconTooltip(bucketStateToIcon.APPROUCHING_QUOTA, 'start'),
    OPTIMAL: {
        name: 'healthy',
        css: 'success',
        tooltip: {
            text: 'Enabled',
            align: 'start'
        }
    }
});

const versioningModeToText = deepFreeze({
    ENABLED: 'Enabled',
    SUSPENDED: 'Suspended',
    DISABLED: 'Disabled'
});

export const bucketEvents = deepFreeze([
    {
        value: 'ObjectCreated',
        label: 'Object Created'
    },
    {
        value: 'ObjectRemoved',
        label: 'Object Removed'
    },
    {
        value: 'ObjectRead',
        label: 'Object Read'
    }
]);

function _alignIconTooltip(icon, align) {
    const { tooltip: text, ...rest } = icon;
    return {
        ...rest,
        tooltip: { text, align }
    };
}

export function getBucketStateIcon(bucket, align) {
    return isUndefined(align) ?
        bucketStateToIcon[bucket.mode] :
        _alignIconTooltip( bucketStateToIcon[bucket.mode], align);
}

export function getPlacementTypeDisplayName(type) {
    return placementTypeToDisplayName[type];
}

export function getPlacementStateIcon(placementMode) {
    return placementModeToIcon[placementMode];
}

export function getNamespaceBucketStateIcon(bucket) {
    const { mode } = bucket;
    return namespaceBucketToStateIcon[mode];
}


export function getQuotaStateIcon(quotaMode) {
    return quotaModeToIcon[quotaMode];
}

export function getDataBreakdown(data, quota) {
    if (!quota) {
        return {
            used: data.size,
            overused: 0,
            availableForUpload: data.availableForUpload,
            potentialForUpload: 0,
            overallocated: 0
        };
    }

    const { zero, max, min } = bigInteger;
    const sizeBigInt = toBigInteger(data.size);
    const uploadBigInt = toBigInteger(data.availableForUpload);

    let q = toBigInteger(quota.size).multiply(unitsInBytes[quota.unit]);
    const used = min(sizeBigInt, q);
    const overused = sizeBigInt.subtract(used);

    q = max(q.subtract(sizeBigInt), zero);
    const availableForUpload = min(uploadBigInt, q);
    const potentialForUpload = uploadBigInt.subtract(availableForUpload);
    const overallocated = max(q.subtract(uploadBigInt), zero);

    return {
        used: fromBigInteger(used),
        overused: fromBigInteger(overused),
        availableForUpload: fromBigInteger(availableForUpload),
        potentialForUpload: fromBigInteger(potentialForUpload),
        overallocated: fromBigInteger(overallocated)
    };
}

export function getQuotaValue(quota) {
    const { size, unit } = quota;
    const quotaBigInt = toBigInteger(size).multiply(unitsInBytes[unit]);
    return fromBigInteger(quotaBigInt);
}

export function isBucketWritable(bucket) {
    return writableStates.includes(bucket.mode);
}

export function countStorageNodesByMirrorSet(placement, hostPools) {
    return flatMap(
        placement.tiers,
        tier => tier.mirrorSets.map(ms => sumBy(
            ms.resources,
            res => res.type === 'HOSTS' ?
                hostPools[res.name].storageNodeCount :
                Infinity
        ))
    );
}

export function summrizeResiliency(resiliency) {
    switch (resiliency.kind) {
        case 'REPLICATION': {
            const replicas = Math.max(resiliency.replicas, 0);
            const copies = Math.max(replicas - 1, 0);
            return {
                type: 'REPLICATION',
                mode: resiliency.mode,
                replicas: replicas,
                storageOverhead: copies,
                failureTolerance: copies,
                requiredDrives: replicas,
                rebuildEffort: 'LOW'
            };
        }
        case 'ERASURE_CODING': {
            const dataFrags = Math.max(resiliency.dataFrags, 0);
            const parityFrags = Math.max(resiliency.parityFrags, 0);
            return {
                type: 'ERASURE_CODING',
                mode: resiliency.mode,
                dataFrags: dataFrags,
                parityFrags: parityFrags,
                storageOverhead: dataFrags > 0 ? parityFrags / dataFrags : 0,
                failureTolerance: parityFrags,
                requiredDrives: dataFrags + parityFrags,
                rebuildEffort: dataFrags <= 4 ? 'HIGH' : 'VERY_HIGH'
            };
        }
    }
}

export function getResiliencyStateIcon(resiliencyMode) {
    return resiliencyModeToIcon[resiliencyMode];
}

export function getResiliencyTypeDisplay(resiliencyType) {
    return resiliencyTypeToDisplay[resiliencyType];
}

export function getResiliencyRequirementsWarning(resiliencyType, drivesCount) {
    const subject = resiliencyTypeToBlockType[resiliencyType];

    return `The current placement policy allows for a maximum of ${
        stringifyAmount(subject, drivesCount)
    }. The number of possible ${
        pluralize(subject)
    } is derived from the minimal number of available drives across all mirror sets.`;
}

export function getVersioningStateText(versioningMode) {
    return versioningModeToText[versioningMode];
}

export function flatPlacementPolicy(bucket) {
    return flatMap(
        bucket.placement2.tiers,
        tier => flatMap(
            tier.mirrorSets,
            ms => ms.resources.map(resource => ({
                bucket: bucket.name,
                tier: tier.name,
                mirrorSet: ms.namer,
                resource: resource
            }))
        )
    );
}
