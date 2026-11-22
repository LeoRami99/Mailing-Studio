import { createBlock, emptyDoc, makeColumn, pad, uid } from "./defaults";
import { extractTemplateCss } from "./html-template";
import type { Block, ButtonBlock, ColumnsBlock, DividerBlock, EmailDoc, FooterBlock, HeadingBlock, ImageBlock, SpacerBlock, TextBlock } from "./types";

export interface ImportReport {
  nativeBlocks: number;
  htmlBlocks: number;
  columns: number;
  warnings: string[];
}

export interface AdaptedTemplate {
  doc: EmailDoc;
  report: ImportReport;
}

const FORBIDDEN = "script,iframe,object,embed,form,video";
const CONTAINERS = new Set(["BODY", "MAIN", "SECTION", "ARTICLE", "HEADER", "DIV", "CENTER", "TBODY", "THEAD", "TFOOT", "TR", "TD", "TH"]);

const px = (value: string | null | undefined, fallback = 0) => {
  const match = value?.match(/-?\d+(?:\.\d+)?/);
  return match ? Math.max(0, Math.round(Number(match[0]))) : fallback;
};

function cleanElement(source: Element): HTMLElement {
  const element = source.cloneNode(true) as HTMLElement;
  element.querySelectorAll(FORBIDDEN).forEach((node) => node.remove());
  for (const node of [element, ...Array.from(element.querySelectorAll("*"))]) {
    for (const attr of Array.from(node.attributes)) {
      if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
    }
  }
  return element;
}

function css(element: HTMLElement, name: string) {
  return element.style.getPropertyValue(name).trim();
}

function background(element: HTMLElement) {
  return css(element, "background-color") || element.getAttribute("bgcolor") || "";
}

function paddingOf(element: HTMLElement) {
  const all = css(element, "padding");
  if (all) {
    const parts = all.split(/\s+/).map((part) => px(part));
    if (parts.length === 1) return pad(parts[0], parts[0], parts[0], parts[0]);
    if (parts.length === 2) return pad(parts[0], parts[1], parts[0], parts[1]);
    if (parts.length === 3) return pad(parts[0], parts[1], parts[2], parts[1]);
    return pad(parts[0], parts[1], parts[2], parts[3]);
  }
  const legacy = px(element.getAttribute("cellpadding"));
  return pad(
    px(css(element, "padding-top"), legacy),
    px(css(element, "padding-right"), legacy),
    px(css(element, "padding-bottom"), legacy),
    px(css(element, "padding-left"), legacy),
  );
}

function applyContainer(blocks: Block[], element: HTMLElement) {
  if (!blocks.length) return blocks;
  const bg = background(element);
  const p = paddingOf(element);
  for (const block of blocks) if (bg && !block.background) block.background = bg;
  blocks[0].padding = { ...blocks[0].padding, top: blocks[0].padding.top + p.top, left: blocks[0].padding.left + p.left, right: blocks[0].padding.right + p.right };
  const last = blocks[blocks.length - 1];
  last.padding = { ...last.padding, bottom: last.padding.bottom + p.bottom, left: last.padding.left + (last === blocks[0] ? 0 : p.left), right: last.padding.right + (last === blocks[0] ? 0 : p.right) };
  return blocks;
}

function htmlBlock(element: HTMLElement): Block {
  return { id: uid(), type: "html", code: cleanElement(element).outerHTML, padding: pad(0, 0, 0, 0), background: "" };
}

function textBlock(element: HTMLElement): TextBlock {
  const block = createBlock("text") as TextBlock;
  block.html = cleanElement(element).outerHTML;
  block.padding = pad(0, 0, 0, 0);
  block.background = background(element);
  block.color = css(element, "color") || block.color;
  block.fontSize = px(css(element, "font-size"), block.fontSize);
  block.align = (element.getAttribute("align") || css(element, "text-align") || block.align) as TextBlock["align"];
  const lineHeight = Number.parseFloat(css(element, "line-height"));
  if (Number.isFinite(lineHeight) && lineHeight > 0 && lineHeight < 5) block.lineHeight = lineHeight;
  return block;
}

function headingBlock(element: HTMLElement): HeadingBlock {
  const block = createBlock("heading") as HeadingBlock;
  block.level = Number(element.tagName.slice(1)) as 1 | 2 | 3;
  const selector = [element.className ? `class="${element.className}"` : "", element.id ? `id="${element.id}"` : ""].filter(Boolean).join(" ");
  block.html = selector ? `<span ${selector}>${cleanElement(element).innerHTML}</span>` : cleanElement(element).innerHTML;
  block.padding = paddingOf(element);
  block.background = background(element);
  block.color = css(element, "color") || block.color;
  block.fontSize = px(css(element, "font-size"), block.fontSize);
  block.fontWeight = px(css(element, "font-weight"), block.fontWeight);
  block.align = (element.getAttribute("align") || css(element, "text-align") || block.align) as HeadingBlock["align"];
  return block;
}

