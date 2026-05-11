/**
 * 云开发环境 ID（与云控制台「环境 ID」一致，形如 cloud1-xxxx，不是环境名称）。
 *
 * - **留空 `''`**：使用 `wx.cloud.DYNAMIC_CURRENT_ENV`，与开发者工具里当前选中的云环境一致。
 * - **若 `callFunction` 一直 `system error`**：请到云开发控制台复制 **环境 ID** 填到 `envId`，保存后重新编译；
 *   并确认已对该环境上传云函数 **service**（右键 → 上传并安装依赖）。
 *
 * @see docs/HANDOVER.md 2.2
 */
module.exports = {
  envId: ''
};
