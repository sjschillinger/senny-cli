package tool

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestReadFileCacheStoresEmptyFiles(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "empty.txt")
	if err := os.WriteFile(path, nil, 0600); err != nil {
		t.Fatal(err)
	}

	cache := NewFileCache()
	reader := NewReadFileToolWithCache(cache)
	args, _ := json.Marshal(map[string]string{"path": path})
	if _, err := reader.Execute(context.Background(), args); err != nil {
		t.Fatal(err)
	}

	if _, ok := cache.Get(path); !ok {
		t.Fatal("expected empty file content to be cached")
	}
}
