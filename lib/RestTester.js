/**
 * Created by IDE.
 * User: gzhang
 * Date: 11/7/11
 * Time: 5:07 PM
 */

require('colors');
var http = require('http');
//var lang = require('lang');
var util = require('util'), events = require('events');
//var lint = lang.lint, validate = lang.validate;

/*
 *  RestTester :
 */
//------------------- Event Defined ----------------//
var E = {
    INIT: "r_init",                 //(error, cases)
    CLOSE: "r_close",               //([errors], cases)
    PRECLOSE: "r_preClose",         //([errors], cases)
    SETUP: "r_setup",               //(error, case's title, case)
    TEARDOWN: "r_teardown",         //([errors], case's title, case)
    BEFORE: "r_before",             //(error, case's title, case)
    AFTER: "r_after",               //([errors], case's title, case)
    TESTING: "r_testing"            //(error, title , case)
};

// ---------------------------- test cases defines --------------------------- //
/*  //input & expect is require
*  cases: {
*      "test1 title": case,
*      "test2 title": case,
*      ...
*  }
*  case: {
*      result: true / false        //after test will fill by tester
*      input:{
*          host: "localhost",      //optional
*          port: 5555,             //optional
*          method: "POST"/"GET",
*          headers:{},
*          path:"/url/to/call/api?param1=1&param2=2"
*          body:{}                 //for post
*      },
*      expect:{
*          statusCode: 200,
*          headers:{},
*          body:{}
*      },
*      actual: {                   //after test will fill by tester
*          statusCode: 200,
*          headers: {},
*          body: {}
*      },
*      error: {                    //if error occur during testing, tester will fill this field
*      }
*      before: Function(title, case, next),          //optional
*      after: Function(title, case, next),           //optional
*      setup: Function(title, case, next),           //optional
*      teardown: Function(title, case, next)         //optional
*  },
*  // ------- test server's context ------------ //
*  context: {
*      //if give the server, tester will start server auto;
*      //if not give, you must confirm the host:port you give is startup
*      server: nodejs-server,
*      host: 'localhost',
*      port: 5555,
*      timeout: 500,
*      encoding: 'utf8'
*  },
*  init : function(cases, next),
*  close : function(cases, next)
*/

function eprint(msg) {
    console.log(("[error] " + msg).red);
}

function debug(msg) {
//    console.log(('[trace] ' + msg).grey);
}
function noThrow(handle, block) {
    return function() {
        try {
            block.apply(this, arguments);
        } catch(e) {
            handle(e);
        }
    }
}

// serialCall(obj, func, function(error: Error){})
function serialCall(self, funs, callback) {
    debug("serial call: " + funs.length);
    var i = 0;
    var args = Array.prototype.slice.call(arguments, 3);
    var flag = false;
    var entry = function(err) {
        if (flag && err) throw err;
        var fun = funs[i++];
        if (err || (!fun)) {
            flag = true;
            callback(err);
        } else if(fun){
            try {
                fun.apply(self, args);
            } catch(e) {
                arguments.callee(e);
            }
        }
    };
    args.unshift(entry);
    entry();
}

// serial dependent call...
// serialCall(obj, func, function(errors:[]){})
// please confirm the next call as the last instruction, or will trigger some unknown bug...
function serialDepCall(self, funs, callback) {
    debug("In serialDepCall: " + funs.length);
    var i = 0, errors = [];
    var args = Array.prototype.slice.call(arguments, 3);
    var flag = false;
    var entry = function(err) {
        if (flag && err) throw err;
        if (err) errors.push(err);
        var fun = funs[i++];
        if (fun) {
            try {
                fun.apply(self, args);
            } catch(e) {
                arguments.callee(e);
            }
        } else if (!flag) {
            flag = true;
            callback(errors);
        }
    };
    args.unshift(entry);
    entry();
}

function updateCaseResult(_case, err, actual) {
    if (err) {
        _case.result = false;
        _case.error = {
            message: err.message
        }
    }
    if (actual) {
        _case.actual = actual;
    }
}

function combineErrors(errors) {
    return errors.map(
    function(e) {
        return (e && e.message) || "";
    }).toString();
}

//before/setup/init : first in first run
//after/teardown/close : first in last run
var Tester = function(cases, context, callback) {
    var self = this;
    context = context || {};
    // ------------------- members --------------------- //
    this.cases = cases;
    this.context = {
        server: context.server || null,
        host: context.host || "localhost",
        port: context.port || 5555,
        timeout: context.timeout || 500,
        encoding: context.encoding || "utf8"
    };
    this._before = [];
    this._after = [];
    this._setup = [];
    this._teardown = [];
    this._init = [];
    this._close = [];
    this.callback = callback;
    // ----------------------- default listener ----------------------- //
    this.onInit(function(next, cases) {
        var ct = this.context;
        var server = ct.server;
        if (server) {
            server = server.listen(ct.port, function(){
                var host = server.address().address;
                var port = server.address().port;
                console.log('Start mock server at http://%s:%s', host, port)
            });
        }
        next();
    });
    this.onBefore(function(next, title, _case) {
        _case.result = true;
        _case.actual = {};
        _case.error = {};
        next();
    });
    this.on(E.PRECLOSE, function() {//after test close the server
        if(self.context.server) {
            //self.context.server.close();
        }
    })
};
util.inherits(Tester, events.EventEmitter);
var $ = Tester.prototype;

