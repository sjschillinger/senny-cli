package tool

import "sync"

// FileCache is a session-scoped, write-invalidated in-memory cache for file reads.
// It maps absolute (or as-passed) paths to full file content strings.
// Reads check the cache first; successful writes invalidate the relevant entry.
type FileCache struct {
	mu    sync.RWMutex
	cache map[string]string
}

func NewFileCache() *FileCache {
	return &FileCache{cache: make(map[string]string)}
}

func (c *FileCache) Get(path string) (string, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	v, ok := c.cache[path]
	return v, ok
}

func (c *FileCache) Set(path, content string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.cache[path] = content
}

func (c *FileCache) Invalidate(path string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.cache, path)
}

func (c *FileCache) InvalidateAll() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.cache = make(map[string]string)
}
