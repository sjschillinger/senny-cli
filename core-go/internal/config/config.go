package config

import (
	"encoding/json"
	"fmt"
	"senny/internal/pathutil"
	"os"
	"path/filepath"
	"runtime"
)

const DefaultOpenAIBaseURL = "http://localhost:8080"

type EnvLookup func(string) (string, bool)

type OpenAISettings struct {
	BaseURL string
	APIKey  string
	Model   string
}

type SubagentSettings struct {
	BaseURL string
	APIKey  string
	Model   string
}

const (
	configDirPerm  os.FileMode = 0o700
	configFilePerm os.FileMode = 0o600
)

// Config represents the application configuration.
type Config struct {
	EnabledTools    map[string]bool `json:"enabled_tools"`
	OpenAIBaseURL   string          `json:"openai_base_url,omitempty"`
	OpenAIAPIKey    string          `json:"openai_api_key,omitempty"`
	OpenAIModel     string          `json:"openai_model,omitempty"`
	LateSubagentBaseURL string          `json:"late_subagent_base_url,omitempty"`
	LateSubagentAPIKey  string          `json:"late_subagent_api_key,omitempty"`
	LateSubagentModel   string          `json:"late_subagent_model,omitempty"`

	// Legacy subagent fields for backward compatibility
	SubagentBaseURL string `json:"subagent_base_url,omitempty"`
	SubagentAPIKey  string `json:"subagent_api_key,omitempty"`
	SubagentModel   string `json:"subagent_model,omitempty"`

	SkillsDir string `json:"skills_dir,omitempty"`
}

func defaultConfig() Config {
	return Config{
		EnabledTools: map[string]bool{
			"read_file":      true,
			"write_file":     true,
			"target_edit":    true,
			"spawn_subagent": true,
			"bash":           true,
		},
	}
}

func LoadConfig() (*Config, error) {
	sennyConfigDir, err := pathutil.SennyConfigDir()
	if err != nil {
		return nil, err
	}
	sennyConfigPath := filepath.Join(sennyConfigDir, "config.json")

	// Try senny config first, then fall back to late config.
	configDir, configPath, content, err := loadConfigFile(sennyConfigDir, sennyConfigPath)
	if err != nil {
		fallback := defaultConfig()
		return &fallback, err
	}
	if content == nil {
		// Neither senny nor late config exists — bootstrap senny config.
		fallback := defaultConfig()
		defaultData, _ := json.MarshalIndent(fallback, "", "  ")

		if mkErr := os.MkdirAll(sennyConfigDir, configDirPerm); mkErr != nil {
			return &fallback, fmt.Errorf("failed to create config directory: %w", mkErr)
		}
		if wErr := os.WriteFile(sennyConfigPath, defaultData, configFilePerm); wErr != nil {
			return &fallback, fmt.Errorf("failed to write default config: %w", wErr)
		}
		if permErr := ensureSecureConfigPermissions(sennyConfigDir, sennyConfigPath); permErr != nil {
			return &fallback, permErr
		}
		return &fallback, nil
	}

	permErr := ensureSecureConfigPermissions(configDir, configPath)

	var cfg Config
	if err := json.Unmarshal(content, &cfg); err != nil {
		fallback := defaultConfig()
		return &fallback, err
	}

	if cfg.EnabledTools == nil {
		cfg.EnabledTools = defaultConfig().EnabledTools
	}

	if permErr != nil {
		return &cfg, permErr
	}

	return &cfg, nil
}

// loadConfigFile tries sennyPath, then the late config as fallback.
// Returns (dir, path, content, err). content is nil if neither file exists.
func loadConfigFile(sennyDir, sennyPath string) (string, string, []byte, error) {
	data, err := os.ReadFile(sennyPath)
	if err == nil {
		return sennyDir, sennyPath, data, nil
	}
	if !os.IsNotExist(err) {
		return "", "", nil, err
	}

	lateConfigDir, err := pathutil.LateConfigDir()
	if err != nil {
		return "", "", nil, nil // treat as not found
	}
	latePath := filepath.Join(lateConfigDir, "config.json")
	data, err = os.ReadFile(latePath)
	if err == nil {
		return lateConfigDir, latePath, data, nil
	}
	if !os.IsNotExist(err) {
		return "", "", nil, err
	}
	return "", "", nil, nil // neither found
}

