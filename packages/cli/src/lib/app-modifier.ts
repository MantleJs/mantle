import ts from "typescript";
import { readFile, writeFile } from "node:fs/promises";
import type { ImportEntry } from "./wiring.js";
import { fileExists, formatContent } from "./utils.js";

export interface AppModification {
  imports: ImportEntry[];
  configureCall: string;
}

function formatImport(entry: ImportEntry): string {
  const specifiers: string[] = [];
  if (entry.defaultImport) specifiers.push(entry.defaultImport);
  if (entry.names?.length) specifiers.push(`{ ${entry.names.join(", ")} }`);
  return `import ${specifiers.join(", ")} from "${entry.path}";`;
}

function isMantleChain(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const expr = node.expression;
  if (ts.isIdentifier(expr) && expr.text === "mantle") return true;
  if (ts.isPropertyAccessExpression(expr) && expr.name.text === "configure") {
    return isMantleChain(expr.expression);
  }
  return false;
}

function findOutermostMantleChain(sourceFile: ts.SourceFile): ts.CallExpression | undefined {
  let result: ts.CallExpression | undefined;

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isMantleChain(node)) {
      if (!result || node.getEnd() > result.getEnd()) {
        result = node;
      }
    }
    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);
  return result;
}

export async function modifyAppFile(appFilePath: string, mod: AppModification): Promise<boolean> {
  if (!(await fileExists(appFilePath))) return false;

  const source = await readFile(appFilePath, "utf-8");
  const sourceFile = ts.createSourceFile(appFilePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  let lastImportEnd = -1;
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      lastImportEnd = statement.getEnd();
    }
  }

  const mantleChain = findOutermostMantleChain(sourceFile);
  if (lastImportEnd === -1 || !mantleChain) return false;

  const mantleChainEnd = mantleChain.getEnd();
  const importLines = mod.imports.map(formatImport).join("\n");

  // Insert configure first (higher source position) so import position stays valid
  let modified = source.slice(0, mantleChainEnd) + `\n  .configure(${mod.configureCall})` + source.slice(mantleChainEnd);
  modified = modified.slice(0, lastImportEnd) + `\n${importLines}` + modified.slice(lastImportEnd);

  await writeFile(appFilePath, await formatContent(appFilePath, modified), "utf-8");
  return true;
}
