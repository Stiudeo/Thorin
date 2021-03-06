'use strict';
const util = require('util'),
  colors = require('colors');
/**
 * Created by Adrian on 06-Apr-16.
 * This is the default Thorin.js logger. It defaults
 * to logging stuff to the console.
 */
let DATE_FORMAT = "yyyy-MM-dd hh:mm:ss.SSS",
  LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'],
  LOG_COLORS = {
    trace: colors.blue,
    debug: colors.cyan,
    info: colors.green,
    warn: colors.yellow,
    error: colors.red,
    fatal: colors.magenta
  };
if (process.env.THORIN_LOG_TIME === "false" || global.THORIN_LOG_TIME === 'false' || global.THORIN_LOG_TIME === false || process.env.KUBERNETES_SERVICE_HOST) {
  DATE_FORMAT = "";
}
module.exports = function (thorin) {
  colors.enabled = true;
  let forceColors = global.THORIN_COLOR || process.env.THORIN_COLOR;
  if (!forceColors && (thorin.docker === true || global.THORIN_DOCKER)) {
    colors.enabled = false;
  }
  let globalLoggerName = "log", // default global.log() function name.
    consoleLogging = true,
    globalConsole = {
      log: global.console.log.bind(global.console)
    };
  const loggerListeners = [];
  const loggerMap = {   // a hash of all registered loggers.
    default: new ThorinLogger('default')
  };

  /* This is what we expose with the thorin logger. We do not process
   * the actual log string, we just emit log events. */
  function ThorinLogger(name, _opt) {
    this.name = name;
  }

  /* This is a shortcut for a log level caller. */
  ThorinLogger.prototype.log = function DoLogWithLevel(level) {
    if (typeof level !== 'string') this;
    level = level.toLowerCase();
    if (typeof this[level] !== 'function') return this;
    let args = Array.prototype.slice.call(arguments);
    args.splice(0, 1);
    return this[level].apply(this, args);
  };

  LOG_LEVELS.forEach((level) => {
    if (global.console[level]) {
      globalConsole[level] = global.console[level].bind(global.console);
    }
    ThorinLogger.prototype[level] = function (msg) {
      let newArgs = Array.prototype.slice.call(arguments),
        errArgs = [];
      let logStr = '[' + level.toUpperCase() + '] ',
        timeStr = getDateFormat(),
        plainStr = '';
      if (timeStr) {
        logStr += '[' + timeStr + '] ';
      }
      logStr += '[' + this.name + '] ';

      if (typeof msg !== 'string' || (typeof msg === 'string' && msg.indexOf('%') !== -1)) {
        plainStr = util.format.apply(util, arguments);
        logStr += plainStr;
      } else {
        plainStr = msg;
        // add any remaining strings.
        for (let i = 1; i < newArgs.length; i++) {
          if (typeof newArgs[i] === 'string' || typeof newArgs[i] === 'boolean' || typeof newArgs[i] === 'number') {
            plainStr += ' ' + newArgs[i];
          }
        }
        logStr += plainStr;
      }
      logStr = LOG_COLORS[level](logStr);
      let consoleArgs = [logStr],
        hasConsoleError = false;
      for (let i = 0; i < newArgs.length; i++) { // spit out any non-strings.
        if (newArgs[i] instanceof Error) {
          hasConsoleError = true;
          if (newArgs[i].name.indexOf('Thorin') === 0 && newArgs[i].stack && (newArgs[i].statusCode == 500 || newArgs[i].ns == 'GLOBAL')) {
            consoleArgs.push(newArgs[i].stack);
          } else {
            errArgs.push(newArgs[i]);
          }
        } else if (typeof msg === 'string' && typeof newArgs[i] === 'object' && newArgs[i]) {
          consoleArgs.push(newArgs[i]);
        }
      }
      if (consoleLogging) {
        globalConsole.log.apply(globalConsole, consoleArgs);
        if (errArgs.length > 0 && thorin.env !== 'production' && !hasConsoleError) {
          globalConsole.trace.apply(globalConsole, errArgs);
        }
      }
      if (loggerListeners.length === 0) return;
      let item = {
        ts: Date.now(),
        name: this.name,
        message: plainStr,
        level: level,
        args: Array.prototype.slice.call(arguments)
      };

      for (let i = 0; i < loggerListeners.length; i++) {
        let listener = loggerListeners[i];
        if (typeof listener.name === 'string' && listener.name !== this.name) continue;
        try {
          listener.fn(item);
        } catch (e) {
          if (consoleLogging) {
            globalConsole.error('Thorin.logger: log listener for logger ' + this.name + ' threw an error.');
            globalConsole.error(e);
          }
        }
      }
    }
  });


  /* This will either create a new logger instance or fetch the default one. */
  function logger(loggerName) {
    if (typeof loggerName === 'undefined') loggerName = 'default';
    if (typeof loggerMap[loggerName] !== 'undefined') return loggerMap[loggerName];
    const loggerObj = new ThorinLogger(loggerName);
    loggerMap[loggerName] = loggerObj;
    return loggerObj;
  }

  /* Disables all the console logging */
  logger.disableConsole = function DisableConsoleLogging() {
    consoleLogging = false;
    return logger;
  };
  /* Enables all console logging. */
  logger.enableConsole = function EnableConsoleLogging() {
    consoleLogging = true;
    return logger;
  };

  /* Adds an log event handler. */
  logger.pipe = function PipeLogEvents(a, fn) {
    let loggerName, pipeFn, item = {};
    if (typeof a === 'string' && typeof fn === 'function') {
      loggerName = a;
      pipeFn = fn;
    } else if (typeof a === 'function') {
      pipeFn = a;
    }
    if (typeof pipeFn !== 'function') {
      if (consoleLogging) {
        globalConsole.error('thorin.logger.pipe(): callback is not a function');
      }
    } else {
      item.fn = pipeFn;
      if (loggerName) item.name = loggerName;
      loggerListeners.push(item);
    }
    return logger;
  };

  /* Manually override the global var name */
  logger.globalize = function UpdateGlobalName(name) {
    if (name === false && typeof global[globalLoggerName] !== 'undefined') {
      delete global[globalLoggerName];
      return this;
    }
    if (typeof name === 'undefined') {
      name = globalLoggerName;
    }
    if (typeof global[globalLoggerName] !== 'undefined') {
      delete global[globalLoggerName];
    }
    globalLoggerName = name;
    global[globalLoggerName] = loggerMap['default'];
  };

  /* Replaces the console logger with our logger. */
  logger.replaceConsole = function ReplaceConsoleLogger() {
    let defaultLogger = logger();
    LOG_LEVELS.forEach((level) => {
      global.console[level] = defaultLogger[level].bind(defaultLogger);
    });
    global.console.log = defaultLogger.info.bind(defaultLogger);
  };

  return logger;

};

