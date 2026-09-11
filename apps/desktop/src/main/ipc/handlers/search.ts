/** 搜索域 IPC：四引擎 key 管理、默认引擎、测试检索。 */
import { ipcMain } from 'electron';
import {
  SEARCH_ENGINES,
  isSearchEngineId,
  type SearchEngineId,
} from '../../../shared/search-engines.ts';
import {
  clearSearchKey,
  getDefaultSearchEngine,
  hasSearchKey,
  readSearchKey,
  resolveSearchEngine,
  setDefaultSearchEngine,
  writeSearchKey,
} from '../../search/config.ts';
import { searchWithEngine } from '../../search/providers.ts';
import { FUNDET_INVOKE } from '../channels.js';

export function registerSearchHandlers(): void {
  ipcMain.handle(FUNDET_INVOKE.SEARCH_STATUS, async () => ({
    engines: SEARCH_ENGINES.map((e) => ({
      id: e.id,
      name: e.name,
      hint: e.hint,
      signupUrl: e.signupUrl,
      hasKey: hasSearchKey(e.id),
    })),
    defaultEngine: getDefaultSearchEngine(),
  }));

  ipcMain.handle(FUNDET_INVOKE.SEARCH_SET_KEY, async (_e, id: string, key: string) => {
    if (!isSearchEngineId(id)) throw new Error('未知搜索引擎');
    writeSearchKey(id, key);
    if (!getDefaultSearchEngine()) setDefaultSearchEngine(id);
  });

  ipcMain.handle(FUNDET_INVOKE.SEARCH_CLEAR_KEY, async (_e, id: string) => {
    if (!isSearchEngineId(id)) throw new Error('未知搜索引擎');
    clearSearchKey(id);
    if (getDefaultSearchEngine() === null) setDefaultSearchEngine(null);
  });

  ipcMain.handle(FUNDET_INVOKE.SEARCH_SET_DEFAULT, async (_e, id: string | null) => {
    if (id !== null && !isSearchEngineId(id)) throw new Error('未知搜索引擎');
    setDefaultSearchEngine(id);
  });

  ipcMain.handle(
    FUNDET_INVOKE.SEARCH_TEST,
    async (_e, query: string, engine?: SearchEngineId) => {
      const resolved = resolveSearchEngine(engine ?? null);
      if (!resolved) {
        return { ok: false, error: '还没有配置任何搜索 API key' };
      }
      const key = readSearchKey(resolved);
      if (!key) return { ok: false, error: `${resolved} 未配置 key` };
      const out = await searchWithEngine(resolved, key, String(query || 'LongMa'), 3);
      if (!out.ok) return { ok: false, error: out.error };
      return { ok: true, engine: out.engine, results: out.results };
    },
  );
}
