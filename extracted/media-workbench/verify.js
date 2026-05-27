const fs = require('fs');
const vm = require('vm');
const f = fs.readFileSync('C:/Users/Admin/.qclaw/workspace/media-workbench/index.html', 'utf8');
const i1 = f.indexOf('</script>');
const i2 = f.indexOf('<script>', i1 + 9) + 8;
const i3 = f.lastIndexOf('</script>');
const js = f.substring(i2, i3);
try {
    vm.compileFunction(js, [], { filename: 'w.js' });
    console.log('JS OK - no syntax errors!');
} catch(e) {
    console.log('STILL ERROR:', e.message);
    if (e.stack) {
        const stackLines = e.stack.split('\n').slice(0, 5);
        stackLines.forEach(l => console.log(l));
    }
}
