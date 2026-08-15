# scripts/

## diff-guard.mjs

Proves a working-tree change is comment-only. For every changed `.ts` file
it strips comments and normalizes whitespace (via `code-skeleton.mjs`) from
both `HEAD`'s version and the working-tree version, then requires them to be
byte-for-byte identical. Any real code change fails the check and prints the
offending file and line.

Use it after a large comment-only or formatting-only sweep, to prove nothing
else moved.

```
npm run lint:comments
```

Defaults to scanning this repo (auto-detected from the script's own
location); pass repo dirs as arguments to check others instead.