// ----------------------- monitor function --------------------
// before & after is test process's unit
$.onBefore = function(func) {
    this._before.push(func);
};
$.onAfter = function(func) {
    this._after.unshift(func);
};
// setup & teardown is test unit is env setup & tear down
$.onSetup = function(func) {
    this._setup.push(func);
};
$.onTeardown = function(func) {
    this._teardown.unshift(func);
};
// init & close is the whole test's env setup & tear down
// before all , and after all
$.onInit = function(func) {
    this._init.push(func);
};
$.onClose = function(func) {
    this._close.unshift(func);
};
// ----------------------- public function ----------------------- //
// init - run test cases - close
$.run = function(_cases, callback) {
    debug('start to run test');
    var self = this;
    var cases = _cases || self.cases || [];
    var wraps = [];

    function wrap(t, cs) {
        return function(next) {
            return self.testOneCase(t, cs, next);
        }
    }
    for (var t in cases) {
        wraps.push(wrap(t, cases[t]));
    }
    function afterTestAll(errors) {
        self.emit(E.PRECLOSE, errors, cases);
        serialDepCall(self, self._close, function(errors) {
            self.emit(E.CLOSE, errors, cases);
            if (callback) {
                callback(errors, cases);
            } else if (self.callback) {
                self.callback(errors, cases);
            }
        }, cases);
    }

    serialCall(self, self._init, function(err) {
        self.emit(E.INIT, err, cases);
        if (err) {
            afterTestAll([err]);
        } else {
            serialDepCall(self, wraps, afterTestAll);
        }
    }, cases);
};
// setup - testing - teardown
$.testOneCase = function(title, _case, callback) {
    debug("In testOneCase[" + title + "]");
    var self = this;

    function testing(err, actual) {
        updateCaseResult(_case, err, actual);
        serialDepCall(self, self._teardown, function(errors) {//teardown
            if (_case.teardown) {
                var callee = arguments.callee;
                var next = function(e) {
                    if (e) errors.push(e);
                    callee(errors);
                };
                var func = noThrow(next, _case.teardown);
                delete _case.teardown;
                return func.call(self, next, title, _case);
            }
            self.emit(E.TEARDOWN, errors, title, _case);
            if (errors.length > 0) {
                callback(new Error(combineErrors(errors)));
            } else {
                callback(new Error('a bug'));
            }
        }, title, _case);
    }

    serialCall(self, self._setup, function(err) { //setup
        if ((!err) && _case.setup) {//todo check if before is not a function
            var func = noThrow(arguments.callee, _case.setup);
            delete _case.setup;
            return func.call(self,arguments.callee, title, _case);
        }
        self.emit(E.SETUP, err, title, _case);
        if (err) {//if setup success then start to test...
            callback(err);
        } else {
            self._testing(title, _case, testing);
        }
    }, title, _case);
};
// before - testing - after
// callback = function(err, actual);
$._testing = function(title, _case, callback) {
    var self = this;

    function afterCaseTest(err, actual) {
        self.emit(E.TESTING, err, title, _case);
        if (err) {
            callback(err);
        } else {
            _case.actual = actual;
            //todo code in after callback like code in teardown callback
            serialDepCall(self, self._after, function(errs) {//after
                if (_case.after) {
                    var callee = arguments.callee;
                    var next = function(e) {
                        if (e) errs.push(e);
                        callee(errs);
                    };
                    var func = noThrow(next, _case.after);
                    delete _case.after;
                    return func.call(self, next, title, _case);
                }
                self.emit(E.AFTER, errs, title, _case);
                if(errs.length) callback(Error(combineErrors(errs)), actual);
                else callback(null, actual);
            }, title, _case);
        }
    }

    serialCall(self, self._before, function(err) {//before
        if ((!err) && _case.before) {
            var func = noThrow(arguments.callee, _case.before);
            delete _case.before;
            return func.call(self, arguments.callee, title, _case);
        }
        self.emit(E.BEFORE, err, title, _case);
        if (err) {//before running error ...
            callback(err);
        } else {
            self._testCase(_case, afterCaseTest);
        }
    }, title, _case);
};
// callback: function(err, actual);
$._testCase = function(_case, callback) {
    var tester = this;
    var ret = {};
    var input = _case.input;
    var env = tester.context;
    var rbody = Object.prototype.toString.call(input.body) == '[object String]' ? input.body : JSON.stringify(input.body);
    var opts = {
        host: input.host || env.host,
        port: input.port ? Number(input.port) : env.port,
        path: input.path,
        method: input.method,
        headers: input.headers
    };
    //send request
    var req = http.request(opts, function(res) {
        ret = {
            statusCode: res.statusCode,
            headers : res.headers,
            body: ""
        };
        res.setEncoding(env.encoding);
        res.on('data', function(chunk) {
            ret.body += chunk;
        });
        res.on('end', function() {
            var b = ret.body;
            try {
                ret.body = JSON.parse(ret.body);
            } catch(e) {
                ret.body = b;
            }
            callback(null, ret);
        });
    });
    if (!rbody) {
        req.end();
    } else {
        req.write(rbody);
        req.end();
    }
    setTimeout(function() {
        req.abort();
    }, env.timeout);
    req.on('error', function(e) {
        callback(e);
    });
};

Tester.E = E;


module.exports = Tester;