func ResolveOpenAISettings(cfg *Config) OpenAISettings {
	return ResolveOpenAISettingsWithEnv(cfg, os.LookupEnv)
}

func ResolveOpenAISettingsWithEnv(cfg *Config, lookup EnvLookup) OpenAISettings {
	resolved := OpenAISettings{BaseURL: DefaultOpenAIBaseURL}

	if cfg != nil {
		if cfg.OpenAIBaseURL != "" {
			resolved.BaseURL = cfg.OpenAIBaseURL
		}
		resolved.APIKey = cfg.OpenAIAPIKey
		resolved.Model = cfg.OpenAIModel
	}

	if value, ok := nonEmptyEnv(lookup, "OPENAI_BASE_URL"); ok {
		resolved.BaseURL = value
	}
	if value, ok := nonEmptyEnv(lookup, "OPENAI_API_KEY"); ok {
		resolved.APIKey = value
	}
	if value, ok := nonEmptyEnv(lookup, "OPENAI_MODEL"); ok {
		resolved.Model = value
	}

	return resolved
}

func ResolveSubagentSettings(cfg *Config, openAI OpenAISettings) SubagentSettings {
	return ResolveSubagentSettingsWithEnv(cfg, openAI, os.LookupEnv)
}

func ResolveSubagentSettingsWithEnv(cfg *Config, openAI OpenAISettings, lookup EnvLookup) SubagentSettings {
	resolved := SubagentSettings{
		BaseURL: openAI.BaseURL,
		APIKey:  openAI.APIKey,
		Model:   openAI.Model,
	}

	if cfg != nil {
		// Check legacy fields first
		if cfg.SubagentBaseURL != "" {
			resolved.BaseURL = cfg.SubagentBaseURL
		}
		if cfg.SubagentAPIKey != "" {
			resolved.APIKey = cfg.SubagentAPIKey
		}
		if cfg.SubagentModel != "" {
			resolved.Model = cfg.SubagentModel
		}

		// New fields override legacy fields
		if cfg.LateSubagentBaseURL != "" {
			resolved.BaseURL = cfg.LateSubagentBaseURL
		}
		if cfg.LateSubagentAPIKey != "" {
			resolved.APIKey = cfg.LateSubagentAPIKey
		}
		if cfg.LateSubagentModel != "" {
			resolved.Model = cfg.LateSubagentModel
		}
	}

	if value, ok := nonEmptyEnv(lookup, "LATE_SUBAGENT_BASE_URL"); ok {
		resolved.BaseURL = value
	}
	if value, ok := nonEmptyEnv(lookup, "LATE_SUBAGENT_API_KEY"); ok {
		resolved.APIKey = value
	}
	if value, ok := nonEmptyEnv(lookup, "LATE_SUBAGENT_MODEL"); ok {
		resolved.Model = value
	}

	return resolved
}

func nonEmptyEnv(lookup EnvLookup, key string) (string, bool) {
	if lookup == nil {
		return "", false
	}

	value, ok := lookup(key)
	if !ok || value == "" {
		return "", false
	}

	return value, true
}

func ensureSecureConfigPermissions(configDir, configPath string) error {
	if runtime.GOOS == "windows" {
		return nil
	}

	if err := tightenPermission(configDir, configDirPerm); err != nil {
		return fmt.Errorf("failed to set config directory permissions: %w", err)
	}

	if err := tightenPermission(configPath, configFilePerm); err != nil {
		return fmt.Errorf("failed to set config file permissions: %w", err)
	}

	return nil
}

func tightenPermission(path string, required os.FileMode) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}

	if info.Mode().Perm() == required {
		return nil
	}

	return os.Chmod(path, required)
}
