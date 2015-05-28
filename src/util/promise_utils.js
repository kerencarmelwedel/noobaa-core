// module targets: nodejs & browserify
'use strict';

// var _ = require('lodash');
var Q = require('q');
var child_process = require('child_process');
require('setimmediate');


module.exports = {
    join: join,
    iterate: iterate,
    loop: loop,
    retry: retry,
    delay_unblocking: delay_unblocking,
    run_background_worker: run_background_worker,
    next_tick: next_tick,
    set_immediate: set_immediate,
    promised_spawn: promised_spawn,
};


/**
 *
 */
function join(obj, property, func) {
    var promise = obj[property];
    if (promise) {
        return promise;
    }
    promise =
        Q.fcall(func)
        .fin(function() {
            delete obj[property];
        });
    obj[property] = promise;
    return promise;
}

/**
 *
 * Iterate on an array, accumulate promises and return results of each
 * invocation
 *
 */
function iterate(array, func) {
    var i = -1;
    var results = [];
    if (!array || !array.length) {
        return Q.when(results);
    }
    results.length = array.length;

    function next(res) {

        // save the result of last iteration (unless it's the initial call)
        if (i >= 0) {
            results[i] = res;
        }

        // incrementing - notice that i starts from -1 so we increment before
        // in order to avoid creating a callback per iteration
        i += 1;

        // when finished, make sure to set length so that if array got truncated
        // during iteration then also results will have same length
        if (i >= array.length) {
            results.length = array.length;
            return;
        }

        // call func as function(item, index, array)
        return Q.fcall(func, array[i], i, array).then(next);
    }

    return Q.fcall(next).thenResolve(results);
}



/**
 *
 * simple promise loop, similar to _.times but ignores the return values,
 * and only returns a promise for completion or failure
 *
 */
function loop(times, func) {
    if (times > 0) {
        return Q.fcall(func)
            .then(function() {
                return loop(times - 1, func);
            });
    }
}


/**
 *
 * simple promise loop, similar to _.times but ignores the return values,
 * and only returns a promise for completion or failure
 *
 * @param attempts number of attempts. can be Infinity.
 * @param delay number of milliseconds between retries
 * @param func with signature function(attempts), passing remaining attempts just fyi
 */
function retry(attempts, delay, func) {

    // call func and catch errors,
    // passing remaining attempts just fyi
    return Q.fcall(func, attempts)
        .then(null, function(err) {

            // check attempts
            attempts -= 1;
            if (attempts <= 0 || err.DO_NOT_RETRY) {
                throw err;
            }

            // delay and retry next attempt
            return Q.delay(delay).then(function() {
                return retry(attempts, delay, func);
            });

        });
}


/**
 * create a timeout promise that does not block the event loop from exiting
 * in case there are no other events waiting.
 * see http://nodejs.org/api/timers.html#timers_unref
 */
function delay_unblocking(delay) {
    var defer = Q.defer();
    var timer = setTimeout(defer.resolve, delay);
    timer.unref();
    return defer.promise;
}



// for the sake of tests to be able to exit we schedule the worker with unblocking delay
// so that it won't prevent the process from existing if it's the only timer left
function run_background_worker(worker) {
    var DEFUALT_DELAY = 10000;

    function run() {
        Q.fcall(function() {
                return worker.run_batch();
            })
            .then(function(delay) {
                return delay_unblocking(delay || worker.delay || DEFUALT_DELAY);
            }, function(err) {
                console.log('run_background_worker', worker.name, 'UNCAUGHT ERROR', err, err.stack);
                return delay_unblocking(worker.delay || DEFUALT_DELAY);
            })
            .then(run);
    }
    console.log('run_background_worker:', 'INIT', worker.name);
    delay_unblocking(worker.boot_delay || worker.delay || DEFUALT_DELAY).then(run);
    return worker;
}

function next_tick() {
    var defer = Q.defer();
    process.nextTick(defer.resolve);
    return defer.promise;
}

function set_immediate() {
    var defer = Q.defer();
    setImmediate(defer.resolve);
    return defer.promise;
}

/* Run child process spawn wrapped by a promise
   TODO: Should be removed once we push to node 12 which has the spawnSync and execSync
*/
function promised_spawn(command, args, cwd) {
    console.log('promise spawn');
    if (!command || !cwd) {
        return Q.reject(new Error("Both command and working directory must be given, not " + command + " and " + cwd));
    }

    var deferred = Q.defer();

    var proc = child_process.spawn(command, args, {
        cwd: cwd
    });

    proc.on("error", function(error) {
      console.log('promise spawn error',error);
      deferred.reject(new Error(command + " " + args.join(" ") + " in " + cwd + " recieved error " + error.message));
    });

    proc.on("exit", function(code) {
        console.log('promise spawn exit',code);
        if (code !== 0) {
            deferred.reject(new Error(command + " " + args.join(" ") + " in " + cwd + " exited with rc " + code));
        } else {
            deferred.resolve();
        }
    });

    return deferred.promise;

}
