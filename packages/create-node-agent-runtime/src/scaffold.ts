import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { templateFiles, type TemplateFile } from "./template.js";

export interface ScaffoldOptions {
  /** 目标目录（绝对路径；不存在则创建）。 */
  dir: string;
  /** 项目名，写入生成物的 package.json。 */
  name: string;
}

export interface ScaffoldResult {
  dir: string;
  /** 已写入的相对路径。 */
  files: string[];
}

/**
 * 把模板写到目标目录。
 *
 * 遇到**已存在的目标文件一律报错**而不是覆盖：脚手架通常在非空目录里被
 * 误跑（比如当前仓库根），静默覆盖用户文件是这里最不该犯的错。
 */
export async function scaffold(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const dir = resolve(options.dir);
  const files = templateFiles({ name: options.name });

  const collisions = await existingTargets(dir, files);
  if (collisions.length > 0) {
    throw new Error(
      `目标目录已存在这些文件，拒绝覆盖：${collisions.join("、")}\n` +
        `换一个空目录，或加 --force 前先自行确认。`,
    );
  }

  const written: string[] = [];
  for (const file of files) {
    const target = join(dir, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.contents, "utf8");
    written.push(file.path);
  }
  return { dir, files: written };
}

async function existingTargets(dir: string, files: TemplateFile[]): Promise<string[]> {
  const found: string[] = [];
  for (const file of files) {
    try {
      await stat(join(dir, file.path));
      found.push(file.path);
    } catch {
      /* 不存在即是可写 */
    }
  }
  return found;
}
