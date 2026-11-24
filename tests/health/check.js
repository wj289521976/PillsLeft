// 工程健康检查：不依赖微信开发者工具的"可运行"验证（小程序无 HTTP 服务，此脚本即健康检查）。
// 覆盖：① 工程配置可解析且 miniprogramRoot 有效；② app.json 页面四件套齐全、tabBar 配置一致；
//       ③ src 下全部 JS 语法合法；④ utils 领域层可在 Node 加载（纯函数约定未被破坏）。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');

const results = [];
function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail: detail || '' });
  } catch (e) {
    results.push({ name, ok: false, detail: e.message });
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function listJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJs(p));
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

check('project.config.json 可解析且 miniprogramRoot 指向 src/', () => {
  const cfg = readJson(path.join(ROOT, 'project.config.json'));
  assert(cfg.miniprogramRoot === 'src/', `miniprogramRoot 应为 "src/"，实际 ${cfg.miniprogramRoot}`);
  assert(fs.existsSync(path.join(ROOT, cfg.miniprogramRoot)), 'miniprogramRoot 目录不存在');
  return 'ok';
});

check('app.json 页面四件套齐全（js/json/wxml/wxss）', () => {
  const app = readJson(path.join(SRC, 'app.json'));
  assert(Array.isArray(app.pages) && app.pages.length > 0, 'pages 为空');
  const dup = app.pages.filter((p, i) => app.pages.indexOf(p) !== i);
  assert(dup.length === 0, `pages 存在重复项：${dup.join(', ')}`);
  const missing = [];
  for (const page of app.pages) {
    for (const ext of ['.js', '.json', '.wxml', '.wxss']) {
      if (!fs.existsSync(path.join(SRC, `${page}${ext}`))) missing.push(`${page}${ext}`);
    }
  }
  assert(missing.length === 0, `缺少文件：${missing.join(', ')}`);
  return `${app.pages.length} 个页面`;
});

check('tabBar 配置一致（页面已注册、图标文件存在）', () => {
  const app = readJson(path.join(SRC, 'app.json'));
  const tabBar = app.tabBar;
  assert(tabBar && Array.isArray(tabBar.list), '缺少 tabBar.list');
  const missingPage = tabBar.list.filter((t) => !app.pages.includes(t.pagePath));
  assert(missingPage.length === 0, `tabBar 页面未注册：${missingPage.map((t) => t.pagePath).join(', ')}`);
  const missingIcon = tabBar.list.filter(
    (t) => !fs.existsSync(path.join(SRC, t.iconPath)) || !fs.existsSync(path.join(SRC, t.selectedIconPath))
  );
  assert(missingIcon.length === 0, `tabBar 图标缺失：${missingIcon.map((t) => t.pagePath).join(', ')}`);
  return `${tabBar.list.length} 个 tab`;
});

check('src 下全部 JS 语法合法（node --check）', () => {
  const files = listJs(SRC);
  assert(files.length > 0, '未发现 JS 文件');
  const bad = [];
  for (const file of files) {
    const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (res.status !== 0) bad.push(`${path.relative(ROOT, file)}：${(res.stderr || '').split('\n')[0]}`);
  }
  assert(bad.length === 0, `\n     ${bad.join('\n     ')}`);
  return `${files.length} 个文件`;
});

check('utils 领域层可在 Node 加载（纯函数约定，storage 顶层不触碰 wx）', () => {
  const loaded = [];
  for (const mod of ['date', 'medicine', 'storage', 'schedule']) {
    const file = path.join(SRC, 'utils', `${mod}.js`);
    if (!fs.existsSync(file)) continue; // schedule 等按阶段补齐
    require(file);
    loaded.push(mod);
  }
  assert(loaded.includes('date') && loaded.includes('medicine') && loaded.includes('storage'), '基础模块加载失败');
  return `${loaded.join(' / ')}`;
});

let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.ok && r.detail ? `（${r.detail}）` : ''}`);
  if (!r.ok) {
    failed++;
    console.error(`   ${r.detail}`);
  }
}
console.log(`\n健康检查：${results.length - failed}/${results.length} 项通过`);
process.exit(failed === 0 ? 0 : 1);
