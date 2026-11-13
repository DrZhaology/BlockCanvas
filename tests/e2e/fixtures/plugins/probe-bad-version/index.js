// 探针插件：apiVersion 高到程序不支持，**不应该被执行**。
//
// 如果这个文件被执行了（window.__probeBadVersionRan 变成 true），说明版本闸门失效 ——
// 那正是最危险的情形：一个按 API 2 写的插件在 API 1 的宿主上跑到一半崩掉，
// 用户会记成"BlockCanvas 坏了"。
(function (Bc) {
  window.__probeBadVersionRan = true;
  try { Bc.registerCss('body { outline: 3px solid red }'); } catch (e) { /* 忽略 */ }
})(Bc);
