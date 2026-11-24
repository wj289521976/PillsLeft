# tests/ — 测试与工程检查说明

## 运行方式

```bash
npm test                          # 全量：健康检查 + 全部单测（等价 node tests/run-all.js）
npm run check                     # 仅健康检查（tests/health/check.js）
node tests/unit/<某测试>.js        # 单跑一个测试文件，退出码 0 = 全部通过
```

## 策略

`src/utils/` 全部为纯函数（storage.js 除外），用 **Node 直接运行断言脚本**测试（标准 `assert` + `tests/helper.js` 微型计数器），零框架零依赖，不依赖微信开发者工具。页面逻辑由负责人在开发者工具走查。

健康检查（`tests/health/check.js`）是本项目的"可运行"验证（纯本地小程序无后端健康检查接口）：工程配置、页面四件套、tabBar 一致性、全部 JS 语法、utils Node 可加载。

## 用例清单

| 文件 | 覆盖 | 状态 |
|---|---|---|
| `unit/date.test.js` | formatDate/daysBetween/addDays 边界（跨月/跨年/闰年/负向） | ✅ 已建（15 例） |
| `unit/medicine.test.js` | 库存推算对照 v1 文档示例（剩粒/盒/天数/状态）；阈值边界；耗尽日部分消耗；补货/校准基准重置 | ✅ 已建（13 例） |
| `unit/schedule.test.js` | 14 种默认药 usageTime 解析全表＋时段和=dailyDose 自洽；½/¼/分数/空白/乱序/重复；失败分支全返回 []；deriveTodaySchedule 分组/当前时段边界/archived 排除/未排程归组/防御分支；buildUsageTime 互逆（roundtrip 含 14 药全表）/formatDose | ✅ 已建（79 例，R07+R08+R11+S5审核回归） |
| `unit/migration.test.js` | schema v1→v2 迁移幂等；timeSlots 已存在不覆盖；库存数字迁移前后一致；停药/恢复基准语义（wx 内存 mock） | ✅ 已建（7 例） |
| `unit/settings.test.js` | loadSettings 默认回退/部分覆盖/reminderOn 仅显式 false 关闭/未知时段键忽略；saveSettings（S5 写入方）严格校验落库/非法时刻回退/roundtrip（wx 内存 mock） | ✅ 已建（11 例，S2 起/S5 增 4/审核增 2） |
| `unit/records.test.js` | 用药记录派生（起止日期/至今/原因/排序）；导出文本与 CSV 格式（含表头、列对齐、UTF-8 BOM、引号转义）；消耗流水与停药截断 | ✅ 已建（16 例，S4 增/S5 审核补 CSV 转义 1） |
| `unit/e2e-lifecycle.test.js` | Node 等价层端到端：冷启动注入/迁移 → 添加 → 今日分组 → 停药四联动 → 恢复续接 → 补货导出 | ✅ 已建（5 例，S4 联调） |
| `unit/hardening.test.js` | **任务书S4 安全加固专项**：损坏 storage 防御读取、initialized 首次注入/清空不回注语义、onLaunch 启动兜底、编辑页校验守卫与 timeSlots 同步等价层、导出异常数据容错、迁移失败重试、上限边界组合（缺陷编号 F1-F12 见 `docs/05-testing/`） | ✅ 已建（13 例，2026-11-11） |
| `unit/backup.test.js` | **S5 应用内备份/恢复（F5）**：备份载荷结构、导入校验防御（标识/非对象/缺 medicines/全无效拒绝、部分无效剔除计数）、v1/v2 备份恢复迁移统一、端到端 roundtrip（14 药+设置 → 序列化 → 破坏现场 → 还原）、空备份拒收、畸形字段剔除（审核 F-03）、畸形 settings 拦截（F-02） | ✅ 已建（11 例，2026-11-11） |

约定：测试数据不含真实敏感信息；`tests/helper.js` 不匹配 `*.test.js`，不会被 run-all 误执行。
