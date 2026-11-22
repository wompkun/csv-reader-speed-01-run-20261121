// Spec tests for solve.js run(input) — expectations derived by hand from
// RULES.txt ("The task") and the csv-reader 1.0.0 policy. Run: node test.mjs
import { run } from './solve.js';

let passed = 0;
let failed = 0;

function check(name, input, expected) {
  const got = run(input);
  const a = JSON.stringify(got);
  const b = JSON.stringify(expected);
  if (a === b) {
    passed++;
  } else {
    failed++;
    console.log(`FAIL ${name}\n  input:    ${JSON.stringify(input)}\n  expected: ${b}\n  got:      ${a}`);
  }
}

const E = (code, line, row, extra) => ({ code, line, row, ...(extra ?? {}) });

// 1. BOM dropped at the very start
check('bom', { text: '\uFEFFa,b\n1,2\n', header: true },
  { columns: ['a', 'b'], rows: [['1', '2']], errors: [] });

// 2. CRLF record endings
check('crlf', { text: 'a,b\r\n1,2\r\n', header: true },
  { columns: ['a', 'b'], rows: [['1', '2']], errors: [] });

// 3. Lone CR outside quotes is dropped, stray_cr
check('lone-cr', { text: 'a,b\n1\r2,3\n', header: true },
  { columns: ['a', 'b'], rows: [['12', '3']], errors: [E('stray_cr', 2, 0)] });

// 4. Quoted field, doubled quotes
check('doubled-quote', { text: '"a""b",c\n', header: false },
  { columns: null, rows: [['a"b', 'c']], errors: [] });

// 5. CRLF inside quotes becomes LF
check('crlf-in-quotes', { text: '"a\r\nb",c\nx,y\n', header: false },
  { columns: null, rows: [['a\nb', 'c'], ['x', 'y']], errors: [] });

// 6. Lone CR inside quotes becomes LF
check('lone-cr-in-quotes', { text: '"a\rb",c\n', header: false },
  { columns: null, rows: [['a\nb', 'c']], errors: [] });

// 7. quote_junk appended as it stands
check('quote-junk', { text: '"ab"cd,ef\n', header: false },
  { columns: null, rows: [['abcd', 'ef']], errors: [E('quote_junk', 1, 0)] });

// 8. Nothing after the closing quote: no quote_junk
check('quote-no-junk', { text: '"ab",c\n', header: false },
  { columns: null, rows: [['ab', 'c']], errors: [] });

// 9. Unterminated quote: quote is literal, text re-read as unquoted
check('unterminated', { text: '"ab,cd\nef,gh\n', header: false },
  { columns: null, rows: [['"ab', 'cd'], ['ef', 'gh']],
    errors: [E('unterminated_quote', 1, 0)] });

// 10. Quote inside an unquoted field is literal
check('quote-in-unquoted', { text: 'a"b,c\n', header: false },
  { columns: null, rows: [['a"b', 'c']], errors: [] });

// 11. short_row pads with empty strings
check('short-row', { text: 'a,b,c\n1,2\n', header: true },
  { columns: ['a', 'b', 'c'], rows: [['1', '2', '']],
    errors: [E('short_row', 2, 0, { fields: 2 })] });

// 12. long_row cuts, extra holds the cut fields
check('long-row', { text: 'a,b\n1,2,3\n', header: true },
  { columns: ['a', 'b'], rows: [['1', '2']],
    errors: [E('long_row', 2, 0, { extra: ['3'] })] });

// 13. header false: first record is a row, columns null
check('header-false', { text: 'a,b\n1,2\n', header: false },
  { columns: null, rows: [['a', 'b'], ['1', '2']], errors: [] });

// 14. Empty lines (LF and CRLF) are no records
check('empty-lines', { text: 'a,b\n\n1,2\n\r\n3,4\r\n', header: true },
  { columns: ['a', 'b'], rows: [['1', '2'], ['3', '4']], errors: [] });

// 15. Error order: field errors as met, row error when the record ends
check('error-order', { text: 'a,b\n1\r2,3\n4,5,6\n', header: true },
  { columns: ['a', 'b'], rows: [['12', '3'], ['4', '5']],
    errors: [E('stray_cr', 2, 0), E('long_row', 3, 1, { extra: ['6'] })] });

// 16. Error line counts every LF inside quotes
check('error-line-in-quotes', { text: '"x\ny",b\n1,2,3\n', header: false },
  { columns: null, rows: [['x\ny', 'b'], ['1', '2']],
    errors: [E('long_row', 3, 1, { extra: ['3'] })] });

