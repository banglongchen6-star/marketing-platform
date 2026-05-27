const fs = require('fs');
const html = fs.readFileSync('C:\\Users\\Admin\\.qclaw\\workspace\\media-workbench\\index.html', 'utf8');
const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
let hasError = false;
scripts.forEach((s, i) => {
  const code = s.replace(/<\/?script[^>]*>/gi, '');
  try {
    new Function(code);
    console.log('Script ' + (i+1) + ' OK (' + code.length + ' chars)');
  } catch(e) {
    hasError = true;
    console.error('Script ' + (i+1) + ' ERROR: ' + e.message);
    // 找到错误位置
    const lines = code.split('\n');
    console.error('Total lines: ' + lines.length);
  }
});
if (!hasError) {
  console.log('\n✅ 所有脚本语法正确!');
}
