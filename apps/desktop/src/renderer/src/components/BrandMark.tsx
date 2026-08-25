import { cn } from '../lib/cn';
import logoUrl from '../assets/logo.png';

interface BrandMarkProps {
  /** 图形高度；宽度按原图比例 */
  size?: number;
  className?: string;
}

/** 品牌图形（抠白底后的透明 PNG，深浅色都能叠） */
export function BrandMark({ size = 22, className }: BrandMarkProps): React.JSX.Element {
  return (
    <img
      src={logoUrl}
      alt=""
      width={Math.round(size * (581 / 567))}
      height={size}
      draggable={false}
      className={cn('shrink-0 select-none', className)}
    />
  );
}
