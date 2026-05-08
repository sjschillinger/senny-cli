package memory

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// MemoryLink is a reference found in a memory file, e.g. [.senny/memory/arch.md]
type MemoryLink struct {
	Path string
}

var linkRe = regexp.MustCompile(`\[([^\]]+\.md)\]`)

// ParseMemoryLinks scans content for [path.md] syntax and returns all matches.
func ParseMemoryLinks(content string) []MemoryLink {
	matches := linkRe.FindAllStringSubmatch(content, -1)
	links := make([]MemoryLink, 0, len(matches))
	for _, m := range matches {
		links = append(links, MemoryLink{Path: m[1]})
	}
	return links
}

// LoadMemoryTree loads a root memory file, resolves any [path.md] links it contains,
// and returns the assembled text capped at maxBytes. Circular references are skipped.
func LoadMemoryTree(rootPath, cwd string, maxBytes int) string {
	visited := make(map[string]bool)
	var sb strings.Builder
	loadFile(rootPath, cwd, &sb, visited, maxBytes)
	result := sb.String()
	if len(result) > maxBytes {
		return result[:maxBytes] + "\n... (truncated)"
	}
	return result
}

func loadFile(path, cwd string, sb *strings.Builder, visited map[string]bool, maxBytes int) {
	abs := resolve(path, cwd)
	if visited[abs] {
		return
	}
	visited[abs] = true

	data, err := os.ReadFile(abs)
	if err != nil {
		return
	}
	content := string(data)
	if sb.Len()+len(content) > maxBytes {
		remaining := maxBytes - sb.Len()
		if remaining <= 0 {
			return
		}
		content = content[:remaining]
	}
	sb.WriteString(content)

	// Recursively load linked files
	for _, link := range ParseMemoryLinks(content) {
		linkPath := link.Path
		if !filepath.IsAbs(linkPath) {
			linkPath = filepath.Join(filepath.Dir(abs), linkPath)
		}
		if sb.Len() >= maxBytes {
			break
		}
		loadFile(linkPath, cwd, sb, visited, maxBytes)
	}
}

func resolve(path, cwd string) string {
	if filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(cwd, path)
}
