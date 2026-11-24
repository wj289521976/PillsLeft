// 测试总入口：依次运行健康检查（tests/health/check.js）与全部单元测试（tests/unit/*.test.js）。
// 用法：npm test 或 node tests/run-all.js；退出码 0 = 全部通过。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const healthScript = path.join(__dirname, 'health', 'check.js');
const unitDir = path.join(__dirname, 'unit');

const files = [];
if (fs.existsSync(healthScript)) files.push(healthScript);
if (fs.existsSync(unitDir)) {
  files.push(
    ...fs
      .readdirSync(unitDir)
      .filter((f) => f.endsWith('.test.js'))
      .sort()
      .map((f) => path.join(unitDir, f))
  );
}

if (files.length === 0) {
  console.error('未发现任何健康检查或测试文件');
  process.exit(1);
}

console.log(`清点助手 · 工程检查（${files.length} 组）\n`);

let failed = 0;
for (const file of files) {
  const rel = path.relative(process.cwd(), file);
  const res = spawnSync(process.execPath, [file], { encoding: 'utf8' });
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  if (res.status !== 0) {
    failed++;
    console.error(`❌ ${rel} 退出码 ${res.status}`);
  }
}

console.log(`\n结果：${files.length - failed}/${files.length} 组通过`);
process.exit(failed === 0 ? 0 : 1);
