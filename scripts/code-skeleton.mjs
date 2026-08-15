// Prints a file's code with all comments removed and whitespace normalized.
// String/char literals are tracked so a `//` inside a string is not treated
// as a comment start.
import { readFileSync } from "node:fs";

const RAW = "r";
const REGEX_PRECEDERS = "=(,:[!&|?{};+-*%~^<>";

function regexAllowedAfter(line) {
  const prev = line.trimEnd().at(-1);
  return prev === undefined || REGEX_PRECEDERS.includes(prev);
}

export function skeleton(src) {
  const out = [];
  let i = 0;
  let line = "";
  let quote = null;
  let quoteTriple = false;
  let quoteRaw = false;

  const flush = () => {
    const t = line.replace(/\s+/g, " ").trim();
    if (t) out.push(t);
    line = "";
  };

  while (i < src.length) {
    const c = src[i];
    const c2 = src[i + 1];

    if (quote) {
      if (!quoteRaw && c === "\\") {
        line += c + (c2 ?? "");
        i += 2;
        continue;
      }
      if (c === "\n") {
        line += c;
        flush();
        i += 1;
        continue;
      }
      if (c === quote) {
        if (quoteTriple) {
          if (src.slice(i, i + 3) === quote.repeat(3)) {
            line += quote.repeat(3);
            i += 3;
            quote = null;
            continue;
          }
        } else {
          line += c;
          i += 1;
          quote = null;
          continue;
        }
      }
      line += c;
      i += 1;
      continue;
    }

    if (c === "/" && c2 === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      let depth = 1;
      while (i < src.length && depth > 0) {
        if (src[i] === "/" && src[i + 1] === "*") {
          depth += 1;
          i += 2;
        } else if (src[i] === "*" && src[i + 1] === "/") {
          depth -= 1;
          i += 2;
        } else {
          if (src[i] === "\n") flush();
          i += 1;
        }
      }
      continue;
    }
    if (c === "/" && regexAllowedAfter(line)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < src.length && src[j] !== "\n") {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        else if (src[j] === "/" && !inClass) {
          closed = true;
          j += 1;
          break;
        }
        j += 1;
      }
      if (closed) {
        while (j < src.length && /[a-z]/.test(src[j])) j += 1;
        line += src.slice(i, j);
        i = j;
        continue;
      }
    }
    if (c === '"' || c === "'" || c === "`") {
      const isRaw = line.endsWith(RAW) && !/[A-Za-z0-9_$]/.test(line.at(-2) ?? "");
      if (src.slice(i, i + 3) === c.repeat(3)) {
        quote = c;
        quoteTriple = true;
        quoteRaw = isRaw;
        line += c.repeat(3);
        i += 3;
      } else {
        quote = c;
        quoteTriple = false;
        quoteRaw = isRaw;
        line += c;
        i += 1;
      }
      continue;
    }
    if (c === "\n") {
      flush();
      i += 1;
      continue;
    }
    line += c;
    i += 1;
  }
  flush();
  return out.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(skeleton(readFileSync(process.argv[2] ?? 0, "utf8")));
}
