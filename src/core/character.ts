import fs from 'fs/promises';
import path from 'path';
import { Paths, WORKSPACE_ROOT } from './paths.js';

/** 内置角色 JSON 的源目录（与 PROMPTS_SOURCE 同样的源码目录约定）。 */
export const CHARACTERS_SOURCE = path.join(process.cwd(), 'src', 'characters');

export interface Character {
  /** 角色唯一标识，如 'lu_xingye'。 */
  id: string;
  /** 显示名，如 '陆星野'。 */
  name: string;
  gender: 'male' | 'female' | 'mascot';
  /** 头像，emoji 或简短文字描述。 */
  avatar: string;
  /** 一句话定位。 */
  tagline: string;
  /** 性格描述（直接喂给 LLM）。 */
  personality: string;
  /** 说话风格（直接喂给 LLM）。 */
  speechStyle: string;
  /** 称呼用户的方式。 */
  formOfAddress: string;
  /** 自称。 */
  selfAddress: string;
  /** 口头禅。 */
  catchphrases: string[];
  /** 开场白模板，支持占位符 {user_task}。 */
  greetingTemplates: string[];
}

/** workspace/config.json 的结构。 */
interface WorkspaceConfig {
  selectedCharacterId?: string;
}

/** 未选择角色时的默认值。 */
export const DEFAULT_CHARACTER_ID = 'lu_xingye';

/**
 * 从 src/characters/<id>.json 加载单个角色定义。
 * 读取失败时抛出，由调用方决定回退策略。
 */
export async function loadCharacter(id: string): Promise<Character> {
  const file = path.join(CHARACTERS_SOURCE, `${id}.json`);
  const raw = await fs.readFile(file, 'utf-8');
  const c = JSON.parse(raw) as Character;
  if (!c.id || !c.name || !c.personality) {
    throw new Error(`Character ${id} is missing required fields`);
  }
  return c;
}

/** 列出全部内置角色（扫描 src/characters/ 下的 JSON）。 */
export async function listCharacters(): Promise<Character[]> {
  let files: string[];
  try {
    files = await fs.readdir(CHARACTERS_SOURCE);
  } catch {
    return [];
  }
  const ids = files.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
  const characters = await Promise.all(
    ids.sort().map(async (id) => {
      try {
        return await loadCharacter(id);
      } catch {
        return null;
      }
    })
  );
  return characters.filter((c): c is Character => c !== null);
}

/**
 * 读取当前选中的角色 id。config.json 不存在时返回默认角色。
 * 选中 id 对应的角色文件缺失时也回退默认，保证流程不中断。
 */
export async function getSelectedCharacterId(
  configFile: string = Paths.config
): Promise<string> {
  try {
    const raw = await fs.readFile(configFile, 'utf-8');
    const cfg = JSON.parse(raw) as WorkspaceConfig;
    if (cfg.selectedCharacterId) return cfg.selectedCharacterId;
  } catch {
    // config.json 不存在（首次使用），返回默认
  }
  return DEFAULT_CHARACTER_ID;
}

/** 读取当前选中的角色对象（id 解析 + 角色文件加载）。 */
export async function getSelectedCharacter(
  configFile: string = Paths.config
): Promise<Character> {
  const id = await getSelectedCharacterId(configFile);
  try {
    return await loadCharacter(id);
  } catch {
    return await loadCharacter(DEFAULT_CHARACTER_ID);
  }
}

/** 将选中角色 id 持久化到 workspace/config.json。 */
export async function saveSelectedCharacter(
  id: string,
  configFile: string = Paths.config
): Promise<void> {
  const dir = path.dirname(configFile);
  await fs.mkdir(dir, { recursive: true });
  let existing: WorkspaceConfig = {};
  try {
    existing = JSON.parse(await fs.readFile(configFile, 'utf-8')) as WorkspaceConfig;
  } catch {
    // 首次写入，existing 为空对象
  }
  existing.selectedCharacterId = id;
  await fs.writeFile(configFile, JSON.stringify(existing, null, 2), 'utf-8');
}

/** 仅供测试：将工作区根目录重定向到临时目录。 */
export function withWorkspaceRoot(rootDir: string): { config: string } {
  return { config: Paths.config.replace(WORKSPACE_ROOT, rootDir) };
}
