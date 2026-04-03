'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Play, Square, Download, Settings, List, Network, Search, AlertCircle, CheckCircle2, Loader2, FileJson, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx } from 'clsx';

interface CrawlResult {
  url: string;
  title: string;
  depth: number;
  parent?: string;
  status: 'pending' | 'success' | 'error';
  error?: string;
}

interface QueueItem {
  url: string;
  depth: number;
  parent?: string;
}

export default function Crawler() {
  const [baseUrl, setBaseUrl] = useState('');
  const [isCrawling, setIsCrawling] = useState(false);
  const [results, setResults] = useState<Map<string, CrawlResult>>(new Map());
  const [queueLength, setQueueLength] = useState(0);
  const [visitedCount, setVisitedCount] = useState(0);
  const [viewMode, setViewMode] = useState<'list' | 'tree'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Settings
  const [maxDepth, setMaxDepth] = useState(3);
  const [maxPages, setMaxPages] = useState(100);
  const [delayMs, setDelayMs] = useState(0);
  const [concurrency, setConcurrency] = useState(10);
  const [showSettings, setShowSettings] = useState(false);

  // Refs for crawler state
  const isCrawlingRef = useRef(false);
  const queueRef = useRef<QueueItem[]>([]);
  const visitedRef = useRef<Set<string>>(new Set());
  const resultsRef = useRef<Map<string, CrawlResult>>(new Map());
  const activeWorkersRef = useRef(0);

  const normalizeUrl = (urlStr: string) => {
    try {
      const url = new URL(urlStr);
      url.hash = '';
      url.search = '';
      let clean = url.toString();
      if (clean.endsWith('/') && clean.length > url.origin.length + 1) {
        clean = clean.slice(0, -1);
      }
      return clean;
    } catch {
      return urlStr;
    }
  };

  const startCrawl = async () => {
    if (!baseUrl) return;
    
    let normalizedBaseUrl = '';
    try {
      normalizedBaseUrl = normalizeUrl(baseUrl);
      // Ensure it has http/https
      new URL(normalizedBaseUrl);
    } catch {
      alert('Please enter a valid URL including http:// or https://');
      return;
    }

    setIsCrawling(true);
    isCrawlingRef.current = true;
    
    // Reset state
    queueRef.current = [{ url: normalizedBaseUrl, depth: 0 }];
    visitedRef.current = new Set();
    resultsRef.current = new Map();
    activeWorkersRef.current = 0;
    
    setResults(new Map());
    setQueueLength(1);
    setVisitedCount(0);

    dispatchNext(normalizedBaseUrl);
  };

  const stopCrawl = () => {
    setIsCrawling(false);
    isCrawlingRef.current = false;
  };

  const dispatchNext = (rootBaseUrl: string) => {
    if (!isCrawlingRef.current) return;

    if (visitedRef.current.size >= maxPages) {
      stopCrawl();
      return;
    }

    if (queueRef.current.length === 0 && activeWorkersRef.current === 0) {
      stopCrawl();
      return;
    }

    while (
      isCrawlingRef.current &&
      activeWorkersRef.current < concurrency &&
      queueRef.current.length > 0 &&
      visitedRef.current.size + activeWorkersRef.current < maxPages
    ) {
      const current = queueRef.current.shift()!;
      setQueueLength(queueRef.current.length);

      const normalizedUrl = normalizeUrl(current.url);

      if (visitedRef.current.has(normalizedUrl)) {
        continue;
      }

      visitedRef.current.add(normalizedUrl);
      setVisitedCount(visitedRef.current.size);
      activeWorkersRef.current++;

      processPage(current, normalizedUrl, rootBaseUrl);
    }
  };

  const processPage = async (current: QueueItem, normalizedUrl: string, rootBaseUrl: string) => {
    const newResult: CrawlResult = {
      url: normalizedUrl,
      title: 'Fetching...',
      depth: current.depth,
      parent: current.parent,
      status: 'pending'
    };
    
    resultsRef.current.set(normalizedUrl, newResult);
    setResults(new Map(resultsRef.current));

    try {
      const response = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalizedUrl, baseUrl: rootBaseUrl }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      resultsRef.current.set(normalizedUrl, {
        ...newResult,
        title: data.title || normalizedUrl,
        status: 'success'
      });
      setResults(new Map(resultsRef.current));

      if (current.depth < maxDepth && data.links) {
        for (const link of data.links) {
          const normLink = normalizeUrl(link);
          if (!visitedRef.current.has(normLink) && !queueRef.current.some(q => normalizeUrl(q.url) === normLink)) {
            queueRef.current.push({
              url: normLink,
              depth: current.depth + 1,
              parent: normalizedUrl
            });
          }
        }
        setQueueLength(queueRef.current.length);
      }

    } catch (error: any) {
      resultsRef.current.set(normalizedUrl, {
        ...newResult,
        title: 'Error fetching page',
        status: 'error',
        error: error.message
      });
      setResults(new Map(resultsRef.current));
    } finally {
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      activeWorkersRef.current--;
      dispatchNext(rootBaseUrl);
    }
  };

  const exportJson = () => {
    const data = Array.from(results.values()).map(r => ({
      url: r.url,
      title: r.title,
      depth: r.depth,
      parent: r.parent,
      status: r.status
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'crawl-results.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportMarkdown = () => {
    let md = '# Crawl Results\n\n';
    
    // Simple flat list for markdown
    const sorted = Array.from(results.values()).sort((a, b) => a.url.localeCompare(b.url));
    for (const r of sorted) {
      if (r.status === 'success') {
        md += `- [${r.title}](${r.url})\n`;
      }
    }
    
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'crawl-results.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredResults = Array.from(results.values()).filter(r => 
    r.url.toLowerCase().includes(searchQuery.toLowerCase()) || 
    r.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Build tree
  const buildTree = () => {
    const rootNodes: any[] = [];
    const nodeMap = new Map<string, any>();

    // First pass: create nodes
    filteredResults.forEach(r => {
      nodeMap.set(r.url, { ...r, children: [] });
    });

    // Second pass: attach to parents
    nodeMap.forEach(node => {
      if (node.parent && nodeMap.has(node.parent)) {
        nodeMap.get(node.parent).children.push(node);
      } else {
        rootNodes.push(node);
      }
    });

    return rootNodes;
  };

  const treeData = viewMode === 'tree' ? buildTree() : [];

  const TreeNode = ({ node, level = 0 }: { node: any, level?: number }) => {
    const [expanded, setExpanded] = useState(true);
    
    return (
      <div className="flex flex-col">
        <div 
          className="flex items-center py-1.5 hover:bg-gray-50 rounded px-2 group"
          style={{ paddingLeft: `${level * 1.5 + 0.5}rem` }}
        >
          {node.children.length > 0 ? (
            <button 
              onClick={() => setExpanded(!expanded)}
              className="w-5 h-5 flex items-center justify-center mr-1 text-gray-400 hover:text-gray-700"
            >
              {expanded ? '▾' : '▸'}
            </button>
          ) : (
            <span className="w-5 h-5 mr-1 inline-block" />
          )}
          
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {node.status === 'pending' && <Loader2 className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0" />}
            {node.status === 'success' && <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />}
            {node.status === 'error' && <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />}
            
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium text-gray-900 truncate">{node.title}</span>
              <a href={node.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline truncate">
                {node.url}
              </a>
            </div>
          </div>
        </div>
        
        {expanded && node.children.length > 0 && (
          <div className="flex flex-col">
            {node.children.map((child: any) => (
              <TreeNode key={child.url} node={child} level={level + 1} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-gray-50/50">
      {/* Header & Controls */}
      <div className="bg-white border-b border-gray-200 p-4 md:p-6 shadow-sm z-10">
        <div className="max-w-6xl mx-auto space-y-4">
          <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Docs Crawler</h1>
              <p className="text-sm text-gray-500 mt-1">Discover and map documentation sites automatically.</p>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="p-2 text-gray-500 hover:bg-gray-100 rounded-md transition-colors"
                title="Settings"
              >
                <Settings className="w-5 h-5" />
              </button>
              
              <div className="flex bg-gray-100 p-1 rounded-md">
                <button
                  onClick={() => setViewMode('list')}
                  className={clsx(
                    "p-1.5 rounded text-sm font-medium transition-colors flex items-center gap-1.5",
                    viewMode === 'list' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  <List className="w-4 h-4" /> List
                </button>
                <button
                  onClick={() => setViewMode('tree')}
                  className={clsx(
                    "p-1.5 rounded text-sm font-medium transition-colors flex items-center gap-1.5",
                    viewMode === 'tree' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  <Network className="w-4 h-4" /> Tree
                </button>
              </div>

              <div className="h-6 w-px bg-gray-200 mx-1" />

              <button
                onClick={exportJson}
                disabled={results.size === 0}
                className="p-2 text-gray-500 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Export JSON"
              >
                <FileJson className="w-5 h-5" />
              </button>
              <button
                onClick={exportMarkdown}
                disabled={results.size === 0}
                className="p-2 text-gray-500 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Export Markdown"
              >
                <FileText className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://docs.example.com"
                disabled={isCrawling}
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all disabled:bg-gray-50 disabled:text-gray-500 font-mono text-sm"
                onKeyDown={(e) => e.key === 'Enter' && !isCrawling && startCrawl()}
              />
            </div>
            
            {isCrawling ? (
              <button
                onClick={stopCrawl}
                className="flex items-center gap-2 px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors shadow-sm"
              >
                <Square className="w-4 h-4 fill-current" /> Stop
              </button>
            ) : (
              <button
                onClick={startCrawl}
                disabled={!baseUrl}
                className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium rounded-lg transition-colors shadow-sm"
              >
                <Play className="w-4 h-4 fill-current" /> Start
              </button>
            )}
          </div>

          <AnimatePresence>
            {showSettings && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-4 border-t border-gray-100">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Max Depth</label>
                    <input 
                      type="number" 
                      value={maxDepth} 
                      onChange={(e) => setMaxDepth(Number(e.target.value))}
                      disabled={isCrawling}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50"
                      min="1" max="10"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Max Pages</label>
                    <input 
                      type="number" 
                      value={maxPages} 
                      onChange={(e) => setMaxPages(Number(e.target.value))}
                      disabled={isCrawling}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50"
                      min="1" max="10000"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Concurrency</label>
                    <input 
                      type="number" 
                      value={concurrency} 
                      onChange={(e) => setConcurrency(Number(e.target.value))}
                      disabled={isCrawling}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50"
                      min="1" max="50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Delay (ms)</label>
                    <input 
                      type="number" 
                      value={delayMs} 
                      onChange={(e) => setDelayMs(Number(e.target.value))}
                      disabled={isCrawling}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50"
                      min="0" max="5000" step="100"
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Stats Bar */}
          {(results.size > 0 || isCrawling) && (
            <div className="flex items-center gap-6 text-sm text-gray-600 pt-2 border-t border-gray-100">
              <div className="flex items-center gap-2">
                <div className={clsx("w-2 h-2 rounded-full", isCrawling ? "bg-blue-500 animate-pulse" : "bg-gray-300")} />
                {isCrawling ? 'Crawling...' : 'Idle'}
              </div>
              <div>Visited: <span className="font-semibold text-gray-900">{visitedCount}</span></div>
              <div>In Queue: <span className="font-semibold text-gray-900">{queueLength}</span></div>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="max-w-6xl mx-auto">
          {results.size === 0 && !isCrawling ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <Network className="w-12 h-12 mb-4 opacity-20" />
              <p>Enter a documentation URL to start crawling.</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col min-h-[500px]">
              {/* Filter Bar */}
              <div className="p-3 border-b border-gray-100 bg-gray-50/50">
                <input
                  type="text"
                  placeholder="Filter results..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full max-w-md px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>

              {/* Results Area */}
              <div className="p-4 overflow-auto flex-1">
                {viewMode === 'list' ? (
                  <div className="space-y-1">
                    {filteredResults.map((result) => (
                      <div key={result.url} className="flex items-center gap-3 py-2 px-3 hover:bg-gray-50 rounded-lg group transition-colors">
                        {result.status === 'pending' && <Loader2 className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0" />}
                        {result.status === 'success' && <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />}
                        {result.status === 'error' && <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />}
                        
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="text-sm font-medium text-gray-900 truncate">{result.title}</span>
                          <a href={result.url} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:text-blue-600 hover:underline truncate">
                            {result.url}
                          </a>
                        </div>
                        
                        <div className="text-xs text-gray-400 font-mono bg-gray-100 px-2 py-1 rounded">
                          L{result.depth}
                        </div>
                      </div>
                    ))}
                    {filteredResults.length === 0 && (
                      <div className="text-center text-gray-500 py-8">No results found matching your filter.</div>
                    )}
                  </div>
                ) : (
                  <div className="font-mono text-sm">
                    {treeData.map((node) => (
                      <TreeNode key={node.url} node={node} />
                    ))}
                    {treeData.length === 0 && (
                      <div className="text-center text-gray-500 py-8">No results found matching your filter.</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
