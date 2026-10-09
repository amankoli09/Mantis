import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getApiModelJsonSchema, getReportJsonSchema } from '../src/schema/json-schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const apiModelOutputPath = resolve(__dirname, '../api-model.schema.json');
const apiModelSchema = getApiModelJsonSchema();
writeFileSync(apiModelOutputPath, JSON.stringify(apiModelSchema, null, 2) + '\n', 'utf-8');
console.log(`Generated JSON Schema at: ${apiModelOutputPath}`);

const reportOutputPath = resolve(__dirname, '../report.schema.json');
const reportSchema = getReportJsonSchema();
writeFileSync(reportOutputPath, JSON.stringify(reportSchema, null, 2) + '\n', 'utf-8');
console.log(`Generated JSON Schema at: ${reportOutputPath}`);