function padWithZeros(vNumber, width) {
  var numAsString = vNumber + "";
  while (numAsString.length < width) {
    numAsString = "0" + numAsString;
  }
  return numAsString;
}

function offset(timezoneOffset) {
  // Difference to Greenwich time (GMT) in hours
  var os = Math.abs(timezoneOffset);
  var h = String(Math.floor(os / 60));
  var m = String(os % 60);
  if (h.length == 1) {
    h = "0" + h;
  }
  if (m.length == 1) {
    m = "0" + m;
  }
  return timezoneOffset < 0 ? "+" + h + m : "-" + h + m;
}

function addZero(vNumber) {
  return padWithZeros(vNumber, 2);
}

function getDateFormat() {
  var date = new Date(),
    timezoneOffset = date.getTimezoneOffset();
  date.setUTCMinutes(date.getUTCMinutes() - timezoneOffset);
  var vDay = addZero(date.getUTCDate());
  var vMonth = addZero(date.getUTCMonth() + 1);
  var vYearLong = addZero(date.getUTCFullYear());
  var vYearShort = addZero(date.getUTCFullYear().toString().substring(2, 4));
  var vYear = (DATE_FORMAT.indexOf("yyyy") > -1 ? vYearLong : vYearShort);
  var vHour = addZero(date.getUTCHours());
  var vMinute = addZero(date.getUTCMinutes());
  var vSecond = addZero(date.getUTCSeconds());
  var vMillisecond = padWithZeros(date.getUTCMilliseconds(), 3);
  var vTimeZone = offset(timezoneOffset);
  date.setUTCMinutes(date.getUTCMinutes() + timezoneOffset);
  return DATE_FORMAT
    .replace(/dd/g, vDay)
    .replace(/MM/g, vMonth)
    .replace(/y{1,4}/g, vYear)
    .replace(/hh/g, vHour)
    .replace(/mm/g, vMinute)
    .replace(/ss/g, vSecond)
    .replace(/SSS/g, vMillisecond)
    .replace(/O/g, vTimeZone);
}
