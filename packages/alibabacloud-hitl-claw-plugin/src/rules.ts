/**
 * Command Parsing and Alibaba Cloud CLI Detection Module
 * Uses shell-quote library for professional shell command parsing
 */

import { parse, ParseEntry } from 'shell-quote';

/**
 * Shell operators (pipes, logical operators, semicolons, etc.)
 */
const SHELL_OPERATORS = new Set(['|', '||', '&&', ';', '&']);

/**
 * Get operator string
 */
function getOperator(entry: ParseEntry): string | null {
  if (typeof entry === 'object' && entry !== null && 'op' in entry) {
    return (entry as { op: string }).op;
  }
  return null;
}

/**
 * Extract all aliyun CLI commands from composite command
 * 
 * Uses shell-quote to parse command, splits by pipe/logical operators,
 * extracts command segments starting with 'aliyun' and having at least 3 arguments.
 * 
 * Example:
 * Input: "ls && aliyun ims CreateUser --UserName test | grep success"
 * Output: ["aliyun ims CreateUser --UserName test"]
 */
export function extractAliyunCommands(command: string): string[] {
  if (!command) return [];

  try {
    const parsed = parse(command);
    const commands: string[] = [];
    let currentSegment: string[] = [];

    for (const entry of parsed) {
      const op = getOperator(entry);
      if (op && SHELL_OPERATORS.has(op)) {
        // Encountered operator, process current segment
        const cmd = processSegment(currentSegment);
        if (cmd) commands.push(cmd);
        currentSegment = [];
      } else if (typeof entry === 'string') {
        currentSegment.push(entry);
      }
      // Ignore redirects and other operators
    }

    // Process last segment
    const cmd = processSegment(currentSegment);
    if (cmd) commands.push(cmd);

    return commands;
  } catch {
    // Return empty array on parse failure
    return [];
  }
}

/**
 * Process command segment, check if it's a valid aliyun CLI command
 * Valid format: aliyun <ProductCode> <APIName> [Parameters...]
 */
function processSegment(segment: string[]): string | null {
  if (segment.length < 3) return null;
  if (segment[0] !== 'aliyun') return null;
  
  // Reassemble command, properly handle arguments with spaces
  return segment.map(arg => 
    arg.includes(' ') || arg.includes('"') || arg.includes("'") 
      ? `"${arg.replace(/"/g, '\\"')}"` 
      : arg
  ).join(' ');
}

/**
 * Join extracted aliyun CLI commands into composite command
 * 
 * Input: ["aliyun ims CreateUser --UserName test", "aliyun ecs DescribeInstances"]
 * Output: "aliyun ims CreateUser --UserName test && aliyun ecs DescribeInstances"
 */
export function joinAliyunCommands(commands: string[]): string {
  if (commands.length === 0) return '';
  if (commands.length === 1) return commands[0];
  return commands.join(' && ');
}

/**
 * Extract command string from tool parameters
 */
export function extractCommandString(params: Record<string, unknown>): string | null {
  const commandKeys = ['command', 'cmd', 'script', 'code', 'content', 'input'];
  for (const key of commandKeys) {
    if (typeof params[key] === 'string') {
      return params[key] as string;
    }
  }
  // For single parameter, take value directly
  if (Object.keys(params).length === 1) {
    const value = Object.values(params)[0];
    if (typeof value === 'string') {
      return value;
    }
  }
  return null;
}