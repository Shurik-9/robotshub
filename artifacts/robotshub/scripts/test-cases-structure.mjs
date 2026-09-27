import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const casesPagePath = path.join(projectRoot, "src/pages/cases.tsx");
const objectTemplatesPath = path.join(projectRoot, "src/data/object-templates");
const casesPage = await readFile(casesPagePath, "utf8");

const caseCardDeclarations = [
  ...casesPage.matchAll(
    /^\s*(?:(?:export\s+)?(?:async\s+)?function\s+CaseCard\b|(?:export\s+)?(?:const|let|var)\s+CaseCard\s*=)/gm,
  ),
];
const defaultExportDeclarations = [...casesPage.matchAll(/^\s*export\s+default\b[^\n]*/gm)];

test("страница кейсов содержит одну рабочую реализацию CaseCard и один default-экспорт Cases", () => {
  assert.equal(
    caseCardDeclarations.length,
    1,
    `Нарушение структуры cases.tsx: ожидается ровно одна рабочая реализация CaseCard, найдено ${caseCardDeclarations.length}.`,
  );

  assert.equal(
    defaultExportDeclarations.length,
    1,
    `Нарушение структуры cases.tsx: ожидается ровно один default-экспорт Cases, найдено ${defaultExportDeclarations.length}.`,
  );

  assert.match(
    defaultExportDeclarations[0][0],
    /^\s*export\s+default\s+(?:function\s+Cases\b|Cases\s*;)/,
    "Нарушение структуры cases.tsx: единственный default-экспорт должен быть Cases.",
  );
});

const objectTemplateFiles = (await readdir(objectTemplatesPath))
  .filter((fileName) => fileName.endsWith(".json"))
  .sort();

function collectObjectTemplateFieldErrors(template, fileName) {
  const errors = [];

  for (const group of template.groups ?? []) {
    for (const field of group.fields ?? []) {
      const context = `Шаблон "${template.name}" (${fileName}), группа "${group.name}" (${group.id}), поле "${field.key}"`;

      if (field.type === "enum") {
        if (!Array.isArray(field.options) || field.options.length === 0) {
          errors.push(`${context}: enum должен содержать непустой массив options.`);
          continue;
        }

        const uniqueOptions = new Set(field.options);
        if (uniqueOptions.size !== field.options.length) {
          errors.push(`${context}: options enum должны быть уникальными.`);
        }

        if (!uniqueOptions.has(field.base)) {
          errors.push(`${context}: base enum должен входить в options.`);
        }
      }

      if (field.type === "bool" && typeof field.base !== "boolean") {
        errors.push(`${context}: base bool должен иметь boolean-тип.`);
      }
    }
  }

  return errors;
}

test("все object-templates содержат рабочие enum и bool-поля", async () => {
  const errors = [];

  for (const fileName of objectTemplateFiles) {
    const template = JSON.parse(
      await readFile(path.join(objectTemplatesPath, fileName), "utf8"),
    );
    errors.push(...collectObjectTemplateFieldErrors(template, fileName));
  }

  assert.deepEqual(
    errors,
    [],
    `Нарушения структуры object-templates:\n${errors.join("\n")}`,
  );
});
