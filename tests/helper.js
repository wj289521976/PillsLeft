// 微型测试辅助：用例计数 + 失败置退出码。约定不引入测试框架，只用标准 assert。
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`  ❌ ${name}`);
    console.error(`     ${e.message}`);
  }
}

function summary(file) {
  const tail = failed === 0 ? `${passed} 项全部通过` : `${passed} 通过，${failed} 失败`;
  console.log(`${failed === 0 ? '✅' : '❌'} ${file}：${tail}`);
  if (failed > 0) process.exitCode = 1;
}

module.exports = { test, summary };
