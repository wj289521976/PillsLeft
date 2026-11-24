// CDP 直连检查工具（开发期辅助，不参与小程序运行时）：
// 用途：IDE「服务端口」未开启导致 MCP automator 不可用时，通过 CDP(9222) 直接
//       ① 截图指定小程序页面 webview；② 在 appservice 上下文求值读取页面 data。
// 用法：node scripts/cdp-check.js [pagePath]
//   例：node scripts/cdp-check.js pages/schedule/schedule
// 输出：screenshots/<page>-cdp.png + 控制台打印页面关键 data。
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CDP_HOST = '127.0.0.1';
const CDP_PORT = process.env.WECHAT_CDP_PORT || 9222;
const pagePath = (process.argv[2] || 'pages/schedule/schedule').replace(/^\//, '');

// ---------- 极简 WebSocket 客户端（仅满足 CDP 文本帧） ----------
function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.get({
      host: CDP_HOST,
      port: CDP_PORT,
      path: url.replace(/^ws:\/\/[^/]+/, ''),
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': 13
      }
    });
    req.on('upgrade', (res, socket) => resolve({ socket, send: (obj) => socket.write(encodeFrame(JSON.stringify(obj))) }));
    req.on('response', (res) => reject(new Error(`WS 升级失败：HTTP ${res.statusCode}`)));
    req.on('error', reject);
  });
}

function encodeFrame(text) {
  const payload = Buffer.from(text);
  const mask = crypto.randomBytes(4);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, 0x80 | payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

function decodeFrames(buffer) {
  // 返回 [剩余 buffer, 消息文本数组]；处理分片（continuation）与 ping
  const messages = [];
  let frames = [];
  while (buffer.length >= 2) {
    const b0 = buffer[0];
    const b1 = buffer[1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let off = 2;
    if (len === 126) {
      if (buffer.length < 4) break;
      len = buffer.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (buffer.length < 10) break;
      const big = buffer.readBigUInt64BE(2);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('帧过大');
      len = Number(big);
      off = 10;
    }
    let maskKey = null;
    if (masked) {
      if (buffer.length < off + 4) break;
      maskKey = buffer.slice(off, off + 4);
      off += 4;
    }
    if (buffer.length < off + len) break;
    let payload = buffer.slice(off, off + len);
    if (maskKey) {
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
    }
    buffer = buffer.slice(off + len);
    if (opcode === 9) continue; // ping：忽略（CDP 服务端不发）
    if (opcode === 8) continue; // close
    if (opcode === 1 || opcode === 2 || opcode === 0) {
      frames.push({ fin: (b0 & 0x80) !== 0, opcode, text: payload.toString('utf8') });
      const last = frames[frames.length - 1];
      if (last.fin && last.opcode !== 0) {
        const full = frames.map((f) => f.text).join('');
        frames = [];
        if (full) messages.push(full);
      }
    }
  }
  return [buffer, messages];
}

function makeClient(conn) {
  let id = 0;
  const pending = new Map();
  let rest = Buffer.alloc(0);
  conn.socket.on('data', (chunk) => {
    rest = Buffer.concat([rest, chunk]);
    let messages;
    [rest, messages] = decodeFrames(rest);
    for (const m of messages) {
      let msg;
      try {
        msg = JSON.parse(m);
      } catch {
        continue;
      }
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });
  return {
    call(method, params = {}) {
      const thisId = ++id;
      return new Promise((resolve, reject) => {
        pending.set(thisId, (msg) => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)));
        conn.send({ id: thisId, method, params });
        setTimeout(() => {
          if (pending.has(thisId)) {
            pending.delete(thisId);
            reject(new Error(`CDP 超时：${method}`));
          }
        }, 15000);
      });
    },
    close: () => conn.socket.destroy()
  };
}

// ---------- 目标发现 ----------
function listTargets() {
  return new Promise((resolve, reject) => {
    http
      .get({ host: CDP_HOST, port: CDP_PORT, path: '/json' }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve(JSON.parse(body)));
      })
      .on('error', reject);
  });
}

(async () => {
  const targets = await listTargets();
  const page = targets.find((t) => (t.url || '').includes(pagePath) && t.webSocketDebuggerUrl);
  const service = targets.find(
    (t) => t.webSocketDebuggerUrl && /\/appservice\/s\d+\/|小程序逻辑层/.test((t.title || '') + (t.url || ''))
  );
  if (!page && !service) {
    console.error('未找到目标。现有 targets：');
    targets.forEach((t) => console.error(` - [${t.type}] ${t.title} ${t.url}`));
    process.exit(1);
  }

  // ① appservice 求值：读取当前页面关键 data
  if (service) {
    const c = makeClient(await wsConnect(service.webSocketDebuggerUrl));
    try {
      const expr = `(function(){
        var ps = getCurrentPages(); var pg = ps[ps.length-1];
        return JSON.stringify({
          route: pg.route,
          today: pg.data.today, isEmpty: pg.data.isEmpty, totalCount: pg.data.totalCount,
          warningCount: pg.data.warningCount, outCount: pg.data.outCount,
          reminderText: pg.data.reminderText,
          groups: (pg.data.groups||[]).map(function(g){ return g.slot+' '+g.time+' '+g.label+' current='+g.current+' items='+g.items.length; }),
          unscheduled: pg.data.unscheduled
        });
      })()`;
      const r = await c.call('Runtime.evaluate', { expression: expr, returnByValue: true });
      console.log('── 页面 data ──');
      console.log(JSON.stringify(JSON.parse(r.result.value), null, 2));
    } catch (e) {
      console.error('appservice 求值失败：', e.message);
    }
    c.close();
  }

  // ② 页面 webview 截图（可选 --scroll <px> 先滚动页面）
  if (page) {
    const c = makeClient(await wsConnect(page.webSocketDebuggerUrl));
    try {
      await c.call('Page.enable');
      const scrollIdx = process.argv.indexOf('--scroll');
      if (scrollIdx !== -1 && process.argv[scrollIdx + 1]) {
        await c.call('Runtime.evaluate', {
          expression: `window.scrollTo(0, ${Number(process.argv[scrollIdx + 1]) || 0}); window.scrollY`
        });
        await new Promise((r) => setTimeout(r, 400)); // 等滚动生效
      }
      const shot = await c.call('Page.captureScreenshot', { format: 'png' });
      const outDir = path.join(__dirname, '..', 'screenshots');
      fs.mkdirSync(outDir, { recursive: true });
      const suffix = scrollIdx !== -1 ? '-scroll' + (process.argv[scrollIdx + 1] || '0') : '';
      const file = path.join(outDir, pagePath.split('/').pop() + '-cdp' + suffix + '.png');
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      console.log(`── 截图 ──\n${file} (${fs.statSync(file).size} 字节)`);
    } catch (e) {
      console.error('截图失败：', e.message);
    }
    c.close();
  }
})().catch((e) => {
  console.error('失败：', e.message);
  process.exit(1);
});
