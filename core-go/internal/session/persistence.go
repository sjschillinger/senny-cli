package session

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"senny/internal/client"
)

type compactBoundary struct {
	Type        string   `json:"__type"`
	SummaryID   string   `json:"summary_id"`
	ReplacedIDs []string `json:"replaced_ids"`
}

// AppendMessages appends only the messages not yet in the file (by count, via savedCount cursor).
// On first call to an existing old-format (JSON array) file, it migrates the file to JSONL.
func AppendMessages(path string, history []client.ChatMessage, savedCount int) error {
	if path == "" {
		return nil
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	// Detect old JSON-array format and migrate on first use.
	if exists(path) && isJSONArray(path) {
		if err := migrateToJSONL(path, history); err != nil {
			return err
		}
		return nil
	}

	// Append only new messages (those beyond the savedCount cursor).
	newMessages := history[savedCount:]
	if len(newMessages) == 0 {
		return nil
	}

	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0600)
	if err != nil {
		return fmt.Errorf("failed to open history file for append: %w", err)
	}
	defer f.Close()

	for _, msg := range newMessages {
		line, err := json.Marshal(msg)
		if err != nil {
			return fmt.Errorf("failed to marshal message: %w", err)
		}
		if _, err := f.WriteString(string(line) + "\n"); err != nil {
			return fmt.Errorf("failed to append message: %w", err)
		}
	}
	return nil
}

// WriteCompactBoundary appends a boundary marker and then the summary message to the log.
func WriteCompactBoundary(path string, replacedIDs []string, summary client.ChatMessage) error {
	if path == "" {
		return nil
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0600)
	if err != nil {
		return fmt.Errorf("failed to open history file for compact boundary: %w", err)
	}
	defer f.Close()

	boundary := compactBoundary{Type: "compact_boundary", SummaryID: summary.ID, ReplacedIDs: replacedIDs}
	bline, err := json.Marshal(boundary)
	if err != nil {
		return err
	}
	if _, err := f.WriteString(string(bline) + "\n"); err != nil {
		return err
	}
	sline, err := json.Marshal(summary)
	if err != nil {
		return err
	}
	_, err = f.WriteString(string(sline) + "\n")
	return err
}

// LoadHistory loads history from a JSONL file, applying compact boundaries.
// Falls back to JSON array parser for legacy files.
func LoadHistory(path string) ([]client.ChatMessage, error) {
	if !exists(path) {
		return []client.ChatMessage{}, nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read history file: %w", err)
	}
	if len(data) == 0 {
		return []client.ChatMessage{}, nil
	}

	// Legacy: JSON array format
	if strings.TrimSpace(string(data[:min(len(data), 10)]))[0] == '[' {
		var history []client.ChatMessage
		if err := json.Unmarshal(data, &history); err != nil {
			return nil, fmt.Errorf("failed to unmarshal history: %w", err)
		}
		return history, nil
	}

	// JSONL format
	return parseJSONL(data)
}

// SaveHistory is kept for callers that still use the old interface (e.g. tests).
// It writes the full history as JSONL.
func SaveHistory(path string, history []client.ChatMessage) error {
	if path == "" {
		return nil
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return fmt.Errorf("failed to open history file: %w", err)
	}
	defer f.Close()
	for _, msg := range history {
		line, err := json.Marshal(msg)
		if err != nil {
			return err
		}
		if _, err := f.WriteString(string(line) + "\n"); err != nil {
			return err
		}
	}
	return nil
}

func parseJSONL(data []byte) ([]client.ChatMessage, error) {
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	var messages []client.ChatMessage
	// Track messages by ID so we can apply compact boundaries.
	byID := make(map[string]int) // id → index in messages slice (-1 if removed)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		// Probe __type field first.
		var probe struct {
			Type string `json:"__type"`
		}
		if err := json.Unmarshal([]byte(line), &probe); err != nil {
			// Skip unparseable lines (partial write recovery).
			continue
		}

		if probe.Type == "compact_boundary" {
			var b compactBoundary
			if err := json.Unmarshal([]byte(line), &b); err != nil {
				continue
			}
			// Mark replaced IDs for removal (we'll filter at the end).
			for _, id := range b.ReplacedIDs {
				byID[id] = -1
			}
			continue
		}

		var msg client.ChatMessage
		if err := json.Unmarshal([]byte(line), &msg); err != nil {
			continue
		}
		if msg.ID != "" {
			if byID[msg.ID] == -1 {
				// This message was replaced by a compact boundary — skip it.
				continue
			}
			byID[msg.ID] = len(messages)
		}
		messages = append(messages, msg)
	}

	return messages, nil
}

func isJSONArray(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	buf := make([]byte, 16)
	n, _ := f.Read(buf)
	return strings.TrimSpace(string(buf[:n]))[0:1] == "["
}

func migrateToJSONL(path string, history []client.ChatMessage) error {
	return SaveHistory(path, history)
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
