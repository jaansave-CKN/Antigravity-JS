// ERROR CATCHER: muestra errores JS en pantalla antes de que React monte.
// Archivo aparte (antes era un <script> inline en index.html): la CSP de
// producción (script-src 'self', server.js) bloqueaba el script inline.
window.__errors = [];
window.onerror = function(msg, src, line, col, err) {
  var d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#b91c1c;color:#fff;padding:16px;font:13px monospace;z-index:99999;white-space:pre-wrap;word-break:break-all';
  d.textContent = 'JS ERROR: ' + msg + '\nArchivo: ' + src + ':' + line + ':' + col;
  document.body ? document.body.appendChild(d) : document.addEventListener('DOMContentLoaded', function(){ document.body.appendChild(d); });
  window.__errors.push(msg);
};
window.addEventListener('unhandledrejection', function(e) {
  var d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:60px;left:0;right:0;background:#92400e;color:#fff;padding:16px;font:13px monospace;z-index:99999;white-space:pre-wrap;word-break:break-all';
  d.textContent = 'PROMISE REJECT: ' + (e.reason?.message || e.reason || e);
  document.body ? document.body.appendChild(d) : document.addEventListener('DOMContentLoaded', function(){ document.body.appendChild(d); });
});
