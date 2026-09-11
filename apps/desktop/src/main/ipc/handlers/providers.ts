/** 供应商域 IPC：CRUD + key（safeStorage）+ 列模型。 */
import { ipcMain } from 'electron';
import { createProvider, deleteProvider, listProviders, updateProvider } from '../../db/providers.js';
import { deleteProviderKey, hasProviderKey, writeProviderKey } from '../../host/secrets.js';
import { fetchProviderModels } from '../../host/provider-models.js';
import { FUNDET_INVOKE } from '../channels.js';
import type { FetchModelsInput, ProviderInput } from '../../../shared/fundet-api.js';

export function registerProviderHandlers(): void {
  ipcMain.handle(FUNDET_INVOKE.PROVIDERS_LIST, async () => listProviders());

  ipcMain.handle(FUNDET_INVOKE.PROVIDERS_CREATE, async (_e, input: ProviderInput) =>
    createProvider(input),
  );

  ipcMain.handle(FUNDET_INVOKE.PROVIDERS_UPDATE, async (_e, id: string, patch: Partial<ProviderInput>) =>
    updateProvider(id, patch),
  );

  ipcMain.handle(FUNDET_INVOKE.PROVIDERS_DELETE, async (_e, id: string) => {
    deleteProvider(id);
    deleteProviderKey(id);
  });

  ipcMain.handle(FUNDET_INVOKE.PROVIDERS_SET_KEY, async (_e, providerId: string, key: string) => {
    if (!key.trim()) throw new Error('API key 不能为空');
    writeProviderKey(providerId, key.trim());
  });

  ipcMain.handle(FUNDET_INVOKE.PROVIDERS_HAS_KEY, async (_e, providerId: string) =>
    hasProviderKey(providerId),
  );

  ipcMain.handle(FUNDET_INVOKE.PROVIDERS_FETCH_MODELS, async (_e, input: FetchModelsInput) =>
    fetchProviderModels(input),
  );
}
