# Alibaba Cloud Agent HITL

[中文文档](./README.zh-CN.md)

Human-in-the-Loop (HITL) solutions for Alibaba Cloud Agent integrations, enabling risk detection and human approval workflows for AI-driven cloud operations.

## Packages

| Package | Description |
|---------|-------------|
| [@alicloud/alibabacloud-hitl-claw-plugin](./packages/alibabacloud-hitl-claw-plugin) | OpenClaw plugin for HITL approval workflow |

## Overview

This monorepo contains HITL (Human-in-the-Loop) implementations for various AI Agent platforms. HITL ensures that high-risk Alibaba Cloud CLI operations require explicit human approval before execution.

### Key Features

- **Risk Detection**: Integrates with Alibaba Cloud IMS for real-time risk assessment
- **Human Approval**: High-risk operations require explicit approval via secure links
- **Multi-Channel Support**: Works with DingTalk, Feishu, and native console interfaces
- **Extensible**: Designed to support multiple Agent platforms

## Getting Started

See the documentation for each package:

- [OpenClaw Plugin Documentation](./packages/alibabacloud-hitl-claw-plugin/README.md)

## License

MIT
