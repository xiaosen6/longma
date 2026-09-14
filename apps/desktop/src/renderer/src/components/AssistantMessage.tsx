/**
 * AssistantMessage — 助手消息正文：react-markdown + GFM + 代码高亮。
 *
 * 流式渲染：store 的 32ms 节流控制频率；流式期间按 markdown 块边界切分
 * （lib/streamingBlocks.ts），已封口的块 memo 后零重解析、每 tick 只重解析
 * 尾部未完成块（对齐 Cindy ceb279db0 块级复用：长文档流式帧耗时数量级下降），
 * 尾块挂 streamWordFade 逐词淡入（reduced-motion 下不挂）；终版渲染零 span
 * 包装、单 ReactMarkdown 全文（跨块上下文零差异）。
 */
import { memo, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkCjkFriendly from 'remark-cjk-friendly';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { normalizeMathDelimiters } from '../lib/mathMarkdown';
import { normalizeKbCitations, parseKbCiteHref } from '../lib/kbCitation';
import { splitStreamingBlocks } from '../lib/streamingBlocks';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { isImagePath } from '../lib/artifacts';
import { createStreamFadeState, rehypeStreamWordFade, type StreamFadeState } from '../lib/streamWordFade';
import { LocalImagePreview, looksLikeFilePath } from './LocalImagePreview';
import { isMermaidClassName, MarkdownMermaidBlock } from './chat/MarkdownMermaidBlock';
import type { KnowledgeRef } from '../../../shared/fundet-api.ts';

interface AssistantMessageProps {
  text: string;
  /** 流式进行中：启用块级复用与逐词淡入 */
  streaming?: boolean;
  workDir?: string;
  onOpenFile?: (path: string) => void;
  /** 本回合 @知识库注入的引用（溯源角标数据）；无则正文 [n] 原样显示 */
  kbRefs?: KnowledgeRef[];
}

function flattenText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join('');
  if (typeof node === 'object' && node && 'props' in node) {
    return flattenText((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return '';
}

/** 行内 code 是图片路径时的预览芯片：文件加载失败（双路都挂）整体退回普通 code 文本 */
function FilePathCodeChip({
  raw,
  workDir,
  onOpenFile,
}: {
  raw: string;
  workDir: string;
  onOpenFile?: (path: string) => void;
}): React.JSX.Element {
  const [broken, setBroken] = useState(false);
  if (broken) return <code>{raw}</code>;
  return (
    <span className="my-2 block">
      <button
        type="button"
        title="点击预览图片"
        onClick={() => onOpenFile?.(raw)}
        className="cursor-pointer font-mono text-12 text-secondary underline decoration-board underline-offset-2 hover:text-primary"
      >
        {raw}
      </button>
      <LocalImagePreview path={raw} workDir={workDir} onOpen={onOpenFile} onBroken={() => setBroken(true)} />
    </span>
  );
}

/** markdown components 配置工厂：流式块组件与终版全文渲染共用 */
function buildMdComponents(ctx: {
  workDir?: string;
  onOpenFile?: (path: string) => void;
  kbRefs?: KnowledgeRef[];
  activeCite: number | null;
  setActiveCite: (n: number | null) => void;
}) {
  const { workDir, onOpenFile, kbRefs, activeCite, setActiveCite } = ctx;
  return {
    pre: ({ children }: { children?: ReactNode }) => {
      // ```mermaid 围栏 → SVG 图表（解析失败回落源码）
      const child = Array.isArray(children) ? children[0] : children;
      const cls = (child as { props?: { className?: string } } | undefined)?.props?.className;
      if (typeof cls === 'string' && isMermaidClassName(cls)) {
        const raw = flattenText((child as { props?: { children?: ReactNode } }).props?.children);
        return <MarkdownMermaidBlock raw={raw} />;
      }
      return <pre>{children}</pre>;
    },
    a: ({ href, children }: { href?: string; children?: ReactNode }) => {
      // 知识库溯源角标：[n](#kb-n) → 上标小角标，点击在消息底部展开原文块
      const cite = parseKbCiteHref(href);
      if (cite !== null && kbRefs && cite <= kbRefs.length) {
        const ref = kbRefs[cite - 1];
        const active = activeCite === cite;
        return (
          <button
            type="button"
            title={`来源：${ref.itemName}（第 ${ref.seq + 1} 块）`}
            onClick={() => setActiveCite(active ? null : cite)}
            className={
              'mx-0.5 inline-flex h-[15px] min-w-[15px] cursor-pointer items-center justify-center rounded-[4px] px-[3px] align-super text-[10px] leading-none transition-colors ' +
              (active
                ? 'bg-accent text-accent-fg'
                : 'bg-chip text-secondary hover:bg-menu-item-hover hover:text-primary')
            }
          >
            {cite}
          </button>
        );
      }
      // http(s) 进系统浏览器；相对/本地路径走右侧 Canvas 预览。
      // 不拦截会让 Electron 主窗口整页跳走（will-navigate 还有一道主进程兜底）。
      return (
        <a
          href={href}
          className="cursor-pointer"
          onClick={(e) => {
            if (!href || href.startsWith('#')) return;
            e.preventDefault();
            if (/^https?:\/\//i.test(href)) void window.fundet.openExternal(href);
            else onOpenFile?.(href);
          }}
        >
          {children}
        </a>
      );
    },
    code: ({ className, children }: { className?: string; children?: ReactNode }) => {
      const raw = flattenText(children).trim();
      const isBlock = Boolean(className) || raw.includes('\n');
      if (!isBlock && looksLikeFilePath(raw) && isImagePath(raw)) {
        // 模块级组件持有 broken 状态：文件不存在时整体退回普通 code（不破图）
        return workDir ? (
          <FilePathCodeChip raw={raw} workDir={workDir} onOpenFile={onOpenFile} />
        ) : (
          <code className={className}>{children}</code>
        );
      }
      return <code className={className}>{children}</code>;
    },
    img: ({ src, alt }: { src?: string; alt?: string }) => {
      if (src && workDir && !/^https?:\/\//i.test(src) && !src.startsWith('data:')) {
        return <LocalImagePreview path={src} workDir={workDir} onOpen={onOpenFile} alt={alt} />;
      }
      return <img src={src} alt={alt} className="max-h-[360px] max-w-full rounded-inner object-contain" />;
    },
  };
}

interface StreamingBlockViewProps {
  text: string;
  stable: boolean;
  /** 尾块专属的淡入账本（stable 块不挂 fade 插件） */
  fadeState: StreamFadeState | null;
  components: ReturnType<typeof buildMdComponents>;
}

/** 流式块视图：stable 块 text 不变时整体 skip render（零重解析） */
const StreamingBlockView = memo(function StreamingBlockView({
  text,
  stable,
  fadeState,
  components,
}: StreamingBlockViewProps): React.JSX.Element {
  const rehypePlugins = fadeState && !stable
    ? [rehypeHighlight, rehypeStreamWordFade(fadeState)]
    : [rehypeHighlight];
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkCjkFriendly, remarkMath]}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
});

// 长会话里历史消息的 text/workDir/onOpenFile 都不变；不 memo 的话流式期间
// 每 100ms 全列表重渲染、react-markdown 重解析全部历史。
function AssistantMessageImpl({
  text,
  streaming,
  workDir,
  onOpenFile,
  kbRefs,
}: AssistantMessageProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const [activeCite, setActiveCite] = useState<number | null>(null);
  // 逐词淡入的时序账本：跨渲染存活（流式一轮一份；流式结束即丢弃，
  // 下一轮 turn 重新开播）。reduced-motion 时保持 null = 不挂插件。
  const fadeStateRef = useRef<StreamFadeState | null>(null);
  if (!streaming || reducedMotion) {
    fadeStateRef.current = null;
  } else if (fadeStateRef.current === null) {
    fadeStateRef.current = createStreamFadeState();
  }

  // 对齐 Cindy：() / [] 数学定界符规范化后交给 remark-math；
  // 快速通路（无 LaTeX 定界符）零成本原样返回。
  const normalizedText = normalizeKbCitations(
    normalizeMathDelimiters(text),
    kbRefs?.length ?? 0,
  );

  const components = useMemo(
    () => buildMdComponents({ workDir, onOpenFile, kbRefs, activeCite, setActiveCite }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fade/kbRefs/workDir 引用稳定；activeCite 变化需重建（角标高亮态）
    [workDir, onOpenFile, kbRefs, activeCite],
  );

  const streamingBlocks = streaming ? splitStreamingBlocks(normalizedText) : null;

  return (
    <div className="md text-primary select-text">
      {streaming && streamingBlocks ? (
        // 流式：块级复用（stable 块 memo 跳过；尾块挂逐词淡入）
        streamingBlocks.map((b) => (
          <StreamingBlockView
            key={b.key}
            text={b.text}
            stable={b.stable}
            fadeState={fadeStateRef.current}
            components={components}
          />
        ))
      ) : (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkCjkFriendly, remarkMath]}
          rehypePlugins={[rehypeHighlight, rehypeKatex]}
          components={components}
        >
          {normalizedText}
        </ReactMarkdown>
      )}
      {activeCite !== null && kbRefs && kbRefs[activeCite - 1] ? (
        <div className="mt-2 rounded-inner border border-board bg-card px-3 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 text-12 text-secondary">
              <span className="font-medium text-primary">[{activeCite}]</span>
              <span className="mx-1">来源：{kbRefs[activeCite - 1].itemName}</span>
              <span className="text-muted">
                （第 {kbRefs[activeCite - 1].seq + 1} 块
                {kbRefs[activeCite - 1].baseName ? ` · 库 ${kbRefs[activeCite - 1].baseName}` : ''}）
              </span>
            </div>
            <button
              type="button"
              className="shrink-0 cursor-pointer rounded-full p-0.5 text-muted hover:bg-hover hover:text-primary"
              onClick={() => setActiveCite(null)}
              aria-label="收起来源"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M2.5 2.5l7 7m0-7l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="mt-1.5 max-h-[240px] overflow-y-auto text-12 leading-relaxed whitespace-pre-wrap text-secondary select-text">
            {kbRefs[activeCite - 1].text}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const AssistantMessage = memo(AssistantMessageImpl);
