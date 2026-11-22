// A fast drop-in for csv-reader 1.0.0: run(input) returns exactly csv-reader's
// answer {columns, rows, errors} for {text, header}, but reads the text with
// indexOf-based field scans instead of one character at a time.
//
// Policy (from the competition spec, csv-reader's own):
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF; a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field opening with a quote runs to the next quote that is not doubled
//     ("" inside is one quote; each CRLF or lone CR inside is read as LF);
//     what follows its closing quote, up to the next comma or line break, is
//     appended as it stands (quote_junk, when the field ends); a quote that
//     never closes is a literal character and the text after it is read again
//     as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it, each padded (short_row, with fields: its count)
//     or cut (long_row, with extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}, in the order met; line is the 1-based
//     line its record starts on, counting every LF, CRLF and lone CR inside
//     quotes; row is its record's index in rows, null for the header.
//
// Speed notes: one function, no closures over mutable state, no per-character
// loops on the hot path. Unquoted fields are found with one global-regex exec
// that scans to the nearest of ',', LF and CR, so a slice it bounds can hold
// no CR the scan did not already meet. Quoted fields are found with
// indexOf('"'), and a segment is sliced whole unless it holds a line break,
// in which case CRs are folded to LF and the lines counted then.

// How a field ended: 0 at a comma, 1 at a line break, 2 at the end of the text.
const COMMA = 0;
const BREAK = 1;
const END = 2;

// The next field delimiter: comma, LF or CR. Global, so one exec searches
// forward from lastIndex to the nearest of the three.
const DELIM = /[,\n\r]/g;

/** csv-reader 1.0.0's answer for one case's input, {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  while (pos < n) {
    // Lines with no characters are no records.
    let ch = text.charCodeAt(pos);
    while (ch === 10 || (ch === 13 && text.charCodeAt(pos + 1) === 10)) {
      pos += ch === 10 ? 1 : 2;
      line += 1;
      if (pos >= n) break;
      ch = text.charCodeAt(pos);
    }
    if (pos >= n) break;

    // The record being read: the line it starts on, its index in rows (null: header).
    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    let ended = COMMA;

    do {
      quoted = text.charCodeAt(pos) === 34;
      let value;
      // pending: a value the unquoted scan below starts from (junk after a
      // closing quote, or the literal '"' of an unterminated quote). When it
      // stays null the field is read as one plain unquoted field.
      let pending = null;
      let isJunk = false;

      if (quoted) {
        // A field that opens with a quote.
        const open = pos;
        const openLine = line;
        let acc = null; // the quoted value built so far
        let seg = pos + 1; // start of the segment being scanned
        pos = seg;
        for (;;) {
          const q = text.indexOf('"', pos);
          if (q === -1) {
            // The quote never closes: it is a literal character, and the text
            // after it is read again as unquoted.
            pos = open + 1;
            line = openLine;
            errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
            pending = '"';
            break;
          }
          if (text.charCodeAt(q + 1) === 34) {
            // A doubled quote: one quote, and the field goes on.
            let piece = text.slice(seg, q);
            if (piece.indexOf('\n') !== -1 || piece.indexOf('\r') !== -1) {
              if (piece.indexOf('\r') !== -1) piece = piece.replace(/\r\n?/g, '\n');
              let c = 0;
              let at = piece.indexOf('\n');
              while (at !== -1) {
                c += 1;
                at = piece.indexOf('\n', at + 1);
              }
              line += c;
            }
            acc = acc === null ? piece : acc + piece;
            acc += '"';
            pos = q + 2;
            seg = pos;
            continue;
          }
          // The closing quote.
          let piece = text.slice(seg, q);
          if (piece.indexOf('\n') !== -1 || piece.indexOf('\r') !== -1) {
            if (piece.indexOf('\r') !== -1) piece = piece.replace(/\r\n?/g, '\n');
            let c = 0;
            let at = piece.indexOf('\n');
            while (at !== -1) {
              c += 1;
              at = piece.indexOf('\n', at + 1);
            }
            line += c;
          }
          acc = acc === null ? piece : acc + piece;
          pos = q + 1;
          if (pos >= n) {
            value = acc;
            ended = END;
          } else {
            const nx = text.charCodeAt(pos);
            if (nx === 44) {
              pos += 1;
              value = acc;
              ended = COMMA;
            } else if (nx === 10) {
              pos += 1;
              line += 1;
              value = acc;
              ended = BREAK;
            } else if (nx === 13 && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              value = acc;
              ended = BREAK;
            } else {
              // What follows the closing quote is appended as it stands.
              pending = acc;
              isJunk = true;
            }
          }
          break;
        }
      }

      if (value === undefined) {
        // Read unquoted characters onto `pending` up to the next comma or
        // line break; a CR not followed by LF is dropped (stray_cr). `added`
        // counts the characters kept, for the quote_junk check.
        let acc = pending;
        let added = 0;
        let s = pos;
        for (;;) {
          DELIM.lastIndex = pos;
          const m = DELIM.exec(text);
          if (m === null) {
            // No comma, LF or CR left: the rest of the text is the tail.
            const tail = text.slice(s);
            added += tail.length;
            value = acc === null ? tail : acc + tail;
            pos = n;
            ended = END;
            break;
          }
          const d = m.index;
          const dc = m[0].charCodeAt(0);
          if (dc === 44) {
            const piece = text.slice(s, d);
            added += piece.length;
            value = acc === null ? piece : acc + piece;
            pos = d + 1;
            ended = COMMA;
            break;
          }
          if (dc === 10) {
            const piece = text.slice(s, d);
            added += piece.length;
            value = acc === null ? piece : acc + piece;
            pos = d + 1;
            line += 1;
            ended = BREAK;
            break;
          }
          // A CR: CRLF ends the record, a lone CR is dropped (stray_cr) and
          // the field goes on.
          if (text.charCodeAt(d + 1) === 10) {
            const piece = text.slice(s, d);
            added += piece.length;
            value = acc === null ? piece : acc + piece;
            pos = d + 2;
            line += 1;
            ended = BREAK;
            break;
          }
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          const piece = text.slice(s, d);
          added += piece.length;
          acc = acc === null ? piece : acc + piece;
          pos = d + 1;
          s = pos;
        }
        if (isJunk && added > 0) {
          errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        }
      }

      fields.push(value);
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
