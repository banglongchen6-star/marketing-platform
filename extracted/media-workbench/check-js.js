const fs = require('fs');
const html = fs.readFileSync('C:/Users/Admin/.qclaw/workspace/media-workbench/index.html', 'utf8');
const matches = html.match(/<script>([\s\S]*?)<\/script>/g);
if (matches) {
  matches.forEach((m, i) => {
    const code = m.replace(/<\/?script>/g, '').trim();
    if (code) {
      try {
        new Function(code);
        console.log(`Script ${i+1} OK (${code.length} chars)`);
      } catch (e) {
        console.log(`Script ${i+1} ERROR:`, e.message);
        // Find the error location
        const lines = code.split('\n');
        const errLine = e.message.match(/line (\d+)/i);
        if (errLine) {
          const lineNum = parseInt(errLine[1]);
          console.log(`Around line ${lineNum}:`);
          console.log(lines.slice(Math.max(0, lineNum - 3), lineNum + 2).join('\n'));
        }
      }
    }
  });
}
