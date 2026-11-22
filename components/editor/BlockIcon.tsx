import type { IconType } from "react-icons";
import {
  LuCodeXml,
  LuColumns3,
  LuHeading1,
  LuImage,
  LuMinus,
  LuMousePointerClick,
  LuMoveVertical,
  LuPanelBottom,
  LuPanelTop,
  LuShare2,
  LuType,
} from "react-icons/lu";
import type { BlockType } from "@/lib/email/types";

const ICONS: Record<BlockType, IconType> = {
  heading: LuHeading1,
  text: LuType,
  image: LuImage,
  button: LuMousePointerClick,
  columns: LuColumns3,
  hero: LuPanelTop,
  divider: LuMinus,
  spacer: LuMoveVertical,
  social: LuShare2,
  footer: LuPanelBottom,
  html: LuCodeXml,
};

export function BlockIcon({ type, className = "h-5 w-5" }: { type: BlockType; className?: string }) {
  const Icon = ICONS[type];
  return <Icon className={className} aria-hidden />;
}
