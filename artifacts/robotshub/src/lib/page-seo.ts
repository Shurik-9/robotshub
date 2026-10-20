import config from '@/data/seo-pages.json';
import solutionsData from '@/data/solutions.json';
import { CASES } from '@/pages/cases';

type PageMetadata = {
  path: string;
  title: string;
  description: string;
  indexable: boolean;
  type?: 'website' | 'article';
};

function shorten(value: string, limit: number) {
  if (value.length <= limit) return value;
  const prefix = value.slice(0, limit - 1);
  const boundary = prefix.lastIndexOf(' ');
  return `${boundary > limit / 2 ? prefix.slice(0, boundary) : prefix}…`;
}

export function pageMetadata(pathname: string): PageMetadata {
  const path = pathname.split('?')[0].replace(/\/+$/, '') || '/';
  const fixed = config.pages.find(page => page.path === path);
  if (fixed) return { ...fixed, type: fixed.type === 'article' ? 'article' : 'website' };
  const caseId = /^\/cases\/([^/]+)$/.exec(path)?.[1];
  const caseStudy = caseId ? CASES.find(item => item.id === caseId) : null;
  if (caseStudy) return {
    path,
    title: `${shorten(caseStudy.title, 46)} | Железный аргумент`,
    description: shorten(caseStudy.lead, 160),
    indexable: true,
    type: 'article',
  };
  const solutionId = /^\/solutions\/([^/]+)$/.exec(path)?.[1];
  const solution = solutionId ? solutionsData.items.find(item => item.id === solutionId) : null;
  if (solution) return {
    path,
    title: `${shorten(solution.name, 46)} | Железный аргумент`,
    description: shorten(solution.desc_real || solution.hero || `Характеристики, источники данных и запрос предложения по модели ${solution.name}.`, 160),
    indexable: true,
  };
  return {
    path,
    title: 'Страница не найдена — 404 | Железный аргумент',
    description: 'Страница не найдена. Перейдите к карте роботизации, каталогу решений или кейсам внедрения на сайте «Железный аргумент».',
    indexable: false,
  };
}

export function applyPageMetadata(pathname: string) {
  const metadata = pageMetadata(pathname);
  const canonical = new URL(metadata.path, config.siteUrl).href;
  const image = new URL(config.image, config.siteUrl).href;
  document.title = metadata.title;
  const setMeta = (attribute: 'name' | 'property', key: string, value: string) => {
    let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
    if (!element) {
      element = document.createElement('meta');
      element.setAttribute(attribute, key);
      document.head.appendChild(element);
    }
    element.content = value;
  };
  setMeta('name', 'description', metadata.description);
  setMeta('name', 'robots', metadata.indexable ? 'index, follow' : 'noindex, follow');
  setMeta('property', 'og:title', metadata.title);
  setMeta('property', 'og:description', metadata.description);
  setMeta('property', 'og:url', canonical);
  setMeta('property', 'og:type', metadata.type ?? 'website');
  setMeta('property', 'og:image', image);
  setMeta('name', 'twitter:card', 'summary_large_image');
  setMeta('name', 'twitter:title', metadata.title);
  setMeta('name', 'twitter:description', metadata.description);
  setMeta('name', 'twitter:image', image);
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.appendChild(link);
  }
  link.href = canonical;
}