// 17. A line holding only stray CRs is no record, but its errors stay
check('stray-cr-only-line', { text: 'a,b\n\r\r\r\n1,2\n', header: true },
  { columns: ['a', 'b'], rows: [['1', '2']],
    errors: [E('stray_cr', 2, 0), E('stray_cr', 2, 0)] });

// 18. A line holding only a quoted empty field IS a record
check('quoted-empty-line', { text: '""\n', header: false },
  { columns: null, rows: [['']], errors: [] });

// 19. Trailing comma makes a trailing empty field; EOF ends the record
check('trailing-comma', { text: 'a,', header: false },
  { columns: null, rows: [['a', '']], errors: [] });

// 20. Empty text
check('empty', { text: '', header: false },
  { columns: null, rows: [], errors: [] });
check('empty-header', { text: '', header: true },
  { columns: [], rows: [], errors: [] });

// 21. quote_junk with a stray CR inside the junk: stray_cr first, then quote_junk
check('junk-with-stray-cr', { text: '"ab"c\rde,f\n', header: false },
  { columns: null, rows: [['abcde', 'f']],
    errors: [E('stray_cr', 1, 0), E('quote_junk', 1, 0)] });

// 22. CRLF right after a closing quote ends the record (width is 1 from the
// first record, so the second record's second field is a long_row)
check('crlf-after-quote', { text: '"ab"\r\nc,d\n', header: false },
  { columns: null, rows: [['ab'], ['c']],
    errors: [E('long_row', 2, 1, { extra: ['d'] })] });

// 23. EOF right after a closing quote
check('eof-after-quote', { text: '"ab"', header: false },
  { columns: null, rows: [['ab']], errors: [] });

// 24. Junk up to EOF
check('junk-to-eof', { text: '"ab"x', header: false },
  { columns: null, rows: [['abx']], errors: [E('quote_junk', 1, 0)] });

// 25. Header row errors carry row null; row error carries the row index
check('header-error-row-null', { text: '"a"j,b\n1\n', header: true },
  { columns: ['aj', 'b'], rows: [['1', '']],
    errors: [E('quote_junk', 1, null), E('short_row', 2, 0, { fields: 1 })] });

// 26. Lone CR at EOF
check('lone-cr-at-eof', { text: 'a,b\n1,2\r', header: true },
  { columns: ['a', 'b'], rows: [['1', '2']], errors: [E('stray_cr', 2, 0)] });

// 27. BOM alone
check('bom-only', { text: '\uFEFF', header: false },
  { columns: null, rows: [], errors: [] });

// 28. Doubled quote at the end of a quoted field
check('doubled-at-end', { text: '"a""",b\n', header: false },
  { columns: null, rows: [['a"', 'b']], errors: [] });

// 29. Unterminated quote resets the line count; next record's error line follows
check('unterminated-line-reset', { text: '"ab\ncd,ef\n', header: false },
  { columns: null, rows: [['"ab'], ['cd']],
    errors: [E('unterminated_quote', 1, 0), E('long_row', 2, 1, { extra: ['ef'] })] });

// 30. Comma inside a quoted field does not split
check('comma-in-quotes', { text: '"a,b",c\n', header: false },
  { columns: null, rows: [['a,b', 'c']], errors: [] });

// 31. CRLF inside quotes counts one line for the next record's error line
check('crlf-in-quotes-line', { text: '"a\r\nb",c\n1,2,3\n', header: true },
  { columns: ['a\nb', 'c'], rows: [['1', '2']],
    errors: [E('long_row', 3, 0, { extra: ['3'] })] });

// 32. A field that is only stray CRs before a comma still yields a record
check('stray-cr-then-comma', { text: '\r,x\n', header: false },
  { columns: null, rows: [['', 'x']], errors: [E('stray_cr', 1, 0)] });

// 33. Multiple quoted fields, mixed with unquoted
check('mixed-fields', { text: 'a,"b,c","d""e",f\n', header: false },
  { columns: null, rows: [['a', 'b,c', 'd"e', 'f']], errors: [] });

// 34. Quoted field spanning lines keeps the record together
check('multiline-quoted', { text: 'a,b\n"x\ny\nz",2\n3,4\n', header: true },
  { columns: ['a', 'b'], rows: [['x\ny\nz', '2'], ['3', '4']], errors: [] });

// 35. Lone CR inside quotes followed by LF inside quotes: two LFs, line +2
check('cr-lf-in-quotes', { text: '"a\rb\nc",d\n1,2,3\n', header: true },
  { columns: ['a\nb\nc', 'd'], rows: [['1', '2']],
    errors: [E('long_row', 4, 0, { extra: ['3'] })] });

console.log(`spec tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
