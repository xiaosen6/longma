import { ChevronRight, KeyRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BrandMark } from '../../components/BrandMark';
import { FolderPickerChip } from '../../components/FolderPickerChip';
import { UsageDashboard } from '../../components/UsageDashboard';
import { hasFramelessControls } from '../../components/WindowControls';
import { cn } from '../../lib/cn';
import { brand } from '../../../../shared/brand.js';

/** 空态首页（对齐 cindy-02 解剖）：品牌 wordmark 居中 + 引导卡 + 用量仪表盘。 */
export function ChatEmptyState(props: {
  hasProvider: boolean;
  workDir: string;
  notice: string;
  onPickDir: (dir: string) => void;
  onCreate: () => void;
}): React.JSX.Element {
  const { hasProvider, workDir, notice, onPickDir, onCreate } = props;
  return (
    <div className="flex flex-1 flex-col">
      {/* 拖拽条在窗口按钮左侧截止（mr 而非 pr：app-region 按元素矩形算，
          padding 缩不掉；悬浮 no-drag 挖洞在 Electron 37/Windows 上不可靠） */}
      <div className={cn('drag-region h-[46px] shrink-0', hasFramelessControls() && 'mr-[150px]')} />
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
        <div className="flex w-full max-w-[720px] flex-col items-stretch gap-8 px-6">
          <div className="flex flex-col items-center gap-3 select-none">
            <BrandMark size={56} />
            <div className="text-[40px] leading-none font-medium tracking-tight text-primary">
              {brand.name}
            </div>
          </div>
          {!hasProvider ? (
            // 无 provider：内联「连接模型提供商」引导面板（cindy-02 的 Connect 面板）
            <div className="rounded-container border border-board bg-card p-6">
              <p className="text-18 font-medium text-primary select-none">
                连接模型提供商以开始
              </p>
              <p className="mt-1.5 text-13 text-secondary select-none">
                还没有可用模型。配置一个 OpenAI / Anthropic 兼容端点（BYOK）即可开始对话。
              </p>
              <Link
                to="/settings"
                className="mt-4 flex items-center gap-3 rounded-inner px-3 py-3 transition-colors hover:bg-menu-item-hover select-none"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-chip text-secondary">
                  <KeyRound size={15} strokeWidth={1.8} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-14 font-medium text-primary">添加 Provider</span>
                  <span className="block text-12 text-muted">粘贴 API key 完成连接</span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-muted" />
              </Link>
              {notice && <p className="mt-2 text-13 text-error">{notice}</p>}
            </div>
          ) : (
            <div className="rounded-container border border-board bg-card px-8 py-8 text-center select-none">
              <p className="text-14 text-secondary">选择文件夹，再开启新对话</p>
              <div className="mt-4 flex flex-col items-center gap-3">
                <FolderPickerChip cwd={workDir} onSelect={onPickDir} size="big" />
                <button
                  type="button"
                  className="h-9 rounded-full bg-accent px-4 text-13 text-accent-fg"
                  onClick={onCreate}
                >
                  开启新对话
                </button>
              </div>
              {notice && <p className="mt-2 text-13 text-error">{notice}</p>}
            </div>
          )}
          <div className="w-full">
            <UsageDashboard />
          </div>
        </div>
      </div>
    </div>
  );
}
