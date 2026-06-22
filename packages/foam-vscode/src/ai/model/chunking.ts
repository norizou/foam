import { Logger } from '@foam/core';

/**
 * Chunking strategy interface
 */
export interface ChunkingStrategy {
  chunk(text: string, options: ChunkingOptions): Chunk[];
}

/**
 * Chunking options
 */
export interface ChunkingOptions {
  /** Maximum chunk size in characters */
  maxSize: number;
  /** Whether to enable chunking */
  enabled: boolean;
  /** Strategy to use */
  strategy: 'markdown' | 'fixed';
}

/**
 * Default chunking options
 */
export const DEFAULT_CHUNKING_OPTIONS: ChunkingOptions = {
  maxSize: 16000,
  enabled: false,
  strategy: 'markdown',
};

/**
 * Represents a chunk of text
 */
export interface Chunk {
  /** Unique chunk identifier */
  id: string;
  /** Chunk text */
  text: string;
  /** Start position in original text */
  start: number;
  /** End position in original text */
  end: number;
  /** Heading path for context (e.g., "Title > Section > Subsection") */
  headingPath: string[];
}

/**
 * Markdown-based chunking strategy
 * Splits text by headings (H1-H6) and paragraphs
 */
export class MarkdownChunkingStrategy implements ChunkingStrategy {
  chunk(text: string, options: ChunkingOptions): Chunk[] {
    if (!options.enabled) {
      return [{
        id: '0',
        text: text,
        start: 0,
        end: text.length,
        headingPath: [],
      }];
    }

    const chunks: Chunk[] = [];
    const headingPattern = /^(#{1,6})\s+(.+)$/gm;
    const paragraphPattern = /\n\n+/g;
    
    let currentHeadingPath: string[] = [];
    let currentChunkStart = 0;
    let currentChunkText = '';
    let currentHeadingLevel = 0;
    
    const lines = text.split('\n');
    let position = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineStart = position;
      const lineEnd = position + line.length;
      
      // Check for heading
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const heading = headingMatch[2].trim();
        
        // Update heading path
        currentHeadingPath = currentHeadingPath.slice(0, level - 1);
        currentHeadingPath.push(heading);
        currentHeadingLevel = level;
        
        // If current chunk is non-empty and adding this heading would exceed max size,
        // save current chunk and start new one
        if (currentChunkText.length > 0 && 
            currentChunkText.length + line.length > options.maxSize) {
          chunks.push({
            id: chunks.length.toString(),
            text: currentChunkText.trim(),
            start: currentChunkStart,
            end: lineStart,
            headingPath: [...currentHeadingPath.slice(0, -1)], // Exclude current heading
          });
          currentChunkText = '';
          currentChunkStart = lineStart;
        }
        
        currentChunkText += line + '\n';
      } else {
        // Regular content
        const potentialText = currentChunkText + line + '\n';
        
        if (potentialText.length > options.maxSize && currentChunkText.length > 0) {
          // Save current chunk and start new one
          chunks.push({
            id: chunks.length.toString(),
            text: currentChunkText.trim(),
            start: currentChunkStart,
            end: lineStart,
            headingPath: [...currentHeadingPath],
          });
          currentChunkText = line + '\n';
          currentChunkStart = lineStart;
        } else {
          currentChunkText = potentialText;
        }
      }
      
      position = lineEnd + 1; // +1 for newline
    }
    
    // Add final chunk if non-empty
    if (currentChunkText.trim().length > 0) {
      chunks.push({
        id: chunks.length.toString(),
        text: currentChunkText.trim(),
        start: currentChunkStart,
        end: text.length,
        headingPath: [...currentHeadingPath],
      });
    }
    
    // If no chunks were created (shouldn't happen), return single chunk
    if (chunks.length === 0) {
      return [{
        id: '0',
        text: text,
        start: 0,
        end: text.length,
        headingPath: [],
      }];
    }
    
    Logger.debug(`Chunked text into ${chunks.length} chunks`);
    return chunks;
  }
}

/**
 * Fixed-size chunking strategy (fallback)
 */
export class FixedSizeChunkingStrategy implements ChunkingStrategy {
  chunk(text: string, options: ChunkingOptions): Chunk[] {
    if (!options.enabled || text.length <= options.maxSize) {
      return [{
        id: '0',
        text: text,
        start: 0,
        end: text.length,
        headingPath: [],
      }];
    }

    const chunks: Chunk[] = [];
    const overlap = Math.floor(options.maxSize * 0.1); // 10% overlap
    
    for (let i = 0; i < text.length; i += options.maxSize - overlap) {
      const end = Math.min(i + options.maxSize, text.length);
      chunks.push({
        id: chunks.length.toString(),
        text: text.substring(i, end),
        start: i,
        end: end,
        headingPath: [],
      });
    }
    
    Logger.debug(`Chunked text into ${chunks.length} chunks using fixed-size strategy`);
    return chunks;
  }
}

/**
 * Get chunking strategy based on options
 */
export function getChunkingStrategy(options: ChunkingOptions): ChunkingStrategy {
  switch (options.strategy) {
    case 'markdown':
      return new MarkdownChunkingStrategy();
    case 'fixed':
      return new FixedSizeChunkingStrategy();
    default:
      Logger.warn(`Unknown chunking strategy: ${options.strategy}, falling back to markdown`);
      return new MarkdownChunkingStrategy();
  }
}