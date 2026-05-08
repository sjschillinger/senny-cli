package common

import (
	"senny/internal/pathutil"
)

func LateConfigDir() (string, error) {
	return pathutil.LateConfigDir()
}

func LateSessionDir() (string, error) {
	return pathutil.LateSessionDir()
}

func SennyConfigDir() (string, error) {
	return pathutil.SennyConfigDir()
}

func SennySessionDir() (string, error) {
	return pathutil.SennySessionDir()
}

func SennyProjectMCPConfigPath() string {
	return pathutil.SennyProjectMCPConfigPath()
}

// LateProjectMCPConfigPath returns the relative Late-compatible project-local MCP config
// location (".late/mcp_config.json"), resolved relative to process CWD.
func LateProjectMCPConfigPath() string {
	return pathutil.LateProjectMCPConfigPath()
}

func LateUserMCPConfigPath() (string, error) {
	return pathutil.LateUserMCPConfigPath()
}
