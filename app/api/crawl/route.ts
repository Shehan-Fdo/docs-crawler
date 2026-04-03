import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

export async function POST(req: Request) {
  try {
    const { url, baseUrl } = await req.json();

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'DocsCrawler/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      },
      // Timeout and other fetch options could be added here
    });

    if (!response.ok) {
      return NextResponse.json({ error: `Failed to fetch: ${response.status} ${response.statusText}` }, { status: response.status });
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('text/html')) {
      return NextResponse.json({ error: 'Not an HTML page' }, { status: 400 });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const title = $('title').text().trim() || $('h1').first().text().trim() || url;
    
    const links = new Set<string>();
    
    const processLink = (_: number, element: any) => {
      const href = $(element).attr('href');
      if (!href) return;

      try {
        // Resolve URL against the fetched URL
        const resolvedUrl = new URL(href, url);
        
        // Only keep HTTP/HTTPS links
        if (resolvedUrl.protocol !== 'http:' && resolvedUrl.protocol !== 'https:') {
          return;
        }

        // Only keep links from the same origin as the baseUrl
        const base = new URL(baseUrl);
        if (resolvedUrl.origin !== base.origin) {
          return;
        }

        // Skip common non-HTML extensions
        const pathname = resolvedUrl.pathname.toLowerCase();
        const skipExtensions = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.css', '.js', '.zip', '.tar', '.gz', '.mp4', '.mp3', '.woff', '.woff2', '.ttf', '.eot', '.ico'];
        if (skipExtensions.some(ext => pathname.endsWith(ext))) {
          return;
        }

        // Skip common non-content pages
        const skipPaths = ['/login', '/signin', '/signup', '/auth', '/search', '/tags', '/categories', '/author', '/page/'];
        if (skipPaths.some(path => pathname.includes(path))) {
          return;
        }

        // Normalize URL: remove hash and search params
        resolvedUrl.hash = '';
        resolvedUrl.search = '';
        
        let cleanUrl = resolvedUrl.toString();
        // Remove trailing slash unless it's just the origin
        if (cleanUrl.endsWith('/') && cleanUrl.length > base.origin.length + 1) {
          cleanUrl = cleanUrl.slice(0, -1);
        }

        links.add(cleanUrl);
      } catch (e) {
        // Ignore invalid URLs
      }
    };

    // Prioritize links in nav, aside, sidebar, toc
    $('nav a, aside a, .sidebar a, .toc a, [role="navigation"] a').each(processLink);
    
    // Then process all other links
    $('a').each(processLink);

    return NextResponse.json({
      title,
      links: Array.from(links),
    });

  } catch (error: any) {
    console.error('Crawl error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
