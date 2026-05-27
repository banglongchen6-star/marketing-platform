const fs = require('fs');
const vm = require('vm');
const f = fs.readFileSync('C:/Users/Admin/.qclaw/workspace/media-workbench/index.html', 'utf8');
const i1 = f.indexOf('</script>');
const i2 = f.indexOf('<script>', i1 + 9) + 8;
const i3 = f.lastIndexOf('</script>');
const js = f.substring(i2, i3);

// Use vm.compileFunction to get line number
try {
    vm.compileFunction(js, [], { filename: 'workbench.js' });
    console.log('JS OK - no syntax errors');
} catch(e) {
    console.log('Error:', e.message);
    if (e.stack) console.log('Stack:', e.stack);
}

// Also try: split by lines and test each logical chunk
const lines = js.split('\n');
console.log('\nTotal lines:', lines.length);

// Find unmatched parentheses - scan character by character
let depth = 0;
let maxDepth = 0;
let inString = false;
let stringChar = '';
let inTemplate = false;
let templateDepth = 0;
let inLineComment = false;
let inBlockComment = false;
let issues = [];

for (let i = 0; i < js.length; i++) {
    const c = js[i];
    const next = js[i+1] || '';
    
    // Line comment
    if (!inString && !inTemplate && !inBlockComment && c === '/' && next === '/') {
        inLineComment = true;
        i++;
        continue;
    }
    if (inLineComment && c === '\n') { inLineComment = false; continue; }
    if (inLineComment) continue;
    
    // Block comment
    if (!inString && !inTemplate && !inLineComment && c === '/' && next === '*') {
        inBlockComment = true;
        i++;
        continue;
    }
    if (inBlockComment && c === '*' && next === '/') { inBlockComment = false; i++; continue; }
    if (inBlockComment) continue;
    
    // String handling
    if (!inString && !inTemplate && !inLineComment && !inBlockComment) {
        if (c === '"' || c === "'" || c === '`') {
            inString = true;
            stringChar = c;
            if (c === '`') { inTemplate = true; inString = false; }
            continue;
        }
    }
    
    // Close string
    if (inString && c === stringChar && js[i-1] !== '\\') {
        inString = false;
        continue;
    }
    
    // Template literal
    if (inTemplate && c === '`' && js[i-1] !== '\\') {
        inTemplate = false;
        continue;
    }
    
    if (inString || inTemplate || inLineComment || inBlockComment) continue;
    
    // Count parens
    if (c === '(') { depth++; maxDepth = Math.max(maxDepth, depth); }
    if (c === ')') { depth--; if (depth < 0) {
        const lineNum = js.substring(0, i).split('\n').length;
        issues.push(`Extra ) at line ${lineNum}, depth went to ${depth}`);
    }}
}

if (depth !== 0) {
    console.log(`\nUnmatched parens! Final depth: ${depth} (max: ${maxDepth})`);
} else {
    console.log('\nParens balanced (max depth:', maxDepth, ')');
}

if (issues.length > 0) {
    console.log('Issues found:');
    issues.forEach(i => console.log(' ', i));
}

// Check for common error patterns
console.log('\n--- Pattern checks ---');

// Unmatched backticks
let backtickCount = 0;
for (let i = 0; i < js.length; i++) {
    if (js[i] === '`' && (i === 0 || js[i-1] !== '\\')) backtickCount++;
}
console.log('Backtick count (should be even):', backtickCount);

// Check for stray closing parens in template literals or strings that might confuse
// Let me look for function definitions with potential issues
const funcPattern = /function\s*\w*\s*\(/g;
let match;
let funcCount = 0;
while ((match = funcPattern.exec(js)) !== null) {
    funcCount++;
}
console.log('Function definitions found:', funcCount);

// Look for lines with template literals that might contain unclosed expressions
const templatePattern = /\$\{[^}]*$/gm;
while ((match = templatePattern.exec(js)) !== null) {
    const lineNum = js.substring(0, match.index).split('\n').length;
    console.log('Unclosed template expression at line', lineNum, ':', match[0].substring(0, 80));
}
