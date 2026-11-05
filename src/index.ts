#!/usr/bin/env bun
/**
 * MCP server for the Trilium Notes ETAPI (stdio).
 * Env: TRILIUM_URL (default http://localhost:8080), TRILIUM_ETAPI_TOKEN (required).
 */
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { registerTools } from "./tools.js";

function createServer(): McpServer {
  const server = new McpServer({ name: "trilium-mcp-server", version: "1.0.0" });
  registerTools(server);
  return server;
}

serveStdio(createServer);
console.error("trilium-mcp-server running on stdio"); // stderr: stdout carries the protocol
