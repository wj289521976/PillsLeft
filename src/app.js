const { createLogger } = require('./utils/logger');

const logger = createLogger({ tag: 'app' });

App({
  onLaunch() {
    // 启动兜底（S4 加固）：storage 异常不阻断启动，降级记日志（ARCHITECTURE §6 降级不阻断）
    try {
      const { migrateToV2 } = require('./utils/storage');
      // 首次启动不再注入任何预置数据（2026-11-12 负责人决定：原 14 种"演示药"实为个人真实
      // 用药记录，已从发布代码彻底移除）——新用户/新设备首开为空箱，用药页空态引导添加；
      // 旧设备的 initialized 残留键不再读写（无害遗留，见数据模型 §7 注记）。
      // schema v1→v2 幂等迁移：补 timeSlots，库存数字不变（R07）
      migrateToV2();
    } catch (e) {
      logger.error('启动初始化异常：', e);
    }
  },

  // 统一错误处理：全局 JS 异常与未处理的 Promise 拒绝统一记日志（基线见 ARCHITECTURE.md）
  onError(message) {
    logger.error('全局异常：', message);
  },

  onUnhandledRejection(res) {
    logger.error('未处理的 Promise 拒绝：', res && res.reason);
  },

  globalData: {
    // 应用版本号（S5 起唯一事实来源：设置页展示、上传版本以此为准，与 package.json 同步）
    appVersion: '2.0.0',
    statusColors: {
      sufficient: '#52C41A',
      warning: '#FAAD14',
      out: '#FF4D4F'
    },
    primaryColor: '#2F5496'
  }
});
