#!/usr/bin/env node
// ═════════════════════════════════════════════════════════════════════════════
// Joue un fichier SQL INSTRUCTION PAR INSTRUCTION.
//
// POURQUOI : `prisma db execute --file` envoie le fichier entier comme un
// seul message au serveur. Postgres enveloppe un script multi-instructions
// dans une transaction implicite, et `CREATE INDEX CONCURRENTLY` y est
// interdit (« cannot run inside a transaction block »). `indexes.sql` en
// contient huit : il ne pouvait pas aboutir tel quel.
//
// Chaque instruction est donc envoyée séparément via `--stdin`, ce qui la
// laisse en auto-commit.
//
// Usage : node scripts/run-sql-statements.mjs prisma/sql/indexes.sql
// ═════════════════════════════════════════════════════════════════════════════
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Découpe un script SQL sur les points-virgules de fin d'instruction.
 *
 * Ce n'est volontairement PAS un `split(';')` : les chaînes quotées, les
 * corps de fonction `$$ … $$` et les commentaires contiennent des
 * points-virgules qui ne terminent rien. Un découpage naïf casserait le jour
 * où quelqu'un ajoute une fonction à un fichier joué par ce script.
 */
export function splitStatements(sql) {
  const statements = [];
  let current = '';
  let i = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let inSingleQuote = false;
  let dollarTag = null;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      current += ch;
      if (ch === '\n') inLineComment = false;
      i += 1;
      continue;
    }
    if (inBlockComment) {
      current += ch;
      if (ch === '*' && next === '/') {
        current += next;
        i += 2;
        inBlockComment = false;
        continue;
      }
      i += 1;
      continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }
    if (inSingleQuote) {
      current += ch;
      if (ch === "'") {
        // `''` échappe une apostrophe : ce n'est pas une fin de chaîne.
        if (next === "'") {
          current += next;
          i += 2;
          continue;
        }
        inSingleQuote = false;
      }
      i += 1;
      continue;
    }

    if (ch === '-' && next === '-') {
      inLineComment = true;
      current += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      current += ch;
      i += 1;
      continue;
    }
    if (ch === "'") {
      inSingleQuote = true;
      current += ch;
      i += 1;
      continue;
    }

    const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (dollar) {
      dollarTag = dollar[0];
      current += dollarTag;
      i += dollarTag.length;
      continue;
    }

    if (ch === ';') {
      statements.push(current);
      current = '';
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }
  statements.push(current);

  // Écarte les fragments qui ne contiennent que des commentaires ou du blanc
  // — typiquement l'en-tête du fichier et ce qui suit le dernier `;`.
  return statements
    .map((statement) => statement.trim())
    .filter(
      (statement) =>
        statement.length > 0 && !/^(--[^\n]*\n?|\/\*[\s\S]*?\*\/|\s)*$/.test(statement),
    );
}

const file = process.argv[2];
if (!file) {
  console.error('Usage : node scripts/run-sql-statements.mjs <fichier.sql>');
  process.exit(1);
}

const statements = splitStatements(readFileSync(file, 'utf8'));
console.log(`${file} : ${statements.length} instruction(s)`);

for (const [index, statement] of statements.entries()) {
  const firstLine = statement.split('\n').find((line) => !line.trim().startsWith('--')) ?? '';
  console.log(`  [${index + 1}/${statements.length}] ${firstLine.trim().slice(0, 80)}`);

  const result = spawnSync(
    'npx',
    ['prisma', 'db', 'execute', '--stdin', '--schema', 'prisma/schema.prisma'],
    { input: `${statement};\n`, stdio: ['pipe', 'inherit', 'inherit'], shell: process.platform === 'win32' },
  );

  if (result.status !== 0) {
    console.error(`\nÉchec sur l'instruction ${index + 1} de ${file} :\n${statement}\n`);
    process.exit(result.status ?? 1);
  }
}