function imageBlock(element: HTMLImageElement): ImageBlock {
  const block = createBlock("image") as ImageBlock;
  block.src = element.getAttribute("src") || "";
  block.alt = element.getAttribute("alt") || "";
  const rawWidth = element.getAttribute("width") || css(element, "width");
  block.width = rawWidth.includes("%") ? 0 : px(rawWidth);
  block.href = element.closest("a")?.getAttribute("href") || "";
  block.align = (element.getAttribute("align") || block.align) as ImageBlock["align"];
  block.borderRadius = px(css(element, "border-radius"));
  block.padding = pad(0, 0, 0, 0);
  return block;
}

function looksLikeButton(element: HTMLAnchorElement) {
  const parent = element.parentElement as HTMLElement | null;
  return Boolean(css(element, "background-color") || parent?.getAttribute("bgcolor") || css(element, "padding") || /btn|button|cta/i.test(element.className));
}

function buttonBlock(element: HTMLAnchorElement): ButtonBlock | null {
  // Si la apariencia depende por completo de una clase, se conserva como HTML.
  if (element.className && !element.getAttribute("style") && !element.parentElement?.getAttribute("bgcolor")) return null;
  const block = createBlock("button") as ButtonBlock;
  const parent = element.parentElement as HTMLElement | null;
  block.text = element.textContent?.trim() || "Abrir";
  block.href = element.getAttribute("href") || "#";
  block.bg = css(element, "background-color") || parent?.getAttribute("bgcolor") || block.bg;
  block.color = css(element, "color") || block.color;
  block.fontSize = px(css(element, "font-size"), block.fontSize);
  block.borderRadius = px(css(element, "border-radius"), block.borderRadius);
  block.align = (parent?.getAttribute("align") || css(parent ?? element, "text-align") || block.align) as ButtonBlock["align"];
  const innerPadding = paddingOf(element);
  if (innerPadding.top || innerPadding.bottom) block.paddingV = Math.round((innerPadding.top + innerPadding.bottom) / 2);
  if (innerPadding.left || innerPadding.right) block.paddingH = Math.round((innerPadding.left + innerPadding.right) / 2);
  block.padding = parent ? paddingOf(parent) : pad(0, 0, 0, 0);
  return block;
}

function directRows(table: HTMLTableElement) {
  return Array.from(table.children).flatMap((child) => child.tagName === "TR" ? [child as HTMLTableRowElement] : ["TBODY", "THEAD", "TFOOT"].includes(child.tagName) ? Array.from(child.children).filter((row) => row.tagName === "TR") as HTMLTableRowElement[] : []);
}

