/* =====================================================================
   SQL-Optima Studio — IEC 61131-3 Structured Text Recursive Descent Parser
   Validates Program Blocks, Nested Control Logic, & Syntax Structures
   ===================================================================== */
(function () {
  'use strict';

  function parseStructuredText(code) {
    var lines = code.split('\n');
    var diagnostics = [];

    var blockStack = [];
    var declaredVariables = new Set();
    var inVarBlock = false;

    for (var i = 0; i < lines.length; i++) {
      var lineNo = i + 1;
      var rawLine = lines[i];
      var clean = rawLine.replace(/\(\*[\s\S]*?\*\)/g, '').trim();

      if (!clean) continue;

      // Variable Declarations
      if (/^VAR\b|^VAR_INPUT\b|^VAR_OUTPUT\b|^VAR_TEMP\b/i.test(clean)) {
        inVarBlock = true;
        continue;
      }
      if (/^END_VAR\b/i.test(clean)) {
        inVarBlock = false;
        continue;
      }
      if (inVarBlock) {
        var varMatch = clean.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/);
        if (varMatch) declaredVariables.add(varMatch[1].toUpperCase());
        continue;
      }

      // Block Openers
      if (/^PROGRAM\b/i.test(clean)) blockStack.push({ type: 'PROGRAM', line: lineNo });
      else if (/^FUNCTION_BLOCK\b/i.test(clean)) blockStack.push({ type: 'FUNCTION_BLOCK', line: lineNo });
      else if (/^FUNCTION\b/i.test(clean)) blockStack.push({ type: 'FUNCTION', line: lineNo });
      else if (/^IF\b/i.test(clean)) {
        if (!/\bTHEN\b/i.test(clean)) {
          diagnostics.push({ line: lineNo, col: clean.length, sev: 'ERROR', msg: 'Missing THEN keyword after IF condition.' });
        }
        blockStack.push({ type: 'IF', line: lineNo });
      } else if (/^CASE\b/i.test(clean)) {
        if (!/\bOF\b/i.test(clean)) {
          diagnostics.push({ line: lineNo, col: clean.length, sev: 'ERROR', msg: 'Missing OF keyword after CASE expression.' });
        }
        blockStack.push({ type: 'CASE', line: lineNo });
      } else if (/^FOR\b/i.test(clean)) {
        if (!/\bDO\b/i.test(clean)) {
          diagnostics.push({ line: lineNo, col: clean.length, sev: 'ERROR', msg: 'Missing DO keyword after FOR loop specification.' });
        }
        blockStack.push({ type: 'FOR', line: lineNo });
      } else if (/^WHILE\b/i.test(clean)) {
        if (!/\bDO\b/i.test(clean)) {
          diagnostics.push({ line: lineNo, col: clean.length, sev: 'ERROR', msg: 'Missing DO keyword after WHILE condition.' });
        }
        blockStack.push({ type: 'WHILE', line: lineNo });
      }

      // Block Closers
      if (/^END_IF\b/i.test(clean)) {
        var top = blockStack.pop();
        if (!top || top.type !== 'IF') {
          diagnostics.push({ line: lineNo, col: 1, sev: 'ERROR', msg: 'Unexpected END_IF without matching IF construct.' });
        }
      } else if (/^END_CASE\b/i.test(clean)) {
        var topCase = blockStack.pop();
        if (!topCase || topCase.type !== 'CASE') {
          diagnostics.push({ line: lineNo, col: 1, sev: 'ERROR', msg: 'Unexpected END_CASE without matching CASE construct.' });
        }
      } else if (/^END_FOR\b/i.test(clean)) {
        var topFor = blockStack.pop();
        if (!topFor || topFor.type !== 'FOR') {
          diagnostics.push({ line: lineNo, col: 1, sev: 'ERROR', msg: 'Unexpected END_FOR without matching FOR construct.' });
        }
      } else if (/^END_WHILE\b/i.test(clean)) {
        var topWhile = blockStack.pop();
        if (!topWhile || topWhile.type !== 'WHILE') {
          diagnostics.push({ line: lineNo, col: 1, sev: 'ERROR', msg: 'Unexpected END_WHILE without matching WHILE construct.' });
        }
      } else if (/^END_PROGRAM\b/i.test(clean)) {
        var topProg = blockStack.pop();
        if (!topProg || topProg.type !== 'PROGRAM') {
          diagnostics.push({ line: lineNo, col: 1, sev: 'ERROR', msg: 'Unexpected END_PROGRAM statement.' });
        }
      }

      // Check Semicolon Termination for Statements
      if (!/^(IF|THEN|ELSE|ELSIF|CASE|OF|FOR|WHILE|DO|VAR|END_VAR|PROGRAM|END_PROGRAM|FUNCTION|END_FUNCTION)\b/i.test(clean) &&
          !/^(END_IF|END_CASE|END_FOR|END_WHILE)$/i.test(clean)) {
        if (!clean.endsWith(';') && !clean.endsWith('*)')) {
          diagnostics.push({ line: lineNo, col: clean.length, sev: 'WARN', msg: 'Instruction missing terminating semicolon (;).' });
        }
      }
    }

    // Dangling unclosed blocks
    while (blockStack.length > 0) {
      var dangling = blockStack.pop();
      diagnostics.push({
        line: dangling.line,
        col: 1,
        sev: 'ERROR',
        msg: 'Unclosed ' + dangling.type + ' construct opened at line ' + dangling.line + '.'
      });
    }

    return {
      valid: diagnostics.filter(function (d) { return d.sev === 'ERROR'; }).length === 0,
      diagnostics: diagnostics
    };
  }

  window.StructuredTextParser = {
    parse: parseStructuredText
  };
})();