/** Versioned same-origin fragments; update content/navigation, preserving the shell. */
export interface PageFragment {
  version: 1;
  assetVersion: string;
  title: string;
  pageTitle: string;
  keywords: string;
  href: string;
  home: boolean;
  content: string;
  submenu: string;
  menu?: string;
  back: string;
  styles: string[];
}
export const fragmentType = 'application/vnd.karui.page+json';
