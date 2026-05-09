package session

import (
	"os"
	"path/filepath"
	"senny/internal/client"
	"strings"
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

func TestInspectHistoryCountsMessagesToolsAndCompaction(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "history.json")
	history := []client.ChatMessage{
		{ID: "u1", Role: "user", Content: "hello"},
		{
			ID:      "a1",
			Role:    "assistant",
			Content: "using a tool",
			ToolCalls: []client.ToolCall{{
				ID:   "call-1",
				Type: "function",
				Function: client.FunctionCall{
					Name:      "read_file",
					Arguments: `{"path":"README.md"}`,
				},
			}},
		},
		{ID: "t1", Role: "tool", ToolCallID: "call-1", Content: "ok"},
	}
	if err := SaveHistory(path, history); err != nil {
		t.Fatal(err)
	}
	if err := WriteCompactBoundary(path, []string{"u1", "a1"}, client.ChatMessage{ID: "s1", Role: "system", Content: "summary"}); err != nil {
		t.Fatal(err)
	}
	audit, err := InspectHistory(path)
	if err != nil {
		t.Fatal(err)
	}
	if audit.Messages != 4 || audit.UserMessages != 1 || audit.AssistantMessages != 1 || audit.ToolResultMessages != 1 {
		t.Fatalf("unexpected message counts: %+v", audit)
	}
	if audit.ToolCalls != 1 || len(audit.ToolNames) != 1 || audit.ToolNames[0] != "read_file" {
		t.Fatalf("unexpected tool audit: %+v", audit)
	}
	if audit.CompactionBoundaries != 1 || len(audit.Compactions) != 1 || audit.Compactions[0].ReplacedCount != 2 {
		t.Fatalf("unexpected compaction audit: %+v", audit)
	}
}

func TestInspectHistoryHandlesLargeJSONLLines(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "history.json")
	largeContent := strings.Repeat("x", 128*1024)
	if err := SaveHistory(path, []client.ChatMessage{{ID: "t1", Role: "tool", Content: largeContent}}); err != nil {
		t.Fatal(err)
	}
	audit, err := InspectHistory(path)
	if err != nil {
		t.Fatal(err)
	}
	if audit.Messages != 1 || audit.ToolResultMessages != 1 {
		t.Fatalf("unexpected audit for large line: %+v", audit)
	}
}
