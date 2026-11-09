// @raspberrycode/ui 的 exports 只提供 JS 类型，样式副作用导入没有对应声明；
// 补环境声明避免 renderer 单独类型检查时报 TS2882。
declare module "@raspberrycode/ui/styles.css";
