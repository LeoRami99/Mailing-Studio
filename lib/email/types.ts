// Modelo de datos del editor de mailings.

export type Align = "left" | "center" | "right";

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Propiedades comunes a todos los bloques. */
export interface BlockBase {
  id: string;
  padding: Padding;
  background: string; // "" = transparente
  hideOnMobile?: boolean;
  hideOnDesktop?: boolean;
  /** Clave de variable: el bloque solo se muestra si la variable tiene valor. */
  condition?: string;
  /** Nota interna (no se exporta). */
  label?: string;
}

export interface HeadingBlock extends BlockBase {
  type: "heading";
  html: string;
  level: 1 | 2 | 3;
  fontSize: number;
  color: string;
  align: Align;
  fontWeight: number;
  lineHeight: number;
  fontFamily: string; // "" = hereda
  letterSpacing: number;
}

export interface TextBlock extends BlockBase {
  type: "text";
  html: string;
  fontSize: number;
  color: string;
  align: Align;
  lineHeight: number;
  fontFamily: string;
}

export interface ImageBlock extends BlockBase {
  type: "image";
  src: string;
  alt: string;
  width: number; // px; 0 = ancho completo
  align: Align;
  href: string;
  borderRadius: number;
  /** Variante opcional para modo oscuro. */
  darkSrc?: string;
}

export interface ButtonBlock extends BlockBase {
  type: "button";
  text: string;
  href: string;
  bg: string;
  color: string;
  borderRadius: number;
  fontSize: number;
  fontWeight: number;
  paddingV: number;
  paddingH: number;
  align: Align;
  fullWidth: boolean;
  borderColor: string;
  borderWidth: number;
  fontFamily: string;
}

export interface DividerBlock extends BlockBase {
  type: "divider";
  color: string;
  thickness: number;
  widthPercent: number;
  style: "solid" | "dashed" | "dotted";
}

export interface SpacerBlock extends BlockBase {
  type: "spacer";
  height: number;
}

export interface SocialItem {
  id: string;
  network: string;
  url: string;
  icon: string; // URL de icono (opcional). Si está vacío se usa texto.
  label: string;
}

export interface SocialBlock extends BlockBase {
  type: "social";
  items: SocialItem[];
  align: Align;
  iconSize: number;
  gap: number;
  textColor: string;
  pillBg: string;
  fontSize: number;
}

export interface HtmlBlock extends BlockBase {
  type: "html";
  code: string;
}

export interface FooterBlock extends BlockBase {
  type: "footer";
  html: string;
  fontSize: number;
  color: string;
  linkColor: string;
  align: Align;
  showUnsubscribe: boolean;
  unsubscribeText: string;
  showPreferences: boolean;
  preferencesText: string;
  showWebVersion: boolean;
  webVersionText: string;
}

export interface Column {
  id: string;
  width: number; // porcentaje
  blocks: Block[];
  background: string;
  verticalAlign: "top" | "middle" | "bottom";
}

export interface ColumnsBlock extends BlockBase {
  type: "columns";
  columns: Column[];
  gap: number;
  stackOnMobile: boolean;
}

export interface HeroBlock extends BlockBase {
  type: "hero";
  bgImage: string;
  bgColor: string;
  height: number;
  html: string;
  color: string;
  align: Align;
  fontSize: number;
  buttonText: string;
  buttonHref: string;
  buttonBg: string;
  buttonColor: string;
}

export type Block =
  | HeadingBlock
  | TextBlock
  | ImageBlock
  | ButtonBlock
  | DividerBlock
  | SpacerBlock
  | SocialBlock
  | HtmlBlock
  | FooterBlock
  | ColumnsBlock
  | HeroBlock;

export type BlockType = Block["type"];

export interface Variable {
  key: string; // nombre canónico, p. ej. "nombre"
  label: string;
  sample: string; // valor de ejemplo para la vista previa
  fallback: string; // valor por defecto si llega vacío
  /** Nombre del campo en cada plataforma (opcional). */
  tags: Record<string, string>;
}

export interface EmailSettings {
  title: string;
  subject: string;
  preheader: string;
  lang: string;
  dir: "ltr" | "rtl";
  width: number;
  bodyBg: string;
  contentBg: string;
  textColor: string;
  linkColor: string;
  fontFamily: string;
  /** URL de fuente web (Google Fonts u otra). Se ignora en Outlook. */
  webFontUrl: string;
  contentRadius: number;
  contentPaddingY: number;
  borderColor: string;
  /** Modo oscuro */
  darkMode: boolean;
  darkBodyBg: string;
  darkContentBg: string;
  darkTextColor: string;
  darkLinkColor: string;
  /** Opciones de compatibilidad */
  outlookVml: boolean; // botones redondeados y fondos en Outlook
  mobileBreakpoint: number;
  /** URL pública para convertir rutas relativas de imágenes en absolutas. */
  publicBaseUrl: string;
  /** Parámetros UTM añadidos a todos los enlaces http(s). */
  utm: string;
  customCss: string;
}

export interface EmailDoc {
  version: 1;
  mode: "visual" | "code";
  settings: EmailSettings;
  blocks: Block[];
  /** HTML completo cuando mode === "code" (correo importado). */
  code: string;
  variables: Variable[];
}

export interface Project {
  id: string;
  name: string;
  updatedAt: number;
  doc: EmailDoc;
}
