package session

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadHistoryEmptyAndWhitespaceFiles(t *testing.T) {
	dir := t.TempDir()
	for name, content := range map[string]string{
		"empty.json":      "",
		"whitespace.json": " \n\t ",
	} {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
		history, err := LoadHistory(path)
		if err != nil {
			t.Fatalf("LoadHistory(%s) error = %v", name, err)
		}
		if len(history) != 0 {
			t.Fatalf("LoadHistory(%s) len = %d, want 0", name, len(history))
		}
	}
}
