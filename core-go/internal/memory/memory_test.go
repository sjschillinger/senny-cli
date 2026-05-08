package memory

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadMemoryTree_FollowsLinks(t *testing.T) {
	dir := t.TempDir()

	// Write a linked file
	arch := filepath.Join(dir, ".senny", "memory", "arch.md")
	if err := os.MkdirAll(filepath.Dir(arch), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(arch, []byte("Architecture notes here."), 0644); err != nil {
		t.Fatal(err)
	}

	// Write root memory file with a link
	root := filepath.Join(dir, "SENNY.md")
	if err := os.WriteFile(root, []byte("## Architecture [.senny/memory/arch.md]\nRoot content."), 0644); err != nil {
		t.Fatal(err)
	}

	result := LoadMemoryTree(root, dir, 10000)
	if result == "" {
		t.Fatal("expected non-empty result")
	}
	if !contains(result, "Root content.") {
		t.Errorf("missing root content in result: %s", result)
	}
	if !contains(result, "Architecture notes here.") {
		t.Errorf("missing linked file content in result: %s", result)
	}
}

func TestLoadMemoryTree_PreventsCycles(t *testing.T) {
	dir := t.TempDir()

	a := filepath.Join(dir, "a.md")
	b := filepath.Join(dir, "b.md")
	if err := os.WriteFile(a, []byte("File A [b.md]"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(b, []byte("File B [a.md]"), 0644); err != nil {
		t.Fatal(err)
	}

	result := LoadMemoryTree(a, dir, 10000)
	if result == "" {
		t.Fatal("expected non-empty result")
	}
	// Should not panic or infinite-loop, and should contain both files
	if !contains(result, "File A") {
		t.Errorf("missing File A content")
	}
	if !contains(result, "File B") {
		t.Errorf("missing File B content")
	}
}

func TestLoadMemoryTree_MissingLinkedFileSkipped(t *testing.T) {
	dir := t.TempDir()

	root := filepath.Join(dir, "SENNY.md")
	if err := os.WriteFile(root, []byte("Root content [missing.md]"), 0644); err != nil {
		t.Fatal(err)
	}

	result := LoadMemoryTree(root, dir, 10000)
	if !contains(result, "Root content") {
		t.Errorf("missing root content: %s", result)
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 ||
		func() bool {
			for i := 0; i <= len(s)-len(sub); i++ {
				if s[i:i+len(sub)] == sub {
					return true
				}
			}
			return false
		}())
}
