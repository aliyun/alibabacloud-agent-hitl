/**
 * 命令解析与阿里云 CLI 检测模块
 * 使用 shell-quote 库进行专业的 shell 命令解析
 */

import { parse, ParseEntry } from 'shell-quote';

/**
 * Shell 操作符（管道、逻辑运算符、分号等）
 */
const SHELL_OPERATORS = new Set(['|', '||', '&&', ';', '&']);

/**
 * 获取操作符字符串
 */
function getOperator(entry: ParseEntry): string | null {
  if (typeof entry === 'object' && entry !== null && 'op' in entry) {
    return (entry as { op: string }).op;
  }
  return null;
}

/**
 * 从复合命令中提取所有 aliyun CLI 命令
 * 
 * 使用 shell-quote 解析命令，按管道/逻辑运算符分割，
 * 提取以 'aliyun' 开头且至少有 3 个参数的命令段。
 * 
 * 示例：
 * 输入: "ls && aliyun ims CreateUser --UserName test | grep success"
 * 输出: ["aliyun ims CreateUser --UserName test"]
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
        // 遇到操作符，处理当前段
        const cmd = processSegment(currentSegment);
        if (cmd) commands.push(cmd);
        currentSegment = [];
      } else if (typeof entry === 'string') {
        currentSegment.push(entry);
      }
      // 忽略重定向等其他操作符
    }

    // 处理最后一段
    const cmd = processSegment(currentSegment);
    if (cmd) commands.push(cmd);

    return commands;
  } catch {
    // 解析失败时返回空数组
    return [];
  }
}

/**
 * 处理命令段，判断是否为有效的 aliyun CLI 命令
 * 有效格式：aliyun <ProductCode> <APIName> [Parameters...]
 */
function processSegment(segment: string[]): string | null {
  if (segment.length < 3) return null;
  if (segment[0] !== 'aliyun') return null;
  
  // 重新组装命令，正确处理带空格的参数
  return segment.map(arg => 
    arg.includes(' ') || arg.includes('"') || arg.includes("'") 
      ? `"${arg.replace(/"/g, '\\"')}"` 
      : arg
  ).join(' ');
}

/**
 * 将提取的 aliyun CLI 命令重新拼接为复合命令
 * 
 * 输入: ["aliyun ims CreateUser --UserName test", "aliyun ecs DescribeInstances"]
 * 输出: "aliyun ims CreateUser --UserName test && aliyun ecs DescribeInstances"
 */
export function joinAliyunCommands(commands: string[]): string {
  if (commands.length === 0) return '';
  if (commands.length === 1) return commands[0];
  return commands.join(' && ');
}

/**
 * 从工具参数中提取命令字符串
 */
export function extractCommandString(params: Record<string, unknown>): string | null {
  const commandKeys = ['command', 'cmd', 'script', 'code', 'content', 'input'];
  for (const key of commandKeys) {
    if (typeof params[key] === 'string') {
      return params[key] as string;
    }
  }
  // 单参数时直接取值
  if (Object.keys(params).length === 1) {
    const value = Object.values(params)[0];
    if (typeof value === 'string') {
      return value;
    }
  }
  return null;
}