const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx', 'markdown', 'mdown', 'mkd']);
const SVG_EXTENSION = 'svg';

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) {
    return '';
  }
  return filePath.slice(dot + 1).toLowerCase();
}

export function isMarkdownFile(filePath: string): boolean {
  return MARKDOWN_EXTENSIONS.has(getExtension(filePath));
}

export function isSvgFile(filePath: string): boolean {
  return getExtension(filePath) === SVG_EXTENSION;
}

export function isRenderableFile(filePath: string): boolean {
  return isMarkdownFile(filePath) || isSvgFile(filePath);
}
