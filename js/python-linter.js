/* =====================================================================
   SQL-Optima Studio — Python Tokenizer & Indentation Stack Analyzer
   Detects AST Syntax Deficiencies, Indentation Errors, & Dangling Braces
   ===================================================================== */
(function () {
  'use strict';

  function lintPython(code) {
    var lines = code.split('\n');
    var diagnostics = [];
    var indentStack = [0];

    var parenCount = 0;
    var bracketCount = 0;
    var braceCount = 0;

    for (var i = 0; i < lines.length; i++) {
      var lineNo = i + 1;
      var raw = lines[i];

      // Strip comments
      var clean = raw.split('#')[0];
      if (!clean.trim()) continue;

      // Count delimiters
      for (var charIdx = 0; charIdx < clean.length; charIdx++) {
        var ch = clean[charIdx];
        if (ch === '(') parenCount++;
        else if (ch === ')') parenCount--;
        else if (ch === '[') bracketCount++;
        else if (ch === ']') bracketCount--;
        else if (ch === '{') braceCount++;
        else if (ch === '}') braceCount--;
      }

      // Check Indentation when not inside explicit multiline parentheses
      if (parenCount === 0 && bracketCount === 0 && braceCount === 0) {
        var matchIndent = raw.match(/^([ ]*)/);
        var indent = matchIndent ? matchIndent[1].length : 0;

        if (raw.indexOf('\t') !== -1) {
          diagnostics.push({ line: lineNo, col: 1, sev: 'WARN', msg: 'Mixed Tab indent detected. PEP 8 mandates 4 space characters.' });
        }

        var prevIndent = indentStack[indentStack.length - 1];
        if (indent > prevIndent) {
          indentStack.push(indent);
        } else if (indent < prevIndent) {
          while (indentStack.length > 1 && indentStack[indentStack.length - 1] > indent) {
            indentStack.pop();
          }
          if (indentStack[indentStack.length - 1] !== indent) {
            diagnostics.push({ line: lineNo, col: indent + 1, sev: 'ERROR', msg: 'IndentationError: unindent does not match any outer indentation level.' });
          }
        }
      }

      // Clause Colons
      if (/^\s*(def|class|if|elif|else|for|while|try|except|finally|with)\b/.test(clean)) {
        if (!clean.trim().endsWith(':')) {
          diagnostics.push({ line: lineNo, col: clean.length, sev: 'ERROR', msg: 'SyntaxError: expected ":" at termination of control statement.' });
        }
      }

      // Assignment in conditional check (Single equals instead of comparison)
      if (/^\s*(if|elif|while)\b.*[^=!<>]=[^=]/.test(clean)) {
        diagnostics.push({ line: lineNo, col: 1, sev: 'ERROR', msg: 'SyntaxError: invalid syntax. Maybe you meant "==" or ":="?' });
      }
    }

    if (parenCount !== 0) diagnostics.push({ line: lines.length, col: 1, sev: 'ERROR', msg: 'SyntaxError: unmatched parentheses "()".' });
    if (bracketCount !== 0) diagnostics.push({ line: lines.length, col: 1, sev: 'ERROR', msg: 'SyntaxError: unmatched brackets "[]".' });
    if (braceCount !== 0) diagnostics.push({ line: lines.length, col: 1, sev: 'ERROR', msg: 'SyntaxError: unmatched braces "{}".' });

    return {
      valid: diagnostics.filter(function (d) { return d.sev === 'ERROR'; }).length === 0,
      diagnostics: diagnostics
    };
  }

  window.PythonLinter = {
    lint: lintPython
  };
})();