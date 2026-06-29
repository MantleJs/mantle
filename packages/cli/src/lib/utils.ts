import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname } from "node:path";
import { constants } from "node:fs";
import { format, resolveConfig } from "prettier";

export function toPascalCase(str: string): string {
  return str
    .replace(/[-_\s]+(.)/g, (_, char: string) => char.toUpperCase())
    .replace(/^(.)/, (_, char: string) => char.toUpperCase());
}

export function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function formatContent(filePath: string, content: string): Promise<string> {
  try {
    const config = await resolveConfig(filePath);
    return await format(content, { ...(config ?? {}), filepath: filePath });
  } catch {
    return content;
  }
}

export async function writeGeneratedFile(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const formatted = await formatContent(filePath, content);
  await writeFile(filePath, formatted, "utf-8");
  console.log(`  created  ${filePath}`);
}
