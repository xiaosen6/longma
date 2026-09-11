import { useCallback, useEffect, useState } from 'react';
import type { SessionAttachment } from '../../../../shared/fundet-api.ts';

/**
 * 桌宠截图问答（renderer 侧）：在线收 PET_SCREENSHOT push + 挂载补领
 * （用户停在设置页等路由时点的截图，主进程排队待领，回聊天页补上）。
 * accept 负责归一附件（staging 到当前会话目录）；成功后才 bump focusTick
 * 聚焦输入框（失败不抢焦点）。失败文案经 onNotice 上抛。
 */
export function usePetShots(
  accept: (list: SessionAttachment[]) => Promise<void> | void,
  onNotice: (msg: string) => void,
): {
  petFocusTick: number;
} {
  const [petFocusTick, setPetFocusTick] = useState(0);

  const acceptPetShots = useCallback(
    async (list: SessionAttachment[]): Promise<void> => {
      if (!list.length) return;
      await accept(list);
      setPetFocusTick((t) => t + 1);
    },
    [accept],
  );

  useEffect(() => {
    const off = window.fundet.onPetScreenshot((p) => {
      if (p.attachment) void acceptPetShots([p.attachment]).catch(() => undefined);
      else onNotice(`截图问答失败：${p.error ?? '未知错误'}`);
    });
    return off;
  }, [acceptPetShots, onNotice]);

  useEffect(() => {
    void window.fundet.petTakePendingScreenshots().then((list) => {
      if (list && list.length > 0) void acceptPetShots(list).catch(() => undefined);
    }).catch(() => undefined);
  }, [acceptPetShots]);

  return { petFocusTick };
}
