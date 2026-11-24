// 统一日志基线：分级输出，通道可注入。纯函数、不依赖 wx（console 在小程序与 Node 均可用）。
// 用法：const logger = createLogger({ tag: 'app' }); logger.error('xxx', err);
//       Node 单测可传 transport 收集输出进行断言。
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function pad(n) {
  return n.toString().padStart(2, '0');
}

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function createLogger(options) {
  const opts = options || {};
  const level = LEVELS[opts.level] !== undefined ? LEVELS[opts.level] : LEVELS.info;
  const transport = typeof opts.transport === 'function' ? opts.transport : console.log.bind(console);
  const tag = opts.tag || 'app';

  function emit(name, args) {
    if (LEVELS[name] < level) return;
    transport(`[${timestamp()}] [${name}] [${tag}]`, ...args);
  }

  return {
    debug: (...args) => emit('debug', args),
    info: (...args) => emit('info', args),
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args)
  };
}

module.exports = { createLogger };