function convertElement(element: HTMLElement, report: ImportReport): Block[] {
  const tag = element.tagName;
  if (["SCRIPT", "STYLE", "LINK", "META", "TITLE", "NOSCRIPT"].includes(tag)) return [];
  if (/^H[1-3]$/.test(tag)) return [headingBlock(element)];
  if (tag === "IMG") {
    if (element.className && !element.getAttribute("style")) return [htmlBlock(element)];
    return [imageBlock(element as HTMLImageElement)];
  }
  if (tag === "HR") {
    const block = createBlock("divider") as DividerBlock;
    block.color = css(element, "border-color") || css(element, "background-color") || block.color;
    block.thickness = px(css(element, "border-width") || element.getAttribute("size"), block.thickness);
    return [block];
  }
  if (tag === "A") {
    const anchor = element as HTMLAnchorElement;
    const onlyImage = anchor.children.length === 1 && anchor.firstElementChild?.tagName === "IMG";
    if (onlyImage) return [imageBlock(anchor.firstElementChild as HTMLImageElement)];
    const button = looksLikeButton(anchor) ? buttonBlock(anchor) : null;
    return button ? [button] : [textBlock(element)];
  }
  if (tag === "P" || tag === "UL" || tag === "OL" || tag === "BLOCKQUOTE") {
    const onlyAnchor = element.children.length === 1 && element.firstElementChild?.tagName === "A" ? element.firstElementChild as HTMLAnchorElement : null;
    const button = onlyAnchor && looksLikeButton(onlyAnchor) ? buttonBlock(onlyAnchor) : null;
    return button ? [button] : [textBlock(element)];
  }
  if (tag === "FOOTER") {
    const block = createBlock("footer") as FooterBlock;
    block.html = cleanElement(element).innerHTML;
    block.padding = paddingOf(element);
    block.background = background(element);
    block.showUnsubscribe = /@unsubscribe|unsubscribe|desuscrib|cancelar suscrip/i.test(block.html);
    return [block];
  }
  if (tag === "TABLE") {
    const table = element as HTMLTableElement;
    const rows = directRows(table);
    if (!rows.length) return [htmlBlock(element)];
    const output: Block[] = [];
    for (const row of rows) {
      const cells = Array.from(row.cells);
      if (cells.length >= 2 && cells.length <= 4) {
        const declared = cells.map((cell) => px(cell.getAttribute("width") || css(cell, "width")));
        const totalWidth = declared.reduce((sum, width) => sum + width, 0);
        const columnBlocks = cells.map((cell) => {
          const children = convertChildren(cell, report);
          if (!children.length) {
            const spacer = createBlock("spacer") as SpacerBlock;
            spacer.height = 16;
            children.push(spacer);
          }
          const index = cells.indexOf(cell);
          const width = totalWidth > 0 ? Math.round((declared[index] / totalWidth) * 100) : Math.round(100 / cells.length);
          return makeColumn(width || Math.round(100 / cells.length), children);
        });
        const columns = createBlock("columns") as ColumnsBlock;
        columns.columns = columnBlocks;
        columns.gap = px(table.getAttribute("cellspacing"));
        columns.padding = paddingOf(table);
        output.push(columns);
        report.columns++;
      } else {
        for (const cell of cells) output.push(...applyContainer(convertChildren(cell, report), cell));
      }
    }
    return applyContainer(output, table);
  }
  if (CONTAINERS.has(tag)) {
    const blockChildren = Array.from(element.children).some((child) => ["TABLE", "H1", "H2", "H3", "P", "IMG", "HR", "DIV", "SECTION", "FOOTER"].includes(child.tagName));
    if (!blockChildren && element.textContent?.trim()) return [textBlock(element)];
    return applyContainer(convertChildren(element, report), element);
  }
  if (element.textContent?.trim() || element.querySelector("img")) return [htmlBlock(element)];
  return [];
}

function convertChildren(parent: Element, report: ImportReport): Block[] {
  const blocks: Block[] = [];
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent?.trim();
      if (value) {
        const p = document.createElement("p");
        p.textContent = value;
        blocks.push(textBlock(p));
      }
    } else if (node instanceof HTMLElement) {
      blocks.push(...convertElement(node, report));
    }
  }
  return blocks;
}

export function adaptHtmlTemplate(html: string): AdaptedTemplate {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const report: ImportReport = { nativeBlocks: 0, htmlBlocks: 0, columns: 0, warnings: [] };
  const doc = emptyDoc();
  doc.mode = "visual";
  doc.code = html; // respaldo del original dentro del proyecto
  doc.settings.title = parsed.title.trim() || "Plantilla importada";
  doc.settings.customCss = extractTemplateCss(html);
  doc.settings.bodyBg = background(parsed.body) || doc.settings.bodyBg;
  const mainTable = Array.from(parsed.body.querySelectorAll("table")).find((table) => {
    const width = px(table.getAttribute("width") || css(table, "width") || css(table, "max-width"));
    return width >= 400 && width <= 900;
  });
  if (mainTable) doc.settings.width = px(mainTable.getAttribute("width") || css(mainTable, "width") || css(mainTable, "max-width"), doc.settings.width);

  doc.blocks = convertChildren(parsed.body, report);
  if (!doc.blocks.length) {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = parsed.body.innerHTML;
    doc.blocks = [htmlBlock(wrapper)];
    report.warnings.push("No se reconocieron secciones editables; el cuerpo se conservó como HTML.");
  }
  const count = (blocks: Block[]): { html: number; native: number } => blocks.reduce((total, block) => {
    if (block.type === "html") total.html++;
    else total.native++;
    if (block.type === "columns") {
      for (const column of block.columns) {
        const nested = count(column.blocks);
        total.html += nested.html;
        total.native += nested.native;
      }
    }
    return total;
  }, { html: 0, native: 0 });
  const totals = count(doc.blocks);
  report.htmlBlocks = totals.html;
  report.nativeBlocks = totals.native;
  if (report.htmlBlocks) report.warnings.push(`${report.htmlBlocks} sección(es) compleja(s) se conservaron como HTML para mantener la fidelidad.`);
  if (doc.settings.customCss) report.warnings.push("El CSS global se conservó; revise clases complejas y media queries en la vista previa.");
  if (parsed.querySelector("script,iframe,object,embed,form,video")) report.warnings.push("Se eliminaron elementos interactivos no compatibles o inseguros del editor visual.");
  return { doc, report };
}
